"""Settings router."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from decimal import Decimal
from datetime import datetime, timezone
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Alert, AppSettings, PriceHistory, Product, User
from app.routers.auth import require_admin, require_user
from app.scheduler import add_product_job, remove_product_job
from app.schemas import (
    AppSettingsIn,
    AppSettingsOut,
    DataExportPayload,
    SystemInfoOut,
    TestDbRequest,
    TestDbResponse,
    TestEmailRequest,
    TestNotificationResponse,
    TestTelegramRequest,
    UserDataExportPayload,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


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


@router.get("", response_model=AppSettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    return AppSettingsOut.model_validate(row)


@router.post("", response_model=AppSettingsOut)
async def save_settings(
    body: AppSettingsIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()
    await db.refresh(row)
    return AppSettingsOut.model_validate(row)


@router.post("/test-db", response_model=TestDbResponse)
async def test_db_connection(
    body: TestDbRequest,
    _user=Depends(require_user),
) -> TestDbResponse:
    if body.db_type == "sqlite":
        try:
            import aiosqlite

            async with aiosqlite.connect(body.sqlite_path) as conn:
                await conn.execute("SELECT 1")
            return TestDbResponse(status="connected", message="SQLite connection successful")
        except Exception as exc:
            return TestDbResponse(status="error", message=str(exc))

    elif body.db_type == "postgresql":
        try:
            import asyncpg

            conn = await asyncpg.connect(
                host=body.pg_host,
                port=body.pg_port,
                database=body.pg_database,
                user=body.pg_user,
                password=body.pg_password,
                timeout=5,
            )
            await conn.fetchval("SELECT 1")
            await conn.close()
            return TestDbResponse(status="connected", message="PostgreSQL connection successful")
        except Exception as exc:
            return TestDbResponse(status="error", message=str(exc))

    raise HTTPException(status_code=422, detail="Unknown db_type")


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
    _user=Depends(require_admin),
) -> TestNotificationResponse:
    from app.notifier import init_telegram_bot

    bot = init_telegram_bot()
    if bot is None:
        return TestNotificationResponse(status="failed", message="Telegram bot token not configured")
    try:
        await bot.send_message(
            chat_id=body.chat_id,
            text="Testing Telegram notification from Caero...",
        )
        return TestNotificationResponse(status="sent", message="Test Telegram message sent")
    except Exception as e:
        return TestNotificationResponse(status="failed", message=str(e))


@router.get("/system-info", response_model=SystemInfoOut)
async def system_info(
    db: AsyncSession = Depends(get_db),
) -> SystemInfoOut:
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
        version="0.2.0",
        db_type=settings.db_type,
        db_version=str(db_version),
    )


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


async def _delete_products(products: list[Product], db: AsyncSession) -> int:
    for product in products:
        remove_product_job(product.id)
        await db.delete(product)
    await db.flush()
    return len(products)


@router.get("/export", response_model=DataExportPayload)
async def export_data(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DataExportPayload:
    app_settings = await _get_or_create_settings(db)
    users = (await db.execute(select(User))).scalars().all()
    products = (await db.execute(select(Product))).scalars().all()
    price_history = (await db.execute(select(PriceHistory))).scalars().all()
    alerts = (await db.execute(select(Alert))).scalars().all()

    return DataExportPayload(
        app_settings={
            "id": app_settings.id,
            "db_type": app_settings.db_type,
            "sqlite_path": app_settings.sqlite_path,
            "pg_host": app_settings.pg_host,
            "pg_port": app_settings.pg_port,
            "pg_database": app_settings.pg_database,
            "pg_user": app_settings.pg_user,
            "pg_password": app_settings.pg_password,
            "allow_registration": app_settings.allow_registration,
            "date_format": app_settings.date_format,
        },
        users=[
            {
                "id": user.id,
                "username": user.username,
                "hashed_password": user.hashed_password,
                "is_admin": user.is_admin,
                "created_at": user.created_at.isoformat() if user.created_at else None,
            }
            for user in users
        ],
        products=[
            {
                "id": product.id,
                "user_id": product.user_id,
                "name": product.name,
                "category": product.category,
                "memo": product.memo,
                "tags": product.tags,
                "image_url": product.image_url,
                "url": product.url,
                "selector": product.selector,
                "check_interval_minutes": product.check_interval_minutes,
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
                "url": product.url,
                "selector": product.selector,
                "check_interval_minutes": product.check_interval_minutes,
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

    app_settings = AppSettings(**payload.app_settings)
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
                url=product["url"],
                selector=product["selector"],
                check_interval_minutes=product.get("check_interval_minutes", 30),
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
                email=alert.get("email"),
                telegram_chat_id=alert.get("telegram_chat_id"),
                active=alert.get("active", True),
            )
        )

    await db.flush()
    await db.commit()

    imported_products = (await db.execute(select(Product))).scalars().all()
    for product in imported_products:
        if product.active:
            add_product_job(product)

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
    await db.commit()


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
    await db.commit()
    return {"message": f"Deleted {deleted} product(s) for user {target.username}"}


@router.post("/import/mine")
async def import_my_data(
    payload: UserDataExportPayload,
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
            url=product["url"],
            selector=product["selector"],
            check_interval_minutes=product.get("check_interval_minutes", 30),
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
                email=alert.get("email"),
                telegram_chat_id=alert.get("telegram_chat_id"),
                active=alert.get("active", True),
            )
        )

    await db.flush()
    await db.commit()

    imported_products = await _list_user_products(db, user.id)
    for product in imported_products:
        if product.active:
            add_product_job(product)

    if skipped_price_rows:
        logger.warning(
            "Skipped %s imported user price history row(s) with null price", skipped_price_rows
        )
    return {"message": f"My data imported (skipped {skipped_price_rows} invalid price rows)"}
