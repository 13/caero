from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schedule_utils import get_next_run_time, normalize_check_time_hhmm
from app.scheduler import _urls_same_resource, evaluate_alert


class TestEvaluateAlert:
    def test_below_triggers_at_threshold(self):
        assert evaluate_alert("below", Decimal("10"), Decimal("10"), None) is True

    def test_below_triggers_on_crossing(self):
        assert evaluate_alert("below", Decimal("10"), Decimal("9.99"), Decimal("11"))

    def test_below_does_not_refire_while_under_threshold(self):
        # Already below last check — no new alert (spam guard).
        assert not evaluate_alert("below", Decimal("10"), Decimal("9.50"), Decimal("9.99"))

    def test_below_not_above_threshold(self):
        assert not evaluate_alert("below", Decimal("10"), Decimal("10.01"), None)

    def test_below_without_threshold_never_fires(self):
        assert not evaluate_alert("below", None, Decimal("1"), None)

    def test_lowered(self):
        assert evaluate_alert("lowered", None, Decimal("9"), Decimal("10"))
        assert not evaluate_alert("lowered", None, Decimal("11"), Decimal("10"))
        assert not evaluate_alert("lowered", None, Decimal("9"), None)

    def test_changed(self):
        assert evaluate_alert("changed", None, Decimal("9"), Decimal("10"))
        assert evaluate_alert("any_change", None, Decimal("11"), Decimal("10"))
        assert not evaluate_alert("changed", None, Decimal("10"), Decimal("10"))
        assert not evaluate_alert("changed", None, Decimal("10"), None)

    def test_unknown_condition(self):
        assert not evaluate_alert("bogus", None, Decimal("1"), Decimal("2"))

    def test_lowered_percent_fires_at_threshold(self):
        # 100 → 90 = exactly 10%
        assert evaluate_alert("lowered_percent", None, Decimal("90"), Decimal("100"), Decimal("10"))

    def test_lowered_percent_below_threshold(self):
        # 100 → 95 = 5% < 10%
        assert not evaluate_alert("lowered_percent", None, Decimal("95"), Decimal("100"), Decimal("10"))

    def test_lowered_percent_needs_prev(self):
        assert not evaluate_alert("lowered_percent", None, Decimal("90"), None, Decimal("10"))

    def test_lowered_percent_ignores_increase(self):
        assert not evaluate_alert("lowered_percent", None, Decimal("110"), Decimal("100"), Decimal("10"))

    def test_lowered_percent_without_threshold_never_fires(self):
        assert not evaluate_alert("lowered_percent", None, Decimal("50"), Decimal("100"), None)


class TestUrlsSameResource:
    def test_same_url(self):
        assert _urls_same_resource("https://a.com/x", "https://a.com/x")

    def test_query_ignored(self):
        assert _urls_same_resource("https://a.com/x?ref=1", "https://a.com/x?ref=2")

    def test_trailing_slash_ignored(self):
        assert _urls_same_resource("https://a.com/x/", "https://a.com/x")

    def test_case_insensitive(self):
        assert _urls_same_resource("https://A.com/X", "https://a.com/x")

    def test_different_path(self):
        assert not _urls_same_resource("https://a.com/x", "https://a.com/y")

    def test_different_host(self):
        assert not _urls_same_resource("https://a.com/x", "https://b.com/x")

    def test_unparseable_falls_back_to_exact_match(self):
        # Ports out of range make urlparse raise ValueError on .netloc access
        bad = "https://a.com:99999999/x"
        assert _urls_same_resource(bad, bad)
        assert not _urls_same_resource(bad, "https://a.com:99999998/x")


class TestScheduleUtils:
    def test_normalize_valid(self):
        assert normalize_check_time_hhmm("09:30") == "09:30"

    def test_normalize_none_and_empty_default(self):
        assert normalize_check_time_hhmm(None) == "10:00"
        assert normalize_check_time_hhmm("  ") == "10:00"

    def test_normalize_invalid_raises(self):
        with pytest.raises(ValueError):
            normalize_check_time_hhmm("25:00")
        with pytest.raises(ValueError):
            normalize_check_time_hhmm("9:30")

    def test_next_run_today_if_in_future(self):
        now = datetime(2026, 7, 1, 8, 0, tzinfo=UTC)
        result = get_next_run_time("09:00", now=now)
        assert result == datetime(2026, 7, 1, 9, 0, tzinfo=UTC)

    def test_next_run_tomorrow_if_passed(self):
        now = datetime(2026, 7, 1, 10, 0, tzinfo=UTC)
        result = get_next_run_time("09:00", now=now)
        assert result == datetime(2026, 7, 2, 9, 0, tzinfo=UTC)
