"""Settings router."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from datetime import UTC, datetime
from decimal import Decimal
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import PROJECT_VERSION, settings
from app.database import get_db
from app.images import schedule_image_download
from app.models import Alert, AppSettings, PriceHistory, Product, SelectorDefault, User
from app.routers.auth import require_admin, require_user
from app.scheduler import add_product_job, remove_product_job
from app.schemas import (
    AppSettingsIn,
    AppSettingsOut,
    DataExportPayload,
    JobOut,
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
_IMPORTABLE_SETTINGS_KEYS = {"allow_registration", "date_format", "time_format", "telegram_bot_token"}


def _send_test_email_sync(to_email: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = "[Caero] Test email"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content("This is a test email from Caero settings.")
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
        updated_at=row.updated_at,
    )


@router.get("", response_model=AppSettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    return _settings_out(row)


@router.post("", response_model=AppSettingsOut)
async def save_settings(
    body: AppSettingsIn,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    row.allow_registration = body.allow_registration
    row.date_format = body.date_format
    row.time_format = body.time_format
    if body.telegram_bot_token is not None:
        row.telegram_bot_token = body.telegram_bot_token
        from app.notifier import configure_telegram
        configure_telegram(row.telegram_bot_token)
    row.updated_at = datetime.now(UTC)
    await db.flush()
    return _settings_out(row)


# ── Display preferences (available to every authenticated user) ────────────────

def _ui_settings_out(row: AppSettings) -> UiSettingsOut:
    return UiSettingsOut(
        date_format=row.date_format,
        time_format=row.time_format,
        show_sparklines=row.show_sparklines,
    )


@router.get("/ui", response_model=UiSettingsOut)
async def get_ui_settings(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_user),
) -> UiSettingsOut:
    row = await _get_or_create_settings(db)
    return _ui_settings_out(row)


@router.patch("/ui", response_model=UiSettingsOut)
async def save_ui_settings(
    body: UiSettingsIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_user),
) -> UiSettingsOut:
    row = await _get_or_create_settings(db)
    row.date_format = body.date_format
    row.time_format = body.time_format
    if body.show_sparklines is not None:
        row.show_sparklines = body.show_sparklines
    row.updated_at = datetime.now(UTC)
    await db.flush()
    return _ui_settings_out(row)


# ── Default price selectors (per-site) ─────────────────────────────────────────

@router.get("/selectors", response_model=list[SelectorDefaultOut])
async def list_selector_defaults(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user),
) -> list[SelectorDefaultOut]:
    result = await db.execute(select(SelectorDefault).order_by(SelectorDefault.domain))
    return [SelectorDefaultOut.model_validate(row) for row in result.scalars().all()]


@router.post("/selectors", response_model=SelectorDefaultOut, status_code=status.HTTP_201_CREATED)
async def create_selector_default(
    body: SelectorDefaultIn,
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
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


@router.post("/test-telegram", response_model=TestNotificationResponse)
async def test_telegram_notification(
    body: TestTelegramRequest,
    _admin: User = Depends(require_admin),
) -> TestNotificationResponse:
    from app.notifier import get_telegram_token

    token = get_telegram_token()
    if not token:
        return TestNotificationResponse(status="error", message="Telegram bot token not configured")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": body.chat_id, "text": "Testing Telegram notification from Caero..."},
                timeout=10.0,
            )
            response.raise_for_status()
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

    await _send_webhook_notifications(
        "[Caero] Test notification", "Webhook channels are working."
    )
    return TestNotificationResponse(
        status="sent",
        message=(
            f"Test sent to: {', '.join(channels)}. "
            "Check the channel(s) — delivery failures only appear in the logs."
        ),
    )


# ── System info & jobs ─────────────────────────────────────────────────────────

@router.get("/system-info", response_model=SystemInfoOut)
async def system_info(
    db: AsyncSession = Depends(get_db),
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
        db_type=settings.db_type,
        db_version=str(db_version),
        scraper_backend=get_backend(),
        scraper_headless=settings.scraper_headless,
    )


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    _user=Depends(require_admin),
) -> list[JobOut]:
    from app.scheduler import scheduler

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append(JobOut(id=job.id, next_run_time=job.next_run_time))
    return jobs


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
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DataExportPayload:
    from app.backup import build_export_payload

    return DataExportPayload(**await build_export_payload(db))


@router.get("/export/mine", response_model=UserDataExportPayload)
async def export_my_data(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
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


@router.post("/import")
async def import_data(
    payload: DataExportPayload,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    skipped_price_rows = 0
    existing_product_ids = (await db.execute(select(Product.id))).scalars().all()
    for product_id in existing_product_ids:
        remove_product_job(product_id)

    await db.execute(Alert.__table__.delete())
    await db.execute(PriceHistory.__table__.delete())
    await db.execute(Product.__table__.delete())
    await db.execute(User.__table__.delete())
    await db.execute(AppSettings.__table__.delete())
    await db.flush()

    settings_data = {
        key: value
        for key, value in payload.app_settings.items()
        if key in _IMPORTABLE_SETTINGS_KEYS
    }
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
    db: AsyncSession = Depends(get_db),
) -> None:
    products = await _list_user_products(db, user.id)
    await _delete_products(products, db)


@router.delete("/users/{user_id}/products")
async def admin_delete_user_products(
    user_id: int,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    db: AsyncSession = Depends(get_db),
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
