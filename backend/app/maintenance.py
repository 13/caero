"""Nightly maintenance configuration: which jobs run, when, and what they keep.

On/off and run times live in AppSettings. The keep/retention knobs are
AppSettings columns too, but NULL there means "use the env var" (BACKUP_KEEP,
PRICE_HISTORY_THIN_AFTER_DAYS, EVENT_LOG_RETENTION_DAYS), so existing .env
setups keep working until an admin overrides them in the UI.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from app.config import settings
from app.database import AsyncSessionLocal
from app.schedule_utils import CHECK_TIME_HHMM_RE

if TYPE_CHECKING:
    from app.models import AppSettings

logger = logging.getLogger(__name__)

MaintenanceKey = Literal["backup", "retention"]
DEFAULT_TIMES: dict[str, str] = {"backup": "03:30", "retention": "04:00"}
# AppSettings column → env fallback (app.config.Settings attribute of the same name).
OVERRIDABLE_KNOBS = ("backup_keep", "price_history_thin_after_days", "event_log_retention_days")


@dataclass(frozen=True)
class MaintenanceConfig:
    backup_enabled: bool
    backup_time: str
    retention_enabled: bool
    retention_time: str
    backup_keep: int
    price_history_thin_after_days: int
    event_log_retention_days: int

    def enabled(self, key: MaintenanceKey) -> bool:
        return getattr(self, f"{key}_enabled")

    def time(self, key: MaintenanceKey) -> str:
        return getattr(self, f"{key}_time")

    def noop_reason(self, key: MaintenanceKey) -> str | None:
        """Why an enabled job would do nothing, or None if it does work."""
        if key == "backup" and self.backup_keep <= 0:
            return "Backups to keep is 0"
        if key == "retention" and self.price_history_thin_after_days <= 0 and self.event_log_retention_days <= 0:
            return "Price-history thinning and event-log pruning are both off"
        return None


def valid_hhmm(value: object) -> bool:
    return isinstance(value, str) and bool(CHECK_TIME_HHMM_RE.fullmatch(value))


def _time(row: AppSettings | None, key: str) -> str:
    value = getattr(row, f"{key}_time", None)
    if value is None or valid_hhmm(value):
        return value or DEFAULT_TIMES[key]
    # Only reachable via a hand-edited DB; never let it take startup down.
    logger.warning("Invalid %s_time %r in app_settings; using %s", key, value, DEFAULT_TIMES[key])
    return DEFAULT_TIMES[key]


def config_from_row(row: AppSettings | None) -> MaintenanceConfig:
    def knob(name: str) -> int:
        value = getattr(row, name, None)
        return getattr(settings, name) if value is None else value

    return MaintenanceConfig(
        backup_enabled=getattr(row, "backup_enabled", True) is not False,
        backup_time=_time(row, "backup"),
        retention_enabled=getattr(row, "retention_enabled", True) is not False,
        retention_time=_time(row, "retention"),
        backup_keep=knob("backup_keep"),
        price_history_thin_after_days=knob("price_history_thin_after_days"),
        event_log_retention_days=knob("event_log_retention_days"),
    )


async def load_maintenance_config() -> MaintenanceConfig:
    """Current config from the DB in its own short session (env defaults on error)."""
    from app.models import AppSettings

    try:
        async with AsyncSessionLocal() as db:
            row = await db.get(AppSettings, 1)
    except Exception as exc:
        logger.warning("Could not load maintenance settings from DB: %s", exc)
        row = None
    return config_from_row(row)
