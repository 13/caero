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

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import PriceHistory

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


async def thin_price_history() -> int:
    """Run one thinning pass. Returns the number of deleted rows."""
    days = settings.price_history_thin_after_days
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
