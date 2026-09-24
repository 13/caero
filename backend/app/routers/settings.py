"""Settings router."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import Decimal
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import PROJECT_VERSION, settings
from app.database import get_db
from app.events import SCRAPE_RESULT_EVENTS, EventCategory, EventLevel
from app.images import schedule_image_download
from app.maintenance import OVERRIDABLE_KNOBS, MaintenanceConfig, config_from_row, valid_hhmm
from app.models import Alert, AppSettings, EventLog, PriceHistory, Product, SelectorDefault, User
from app.routers.auth import require_admin, require_user
from app.schedule_utils import describe_schedule
from app.scheduler import add_product_job, remove_product_job
from app.schemas import (
    AppSettingsIn,
    AppSettingsOut,
    AppSettingsPatch,
    DataExportPayload,
    EventLogOut,
    EventLogPage,
    JobOut,
    JobRunOut,
    JobsOut,
    NotificationChannelStatusOut,
    SelectorDefaultIn,
    SelectorDefaultOut,
    SystemInfoOut,
    TestEmailRequest,
    TestNotificationResponse,
    TestTelegramRequest,
    UiSettingsIn,
    UiSettingsOut,
    UserDataExportPayload,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

# app_settings keys accepted on import; legacy exports also contain DB
# connection fields that no longer exist and are silently dropped.
_IMPORTABLE_SETTINGS_KEYS = {
    "allow_registration", "date_format", "time_format", "telegram_bot_token", "public_url",
    "show_sparklines", "chart_line_style",
    "backup_enabled", "backup_time", "retention_enabled", "retention_time",
    *OVERRIDABLE_KNOBS,
}


def _send_test_email_sync(to_email: str) -> None:
    from app.notifier import render_plain

    sample = _test_notification("Email")
    msg = EmailMessage()
    msg["Subject"] = f"[Caero] {sample.subject}"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(render_plain(sample))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_tls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = AppSettings(id=1)
        db.add(settings_row)
        await db.flush()
    return settings_row


def _settings_out(row: AppSettings) -> AppSettingsOut:
    return AppSettingsOut(
        allow_registration=row.allow_registration,
        date_format=row.date_format,
        time_format=row.time_format,
        telegram_bot_token_set=bool(row.telegram_bot_token),
        public_url=row.public_url,
        public_url_env=settings.public_url,
        backup_enabled=row.backup_enabled,
        backup_time=row.backup_time,
        retention_enabled=row.retention_enabled,
        retention_time=row.retention_time,
        **{name: getattr(row, name) for name in OVERRIDABLE_KNOBS},
        **{f"{name}_env": getattr(settings, name) for name in OVERRIDABLE_KNOBS},
        updated_at=row.updated_at,
    )


def _describe_maintenance_change(before: MaintenanceConfig, after: MaintenanceConfig) -> list[str]:
    changes = []
    for key, label in (("backup", "Backup"), ("retention", "Retention")):
        if before.enabled(key) != after.enabled(key):
            changes.append(f"{label} {'enabled' if after.enabled(key) else 'disabled'}")
        if before.time(key) != after.time(key):
            changes.append(f"{label} time {before.time(key)} → {after.time(key)}")
    for name in OVERRIDABLE_KNOBS:
        if getattr(before, name) != getattr(after, name):
            changes.append(f"{name} {getattr(before, name)} → {getattr(after, name)}")
    return changes


async def _update_settings(db: AsyncSession, row: AppSettings, changes: dict, admin: User) -> None:
    """Apply field changes to the settings row. Maintenance changes are logged
    and reach the scheduler only once the request's transaction commits."""
    before = config_from_row(row)
    if "telegram_bot_token" in changes:
        from app.notifier import configure_telegram
        configure_telegram(changes["telegram_bot_token"])
    if "public_url" in changes:
        changes["public_url"] = changes["public_url"].strip().rstrip("/")
        from app.notifier import configure_public_url
        configure_public_url(changes["public_url"])
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_at = datetime.now(UTC)
    await db.flush()

    after = config_from_row(row)
    if after == before:
        return
    from app.events import log_event
    from app.scheduler import apply_maintenance_schedule_after_commit

    log_event(
        db,
        level="info",
        category="maintenance",
        event="maintenance_settings",
        message=f"{admin.username}: " + "; ".join(_describe_maintenance_change(before, after)),
        details={"by": admin.username, "before": asdict(before), "after": asdict(after)},
    )
    apply_maintenance_schedule_after_commit(db, after)


