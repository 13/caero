"""Statistics helpers for price history."""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal


def _aware(dt: datetime) -> datetime:
    # SQLite returns naive datetimes even for timezone=True columns.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def time_weighted_average(
    points: list[tuple[Decimal, datetime]], now: datetime
) -> Decimal | None:
    """Average price weighted by how long each price was in effect.

    Price rows are only recorded on change, so a plain row average is biased
    toward volatile periods. Each price counts from its timestamp until the
    next record (the last one until `now`).
    """
    if not points:
        return None
    if len(points) == 1:
        return Decimal(points[0][0]).quantize(Decimal("0.01"))

    now = _aware(now)
    total_weight = Decimal(0)
    weighted_sum = Decimal(0)
    for i, (price, ts) in enumerate(points):
        end = _aware(points[i + 1][1]) if i + 1 < len(points) else now
        seconds = Decimal(max((end - _aware(ts)).total_seconds(), 0))
        weighted_sum += Decimal(price) * seconds
        total_weight += seconds

    if total_weight == 0:
        # All records share a timestamp — fall back to a simple mean.
        mean = sum(Decimal(p) for p, _ in points) / len(points)
        return mean.quantize(Decimal("0.01"))

    return (weighted_sum / total_weight).quantize(Decimal("0.01"))
