"""Settings router."""
from __future__ import annotations

import logging
from decimal import Decimal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Alert, AppSettings, PriceHistory, Product, User
from app.routers.auth import require_admin, require_user
from app.schemas import (
    AppSettingsIn,
    AppSettingsOut,
    DataExportPayload,
    TestDbRequest,
    TestDbResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


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
                email=alert["email"],
                active=alert.get("active", True),
            )
        )

    await db.flush()
    return {"message": "Data imported"}
