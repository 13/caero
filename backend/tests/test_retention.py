from datetime import datetime
from decimal import Decimal

from app.retention import select_ids_to_delete


def _row(row_id: int, product_id: int, price: str, day: int, hour: int = 0):
    return (row_id, product_id, Decimal(price), datetime(2026, 1, day, hour))


def test_keeps_daily_min_and_max():
    rows = [
        _row(1, 1, "10.00", 1, 8),   # daily min
        _row(2, 1, "12.00", 1, 12),  # middle → delete
        _row(3, 1, "15.00", 1, 18),  # daily max
    ]
    assert select_ids_to_delete(rows) == [2]


def test_single_row_per_day_kept():
    rows = [_row(1, 1, "10.00", 1)]
    assert select_ids_to_delete(rows) == []


def test_groups_by_product_and_day():
    rows = [
        _row(1, 1, "10.00", 1),
        _row(2, 1, "20.00", 1),
        _row(3, 2, "10.00", 1),   # different product, same day → kept
        _row(4, 1, "15.00", 2),   # same product, different day → kept
        _row(5, 1, "12.00", 1),   # middle of product 1 / day 1 → delete
    ]
    assert select_ids_to_delete(rows) == [5]


def test_identical_prices_keep_first_and_last():
    rows = [
        _row(1, 1, "10.00", 1, 8),
        _row(2, 1, "10.00", 1, 12),
        _row(3, 1, "10.00", 1, 18),
    ]
    # Price ties break on id: min keeps the earliest row, max the latest.
    assert select_ids_to_delete(rows) == [2]


def test_empty():
    assert select_ids_to_delete([]) == []
