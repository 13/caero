from __future__ import annotations

import re
from datetime import datetime, timedelta

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
    """Compute the next run time anchored to HH:mm in the server's local timezone."""
    current = now or datetime.now().astimezone()

    hhmm = normalize_check_time_hhmm(check_time_hhmm)
    hour, minute = map(int, hhmm.split(":"))

    candidate = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= current:
        candidate += timedelta(days=1)
    return candidate


def jitter_window_seconds(
    base_seconds: int,
    cohort_size: int,
    seconds_per_product: int,
    max_seconds: int | None = None,
) -> int:
    """Width of the random offset window for a product's next run.

    A fixed window stops working once enough products share a check time: N jobs
    over a constant window fire every window/N seconds, which for a large N is
    far faster than a scrape completes, so everything queues on the scrape
    semaphore anyway. Scaling the window with the cohort keeps the spacing
    roughly constant as products are added.

    max_seconds caps the window (the caller passes the product's own check
    interval — jittering past the next run makes no sense).
    """
    if base_seconds <= 0:
        return 0

    window = max(base_seconds, max(cohort_size, 1) * max(seconds_per_product, 0))
    if max_seconds is not None:
        window = min(window, max(max_seconds, 0))
    return window