@router.get("", response_model=AppSettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    return _settings_out(row)


@router.post("", response_model=AppSettingsOut)
async def save_settings(
    body: AppSettingsIn,
    db: AsyncSession = Depends(get_db, scope="function"),
    admin: User = Depends(require_admin),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    await _update_settings(db, row, body.model_dump(exclude_none=True), admin)
    return _settings_out(row)


@router.patch("", response_model=AppSettingsOut)
async def patch_settings(
    body: AppSettingsPatch,
    db: AsyncSession = Depends(get_db, scope="function"),
    admin: User = Depends(require_admin),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    changes = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None or field in OVERRIDABLE_KNOBS
    }
    await _update_settings(db, row, changes, admin)
    return _settings_out(row)


# ── Display preferences (available to every authenticated user) ────────────────

def _ui_settings_out(row: AppSettings) -> UiSettingsOut:
    return UiSettingsOut(
        date_format=row.date_format,
        time_format=row.time_format,
        show_sparklines=row.show_sparklines,
        chart_line_style=row.chart_line_style,
        scrape_failure_threshold=settings.scraper_failure_alert_threshold,
    )


@router.get("/ui", response_model=UiSettingsOut)
async def get_ui_settings(
    db: AsyncSession = Depends(get_db, scope="function"),
    _user: User = Depends(require_user),
) -> UiSettingsOut:
    row = await _get_or_create_settings(db)
    return _ui_settings_out(row)


@router.patch("/ui", response_model=UiSettingsOut)
async def save_ui_settings(
    body: UiSettingsIn,
    db: AsyncSession = Depends(get_db, scope="function"),
    _user: User = Depends(require_user),
) -> UiSettingsOut:
    row = await _get_or_create_settings(db)
    row.date_format = body.date_format
    row.time_format = body.time_format
    if body.show_sparklines is not None:
        row.show_sparklines = body.show_sparklines
    if body.chart_line_style is not None:
        row.chart_line_style = body.chart_line_style
    row.updated_at = datetime.now(UTC)
    await db.flush()
    return _ui_settings_out(row)


# ── Default price selectors (per-site) ─────────────────────────────────────────

@router.get("/selectors", response_model=list[SelectorDefaultOut])
async def list_selector_defaults(
    db: AsyncSession = Depends(get_db, scope="function"),
    _user=Depends(require_user),
) -> list[SelectorDefaultOut]:
    result = await db.execute(select(SelectorDefault).order_by(SelectorDefault.domain))
    return [SelectorDefaultOut.model_validate(row) for row in result.scalars().all()]


@router.post("/selectors", response_model=SelectorDefaultOut, status_code=status.HTTP_201_CREATED)
async def create_selector_default(
    body: SelectorDefaultIn,
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> SelectorDefaultOut:
    existing = await db.execute(
        select(SelectorDefault).where(SelectorDefault.domain == body.domain)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"A selector for '{body.domain}' already exists")
    row = SelectorDefault(domain=body.domain, selector=body.selector)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return SelectorDefaultOut.model_validate(row)


@router.patch("/selectors/{selector_id}", response_model=SelectorDefaultOut)
async def update_selector_default(
    selector_id: int,
    body: SelectorDefaultIn,
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> SelectorDefaultOut:
    row = await db.get(SelectorDefault, selector_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Selector not found")
    clash = await db.execute(
        select(SelectorDefault).where(
            SelectorDefault.domain == body.domain,
            SelectorDefault.id != selector_id,
        )
    )
    if clash.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"A selector for '{body.domain}' already exists")
    row.domain = body.domain
    row.selector = body.selector
    await db.flush()
    return SelectorDefaultOut.model_validate(row)


@router.delete("/selectors/{selector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_selector_default(
    selector_id: int,
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> None:
    row = await db.get(SelectorDefault, selector_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Selector not found")
    await db.delete(row)


# ── Notification tests ─────────────────────────────────────────────────────────

@router.post("/test-email", response_model=TestNotificationResponse)
async def test_email_notification(
    body: TestEmailRequest,
    _admin: User = Depends(require_admin),
) -> TestNotificationResponse:
    if not settings.smtp_host:
        return TestNotificationResponse(status="error", message="SMTP is not configured")
    if settings.smtp_user and not settings.smtp_password:
        return TestNotificationResponse(
            status="error",
            message="SMTP password is required when SMTP user is configured",
        )
    try:
        await asyncio.to_thread(_send_test_email_sync, body.email)
        return TestNotificationResponse(status="sent", message=f"Test email sent to {body.email}")
    except Exception as exc:
        logger.error("Failed to send test email to %s: %s", body.email, exc)
        return TestNotificationResponse(
            status="error",
            message="Failed to send test email. Check SMTP configuration and logs.",
        )


def _test_notification(channel: str):
    """A sample price alert built by the real alert code, so admins see the actual format."""
    from app.notifier import build_alert_message, caero_url

    message = build_alert_message(
        product_id=0,
        product_name="Example product",
        product_url="https://example.com/product",
        condition="lowered_percent",
        current_price=Decimal("279.00"),
        currency="EUR",
        threshold_percent=Decimal("10"),
        previous_price=Decimal("329.00"),
    )
    url = caero_url("/")
    message.title = f"Test: {message.title}"
    message.text = [
        f"{channel} {'are' if channel.endswith('s') else 'is'} working — this is a sample alert.",
        "Links to Caero are enabled." if url
        else "Set a public URL in Settings to add \"Open in Caero\" links to notifications.",
    ]
    message.links = ([("Open Caero", url)] if url else []) + [("Open shop", "https://example.com/product")]
    return message


@router.post("/test-telegram", response_model=TestNotificationResponse)
async def test_telegram_notification(
    body: TestTelegramRequest,
    _admin: User = Depends(require_admin),
) -> TestNotificationResponse:
    from app.notifier import get_telegram_token, send_telegram_message

    token = get_telegram_token()
    if not token:
        return TestNotificationResponse(status="error", message="Telegram bot token not configured")
    try:
        await send_telegram_message(token, body.chat_id, _test_notification("Telegram"))
        return TestNotificationResponse(status="sent", message="Test Telegram message sent")
    except Exception as e:
        return TestNotificationResponse(status="error", message=str(e))


@router.post("/test-webhooks", response_model=TestNotificationResponse)
async def test_webhook_notifications(
    _admin: User = Depends(require_admin),
) -> TestNotificationResponse:
    from app.notifier import _send_webhook_notifications, _webhooks_configured

    channels = [
        name
        for name, configured in (
            ("ntfy", bool(settings.ntfy_url)),
            ("Gotify", bool(settings.gotify_url and settings.gotify_token)),
            ("Discord", bool(settings.discord_webhook_url)),
        )
        if configured
    ]
    if not _webhooks_configured():
        return TestNotificationResponse(
            status="error",
            message="No webhook channels configured (NTFY_URL / GOTIFY_URL+TOKEN / DISCORD_WEBHOOK_URL)",
        )

    await _send_webhook_notifications(_test_notification("Webhook channels"))
    return TestNotificationResponse(
        status="sent",
        message=(
            f"Test sent to: {', '.join(channels)}. "
            "Check the channel(s) — delivery failures show under Delivery status."
        ),
    )


@router.get("/notification-status", response_model=list[NotificationChannelStatusOut])
async def notification_status(
    _admin: User = Depends(require_admin),
) -> list[NotificationChannelStatusOut]:
    """Last delivery outcome per channel since startup."""
    from app.notifier import channel_statuses

    return [NotificationChannelStatusOut.model_validate(s) for s in channel_statuses()]


# ── System info & jobs ─────────────────────────────────────────────────────────

@router.get("/system-info", response_model=SystemInfoOut)
async def system_info(
    db: AsyncSession = Depends(get_db, scope="function"),
    _user: User = Depends(require_user),
) -> SystemInfoOut:
    from app.browser import get_backend

    db_version = "Unknown"
    try:
        if settings.db_type == "postgresql":
            result = await db.execute(text("SHOW server_version;"))
            db_version = result.scalar_one_or_none() or "Unknown"
        else:
            result = await db.execute(text("select sqlite_version();"))
            db_version = result.scalar_one_or_none() or "Unknown"
    except Exception:
        pass

    return SystemInfoOut(
        version=PROJECT_VERSION,
        build_date=settings.build_date,
        db_type=settings.db_type,
        db_version=str(db_version),
        scraper_backend=get_backend(),
        scraper_headless=settings.scraper_headless,
    )


_STATUS_BY_EVENT = {
    "scrape_ok": "ok",
    "scrape_unchanged": "ok",
    "scrape_failed": "failed",
    "scrape_skipped": "skipped",
}


def _last_status(row: EventLog | None) -> str | None:
    if row is None:
        return None
    if row.event in _STATUS_BY_EVENT:
        return _STATUS_BY_EVENT[row.event]
    return "failed" if row.level == "error" else "ok"


@router.get("/jobs", response_model=JobsOut)
async def list_jobs(
    db: AsyncSession = Depends(get_db, scope="function"),
    _user=Depends(require_admin),
) -> JobsOut:
    from app.scheduler import (
        MAINTENANCE_JOBS,
        RUN_NOW_SUFFIX,
        check_all_in_progress,
        product_id_from_job,
        scheduler,
        scrape_in_progress,
    )

    jobs = [j for j in scheduler.get_jobs() if not j.id.endswith(RUN_NOW_SUFFIX)]
    product_ids = [pid for j in jobs if (pid := product_id_from_job(j.id)) is not None]

    products: dict[int, tuple[Product, str]] = {}
    last_scrape: dict[int, EventLog] = {}
    if product_ids:
        rows = await db.execute(
            select(Product, User.username).join(User, Product.user_id == User.id).where(Product.id.in_(product_ids))
        )
        products = {p.id: (p, username) for p, username in rows.all()}
        newest = (
            select(func.max(EventLog.id))
            .where(EventLog.product_id.in_(product_ids), EventLog.event.in_(SCRAPE_RESULT_EVENTS))
            .group_by(EventLog.product_id)
        )
        for row in (await db.execute(select(EventLog).where(EventLog.id.in_(newest)))).scalars():
            last_scrape[row.product_id] = row

    maintenance_events = [spec["event"] for spec in MAINTENANCE_JOBS.values()]
    newest_maintenance = (
        select(func.max(EventLog.id)).where(EventLog.event.in_(maintenance_events)).group_by(EventLog.event)
    )
    maintenance = config_from_row(await db.get(AppSettings, 1))
    last_maintenance = {
        row.event: row
        for row in (await db.execute(select(EventLog).where(EventLog.id.in_(newest_maintenance)))).scalars()
    }

    out: list[JobOut] = []
    for job in jobs:
        next_run = getattr(job, "next_run_time", None)
        pid = product_id_from_job(job.id)
        if pid is not None:
            product, owner = products.get(pid, (None, None))
            last = last_scrape.get(pid)
            out.append(JobOut(
                id=job.id,
                kind="product",
                name=product.name if product else f"Product #{pid}",
                product_id=pid,
                owner=owner,
                schedule=(
                    describe_schedule(product.check_interval_minutes, product.check_time_hhmm)
                    if product else "—"
                ),
                next_run_time=next_run,
                last_run_at=last.created_at if last else None,
                last_status=_last_status(last),
                last_duration_ms=last.duration_ms if last else None,
                last_message=last.message if last else None,
                consecutive_failures=product.consecutive_scrape_failures if product else 0,
                running=scrape_in_progress(pid),
                interval_minutes=product.check_interval_minutes if product else None,
                time_hhmm=product.check_time_hhmm if product else None,
            ))
        else:
            spec = MAINTENANCE_JOBS.get(job.id)
            last = last_maintenance.get(spec["event"]) if spec else None
            key = spec["key"] if spec else None
            out.append(JobOut(
                id=job.id,
                kind="maintenance",
                name=spec["name"] if spec else job.id,
                schedule=f"Daily at {maintenance.time(key)}" if key else str(job.trigger),
                next_run_time=next_run,
                last_run_at=last.created_at if last else None,
                last_status=_last_status(last),
                last_message=last.message if last else None,
                paused=bool(key) and not maintenance.enabled(key),
                noop_reason=maintenance.noop_reason(key) if key else None,
                interval_minutes=1440 if key else None,
                time_hhmm=maintenance.time(key) if key else None,
            ))

    far_future = datetime.max.replace(tzinfo=UTC)
    out.sort(key=lambda j: (j.last_status != "failed", j.next_run_time or far_future))
    return JobsOut(jobs=out, check_all_running=check_all_in_progress())


@router.post("/jobs/{job_id}/run", response_model=JobRunOut, status_code=status.HTTP_202_ACCEPTED)
async def run_job_now(job_id: str, _user=Depends(require_admin)) -> JobRunOut:
    from app.scheduler import RUN_NOW_SUFFIX, scheduler

    job = scheduler.get_job(job_id)
    if job is None or job_id.endswith(RUN_NOW_SUFFIX):
        raise HTTPException(status_code=404, detail="Job not found")
    # A separate one-off job: modify_job(next_run_time=now) would re-anchor the
    # interval trigger and drift the product away from its check time. The
    # per-product lock still serialises it against a scheduled run.
    scheduler.add_job(
        job.func,
        "date",
        run_date=datetime.now(UTC),
        args=job.args,
        kwargs=job.kwargs,
        id=job_id + RUN_NOW_SUFFIX,
        replace_existing=True,
        misfire_grace_time=None,
    )
    return JobRunOut(queued=True)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/logs", response_model=EventLogPage)
async def list_event_log(
    level: list[EventLevel] = Query(default=[]),
    category: list[EventCategory] = Query(default=[]),
    product_id: int | None = Query(default=None, ge=1),
    q: str | None = Query(default=None, max_length=200),
    before_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> EventLogPage:
    # Keyset pagination on id: stable while new events keep arriving.
    stmt = select(EventLog).order_by(EventLog.id.desc()).limit(limit)
    if before_id is not None:
        stmt = stmt.where(EventLog.id < before_id)
    if level:
        stmt = stmt.where(EventLog.level.in_(level))
    if category:
        stmt = stmt.where(EventLog.category.in_(category))
    if product_id is not None:
        stmt = stmt.where(EventLog.product_id == product_id)
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip().lower())}%"
        stmt = stmt.where(
            or_(
                func.lower(EventLog.message).like(pattern, escape="\\"),
                func.lower(EventLog.product_name).like(pattern, escape="\\"),
            )
        )

    rows = (await db.execute(stmt)).scalars().all()
    return EventLogPage(
        items=[EventLogOut.model_validate(r) for r in rows],
        next_before_id=rows[-1].id if len(rows) == limit else None,
    )


# ── Import / export ────────────────────────────────────────────────────────────

def _serialize_decimal(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return str(value)


def _parse_datetime(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _list_user_products(db: AsyncSession, user_id: int) -> list[Product]:
    result = await db.execute(select(Product).where(Product.user_id == user_id))
    return result.scalars().all()


async def _reset_pg_sequences(db: AsyncSession) -> None:
    """Re-sync PG id sequences after inserting rows with explicit ids.

    Explicit-id inserts bypass the sequence, so without this the next regular
    insert reuses an already-taken id and fails. No-op on SQLite.
    """
    if settings.db_type != "postgresql":
        return
    for table in ("users", "products", "price_history", "alerts"):
        await db.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
        ))


async def _delete_products(products: list[Product], db: AsyncSession) -> int:
    from app.images import delete_local_image
    for product in products:
        remove_product_job(product.id)
        # remove cached local image if present
        try:
            delete_local_image(getattr(product, 'cached_image_url', None))
        except Exception:
            pass
        await db.delete(product)
    await db.flush()
    return len(products)


@router.get("/export", response_model=DataExportPayload)
async def export_data(
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> DataExportPayload:
    from app.backup import build_export_payload

    return DataExportPayload(**await build_export_payload(db))


@router.get("/export/mine", response_model=UserDataExportPayload)
async def export_my_data(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> UserDataExportPayload:
    products = await _list_user_products(db, user.id)
    product_ids = [product.id for product in products]

    if product_ids:
        price_history = (
            await db.execute(select(PriceHistory).where(PriceHistory.product_id.in_(product_ids)))
        ).scalars().all()
        alerts = (await db.execute(select(Alert).where(Alert.product_id.in_(product_ids)))).scalars().all()
    else:
        price_history = []
        alerts = []

    return UserDataExportPayload(
        products=[
            {
                "id": product.id,
                "name": product.name,
                "category": product.category,
                "memo": product.memo,
                "tags": product.tags,
                "image_url": product.image_url,
                "check_time_hhmm": product.check_time_hhmm,
                "url": product.url,
                "selector": product.selector,
                "check_interval_minutes": product.check_interval_minutes,
                "record_all_prices": product.record_all_prices,
                "price_format": product.price_format,
                "inverse_price": product.inverse_price,
                "active": product.active,
                "created_at": product.created_at.isoformat() if product.created_at else None,
            }
            for product in products
        ],
        price_history=[
            {
                "id": row.id,
                "product_id": row.product_id,
                "price": _serialize_decimal(row.price),
                "currency": row.currency,
                "scraped_at": row.scraped_at.isoformat() if row.scraped_at else None,
            }
            for row in price_history
        ],
        alerts=[
            {
                "id": alert.id,
                "product_id": alert.product_id,
                "condition": alert.condition,
                "threshold_price": _serialize_decimal(alert.threshold_price),
                "email": alert.email,
                "telegram_chat_id": alert.telegram_chat_id,
                "active": alert.active,
            }
            for alert in alerts
        ],
    )


def _importable_settings(raw: dict) -> dict:
    """app_settings keys from an export, minus maintenance values that don't
    validate (hand-edited files) — those fall back to their defaults."""
    data = {key: value for key, value in raw.items() if key in _IMPORTABLE_SETTINGS_KEYS}
    checks = {
        "backup_enabled": lambda v: isinstance(v, bool),
        "retention_enabled": lambda v: isinstance(v, bool),
        "backup_time": valid_hhmm,
        "retention_time": valid_hhmm,
        **{name: lambda v: v is None or (isinstance(v, int) and not isinstance(v, bool) and v >= 0)
           for name in OVERRIDABLE_KNOBS},
    }
    for key, is_valid in checks.items():
        if key in data and not is_valid(data[key]):
            logger.warning("Import: ignoring invalid app_settings.%s %r", key, data[key])
            del data[key]
    return data


@router.post("/import")
async def import_data(
    payload: DataExportPayload,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    skipped_price_rows = 0
    existing_product_ids = (await db.execute(select(Product.id))).scalars().all()
    for product_id in existing_product_ids:
        remove_product_job(product_id)

    await db.execute(Alert.__table__.delete())
    await db.execute(PriceHistory.__table__.delete())
    # Bulk delete bypasses the ORM before_delete listener that detaches events
    # (app/events.py), and SQLite doesn't enforce ON DELETE SET NULL — without
    # this, a product re-inserted below with its old id would silently
    # inherit that old product's events.
    await db.execute(update(EventLog).where(EventLog.product_id.is_not(None)).values(product_id=None))
    await db.execute(Product.__table__.delete())
    await db.execute(User.__table__.delete())
    await db.execute(AppSettings.__table__.delete())
    await db.flush()

    settings_data = _importable_settings(payload.app_settings)
    app_settings = AppSettings(id=1, **settings_data)
    db.add(app_settings)

    for user in payload.users:
        db.add(
            User(
                id=user["id"],
                username=user["username"],
                hashed_password=user["hashed_password"],
                is_admin=user.get("is_admin", False),
                created_at=_parse_datetime(user.get("created_at")),
            )
        )

    for product in payload.products:
        tags_value = product.get("tags", [])
        if isinstance(tags_value, list):
            tags_value = ",".join(str(tag).strip() for tag in tags_value if str(tag).strip())
        elif tags_value is None:
            tags_value = ""
        else:
            tags_value = str(tags_value)
        db.add(
            Product(
                id=product["id"],
                user_id=product["user_id"],
                name=product["name"],
                category=product.get("category"),
                memo=product.get("memo"),
                tags=tags_value,
                image_url=product.get("image_url"),
                cached_image_url=None,
                check_time_hhmm=product.get("check_time_hhmm") or "10:00",
                url=product["url"],
                selector=product["selector"],
                check_interval_minutes=product.get("check_interval_minutes", 30),
                record_all_prices=bool(product.get("record_all_prices", False)),
                price_format=product.get("price_format") or "auto",
                inverse_price=bool(product.get("inverse_price", False)),
                active=product.get("active", True),
                created_at=_parse_datetime(product.get("created_at")),
            )
        )

    for row in payload.price_history:
        if row.get("price") is None:
            skipped_price_rows += 1
            continue
        db.add(
            PriceHistory(
                id=row["id"],
                product_id=row["product_id"],
                price=Decimal(row["price"]),
                currency=row.get("currency", "EUR"),
                scraped_at=_parse_datetime(row.get("scraped_at")),
            )
        )

    for alert in payload.alerts:
        db.add(
            Alert(
                id=alert["id"],
                product_id=alert["product_id"],
                condition=alert["condition"],
                threshold_price=Decimal(alert["threshold_price"])
                if alert.get("threshold_price")
                else None,
                threshold_percent=Decimal(alert["threshold_percent"])
                if alert.get("threshold_percent")
                else None,
                email=alert.get("email"),
                telegram_chat_id=alert.get("telegram_chat_id"),
                active=alert.get("active", True),
            )
        )

    await db.flush()
    await _reset_pg_sequences(db)

    from app.scheduler import apply_maintenance_schedule_after_commit
    apply_maintenance_schedule_after_commit(db, config_from_row(app_settings))

    imported_products = (await db.execute(select(Product))).scalars().all()
    for product in imported_products:
        if product.active:
            add_product_job(product)
        schedule_image_download(background_tasks, product.id, product.image_url)

    if skipped_price_rows:
        logger.warning("Skipped %s imported price history row(s) with null price", skipped_price_rows)
    return {"message": f"Data imported (skipped {skipped_price_rows} invalid price rows)"}


@router.delete("/products/mine", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_products(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> None:
    products = await _list_user_products(db, user.id)
    await _delete_products(products, db)


@router.delete("/users/{user_id}/products")
async def admin_delete_user_products(
    user_id: int,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict[str, str]:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    products = await _list_user_products(db, target.id)
    deleted = await _delete_products(products, db)
    return {"message": f"Deleted {deleted} product(s) for user {target.username}"}


@router.post("/import/mine")
async def import_my_data(
    payload: UserDataExportPayload,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict[str, str]:
    products = await _list_user_products(db, user.id)
    await _delete_products(products, db)

    product_id_map: dict[int, int] = {}
    skipped_price_rows = 0

    for product in payload.products:
        tags_value = product.get("tags", [])
        if isinstance(tags_value, list):
            tags_value = ",".join(str(tag).strip() for tag in tags_value if str(tag).strip())
        elif tags_value is None:
            tags_value = ""
        else:
            tags_value = str(tags_value)

        new_product = Product(
            user_id=user.id,
            name=product["name"],
            category=product.get("category"),
            memo=product.get("memo"),
            tags=tags_value,
            image_url=product.get("image_url"),
            cached_image_url=None,
            check_time_hhmm=product.get("check_time_hhmm") or "10:00",
            url=product["url"],
            selector=product["selector"],
            check_interval_minutes=product.get("check_interval_minutes", 30),
            record_all_prices=bool(product.get("record_all_prices", False)),
                price_format=product.get("price_format") or "auto",
                inverse_price=bool(product.get("inverse_price", False)),
            active=product.get("active", True),
            created_at=_parse_datetime(product.get("created_at")),
        )
        db.add(new_product)
        await db.flush()

        old_product_id = product.get("id")
        if isinstance(old_product_id, int):
            product_id_map[old_product_id] = new_product.id

    for row in payload.price_history:
        old_product_id = row.get("product_id")
        if not isinstance(old_product_id, int):
            continue
        new_product_id = product_id_map.get(old_product_id)
        if not new_product_id:
            continue
        if row.get("price") is None:
            skipped_price_rows += 1
            continue
        db.add(
            PriceHistory(
                product_id=new_product_id,
                price=Decimal(row["price"]),
                currency=row.get("currency", "EUR"),
                scraped_at=_parse_datetime(row.get("scraped_at")),
            )
        )

    for alert in payload.alerts:
        old_product_id = alert.get("product_id")
        if not isinstance(old_product_id, int):
            continue
        new_product_id = product_id_map.get(old_product_id)
        if not new_product_id:
            continue
        db.add(
            Alert(
                product_id=new_product_id,
                condition=alert["condition"],
                threshold_price=Decimal(alert["threshold_price"])
                if alert.get("threshold_price")
                else None,
                threshold_percent=Decimal(alert["threshold_percent"])
                if alert.get("threshold_percent")
                else None,
                email=alert.get("email"),
                telegram_chat_id=alert.get("telegram_chat_id"),
                active=alert.get("active", True),
            )
        )

    await db.flush()

    imported_products = await _list_user_products(db, user.id)
    for product in imported_products:
        if product.active:
            add_product_job(product)
        schedule_image_download(background_tasks, product.id, product.image_url)

    if skipped_price_rows:
        logger.warning(
            "Skipped %s imported user price history row(s) with null price", skipped_price_rows
        )
    return {"message": f"My data imported (skipped {skipped_price_rows} invalid price rows)"}
