"""Scheduled JSON backups and the shared export payload builder."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Alert, AppSettings, PriceHistory, Product, User

logger = logging.getLogger(__name__)


def _decimal(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


def _isoformat(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def build_export_payload(db: AsyncSession) -> dict:
    """Full-database export used by both the admin export API and backups."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    app_settings = result.scalar_one_or_none()
    users = (await db.execute(select(User))).scalars().all()
    products = (await db.execute(select(Product))).scalars().all()
    price_history = (await db.execute(select(PriceHistory))).scalars().all()
    alerts = (await db.execute(select(Alert))).scalars().all()

    return {
        "app_settings": {
            "id": 1,
            "allow_registration": app_settings.allow_registration if app_settings else True,
            "date_format": app_settings.date_format if app_settings else "DD.MM.YYYY",
            "time_format": app_settings.time_format if app_settings else "24h",
        },
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "hashed_password": user.hashed_password,
                "is_admin": user.is_admin,
                "created_at": _isoformat(user.created_at),
            }
            for user in users
        ],
        "products": [
            {
                "id": product.id,
                "user_id": product.user_id,
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
                "created_at": _isoformat(product.created_at),
            }
            for product in products
        ],
        "price_history": [
            {
                "id": row.id,
                "product_id": row.product_id,
                "price": _decimal(row.price),
                "currency": row.currency,
                "scraped_at": _isoformat(row.scraped_at),
            }
            for row in price_history
        ],
        "alerts": [
            {
                "id": alert.id,
                "product_id": alert.product_id,
                "condition": alert.condition,
                "threshold_price": _decimal(alert.threshold_price),
                "threshold_percent": _decimal(alert.threshold_percent),
                "email": alert.email,
                "telegram_chat_id": alert.telegram_chat_id,
                "active": alert.active,
            }
            for alert in alerts
        ],
    }


def get_backups_dir() -> Path:
    # Live next to the SQLite DB (same convention as user_images); on
    # PostgreSQL deployments /data is still the mounted volume.
    sqlite_path = Path(settings.sqlite_path)
    if sqlite_path.parent.exists() and sqlite_path.parent.is_dir():
        backups_dir = sqlite_path.parent / "backups"
    else:
        backups_dir = Path("data/backups")
    backups_dir.mkdir(parents=True, exist_ok=True)
    return backups_dir


def _rotate_backups(backups_dir: Path, keep: int) -> None:
    files = sorted(backups_dir.glob("caero-backup-*.json"))
    for old in files[:-keep] if keep else files:
        try:
            old.unlink()
            logger.info("Removed old backup %s", old.name)
        except OSError as exc:
            logger.warning("Could not remove old backup %s: %s", old, exc)


async def run_backup() -> Path | None:
    """Write one full-export backup file and rotate old ones."""
    if settings.backup_keep <= 0:
        return None

    async with AsyncSessionLocal() as db:
        payload = await build_export_payload(db)

    backups_dir = get_backups_dir()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = backups_dir / f"caero-backup-{stamp}.json"
    counter = 1
    while target.exists():
        target = backups_dir / f"caero-backup-{stamp}-{counter}.json"
        counter += 1
    target.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    logger.info("Backup written: %s", target)

    _rotate_backups(backups_dir, settings.backup_keep)
    return target
