from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.stats import time_weighted_average

NOW = datetime(2026, 7, 1, tzinfo=UTC)


def _pt(price: str, days_ago: int) -> tuple[Decimal, datetime]:
    return Decimal(price), NOW - timedelta(days=days_ago)


def test_empty():
    assert time_weighted_average([], NOW) is None


def test_single_point():
    assert time_weighted_average([_pt("10.00", 5)], NOW) == Decimal("10.00")


def test_stable_price_dominates():
    # 10.00 for 9 days, then 100.00 for 1 day → far closer to 10 than a row mean (55)
    points = [_pt("10.00", 10), _pt("100.00", 1)]
    result = time_weighted_average(points, NOW)
    assert result == Decimal("19.00")


def test_equal_durations():
    points = [_pt("10.00", 2), _pt("20.00", 1)]
    assert time_weighted_average(points, NOW) == Decimal("15.00")


def test_identical_timestamps_falls_back_to_mean():
    points = [_pt("10.00", 0), _pt("20.00", 0)]
    assert time_weighted_average(points, NOW) == Decimal("15.00")


def test_naive_timestamps_accepted():
    naive = [
        (Decimal("10.00"), datetime(2026, 6, 29)),
        (Decimal("20.00"), datetime(2026, 6, 30)),
    ]
    assert time_weighted_average(naive, NOW) == Decimal("15.00")
