"""Price-history retention: thin old rows to the daily min and max.

With record_all_prices enabled a product accumulates one row per check —
thousands per year. Rows older than the configured horizon lose their
intra-day resolution anyway, so we keep only the lowest and highest price per
product per day and delete the rest.
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.maintenance import load_maintenance_config
from app.models import EventLog, PriceHistory

logger = logging.getLogger(__name__)


def select_ids_to_delete(
    rows: list[tuple[int, int, Decimal, datetime]],
) -> list[int]:
    """Given (id, product_id, price, scraped_at) rows, return ids that are
    neither the daily minimum nor the daily maximum of their product/day."""
    keep: set[int] = set()
    groups: dict[tuple[int, date], list[tuple[int, Decimal]]] = {}
    for row_id, product_id, price, scraped_at in rows:
        groups.setdefault((product_id, scraped_at.date()), []).append((row_id, price))

    for day_rows in groups.values():
        min_id = min(day_rows, key=lambda r: (r[1], r[0]))[0]
        max_id = max(day_rows, key=lambda r: (r[1], r[0]))[0]
        keep.add(min_id)
        keep.add(max_id)

    return [row_id for row_id, _, _, _ in rows if row_id not in keep]


async def thin_price_history(days: int | None = None) -> int:
    """Run one thinning pass. Returns the number of deleted rows.

    days defaults to the effective PRICE_HISTORY_THIN_AFTER_DAYS (app.maintenance).
    """
    if days is None:
        days = (await load_maintenance_config()).price_history_thin_after_days
    if days <= 0:
        return 0

    cutoff = datetime.now(UTC) - timedelta(days=days)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(
                PriceHistory.id,
                PriceHistory.product_id,
                PriceHistory.price,
                PriceHistory.scraped_at,
            ).where(PriceHistory.scraped_at < cutoff)
        )
        rows = [tuple(row) for row in result.all()]
        if not rows:
            return 0

        to_delete = select_ids_to_delete(rows)
        if not to_delete:
            return 0

        # Chunked delete keeps the parameter list bounded on both backends.
        for i in range(0, len(to_delete), 500):
            chunk = to_delete[i:i + 500]
            await db.execute(delete(PriceHistory).where(PriceHistory.id.in_(chunk)))
        await db.commit()

    logger.info("Thinned price history: deleted %d row(s) older than %d days", len(to_delete), days)
    return len(to_delete)


async def prune_event_log(days: int | None = None) -> int:
    """Delete event-log rows older than the effective EVENT_LOG_RETENTION_DAYS
    (or days, when given). Returns the count."""
    if days is None:
        days = (await load_maintenance_config()).event_log_retention_days
    if days <= 0:
        return 0

    cutoff = datetime.now(UTC) - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(select(EventLog.id).where(EventLog.created_at < cutoff))).scalars().all()
        for i in range(0, len(ids), 500):
            await db.execute(delete(EventLog).where(EventLog.id.in_(ids[i:i + 500])))
        await db.commit()

    if ids:
        logger.info("Pruned %d event-log row(s) older than %d days", len(ids), days)
    return len(ids)


async def run_nightly_retention() -> None:
    """Nightly cron entry: thin price history, prune the event log, log the result."""
    from app.events import record_event

    try:
        config = await load_maintenance_config()
        price_rows = await thin_price_history(config.price_history_thin_after_days)
        events_deleted = await prune_event_log(config.event_log_retention_days)
    except Exception as exc:
        logger.exception("Nightly retention failed")
        await record_event(
            level="error",
            category="maintenance",
            event="retention",
            message=f"Retention failed: {exc}",
        )
        return

    await record_event(
        level="info",
        category="maintenance",
        event="retention",
        message=f"Retention finished: {price_rows} price rows thinned, {events_deleted} events pruned",
        details={"price_rows_deleted": price_rows, "events_deleted": events_deleted},
    )
