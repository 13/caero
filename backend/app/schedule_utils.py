from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re

DEFAULT_CHECK_TIME_HHMM = "10:00"
CHECK_TIME_HHMM_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def normalize_check_time_hhmm(value: object | None) -> str:
    """Return a valid HH:mm time string or the default time."""
    if value is None:
        return DEFAULT_CHECK_TIME_HHMM

    text = str(value).strip()
    if not text:
        return DEFAULT_CHECK_TIME_HHMM

    if not CHECK_TIME_HHMM_RE.fullmatch(text):
        raise ValueError("check_time_hhmm must be in HH:mm format")

    return text


def get_next_run_time(check_time_hhmm: object | None, now: datetime | None = None) -> datetime:
    """Compute the next UTC run time for a daily check anchored to HH:mm."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    hhmm = normalize_check_time_hhmm(check_time_hhmm)
    hour, minute = map(int, hhmm.split(":"))

    candidate = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= current:
        candidate += timedelta(days=1)
    return candidate

