"""Structured operational event log (admin Settings → Logs).

Separate from Python logging on purpose: rows are typed (level/category/event
code), linked to a product and filterable, and they survive restarts. Two ways
in:

- log_event(db, …) adds a row to the caller's session. The scrape path uses it
  so an event commits atomically with the writes it describes.
- record_event(…) / spawn_event(…) for callers without a session. They never
  raise: logging an event must not break a scrape or a notification.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal, get_args

from sqlalchemy import event as sa_event

from app.database import AsyncSessionLocal
from app.models import EventLog, Product

logger = logging.getLogger(__name__)

EventLevel = Literal["info", "warning", "error"]
EventCategory = Literal["scrape", "alert", "notification", "system", "maintenance"]
LEVELS: tuple[str, ...] = get_args(EventLevel)
CATEGORIES: tuple[str, ...] = get_args(EventCategory)

# Events that describe the outcome of one scrape run (Schedulers "last result").
SCRAPE_RESULT_EVENTS: tuple[str, ...] = ("scrape_ok", "scrape_unchanged", "scrape_failed", "scrape_skipped")

MAX_MESSAGE_LENGTH = 1000


def _json_safe(value: Any) -> Any:
    # A raw Decimal in a JSON column fails at commit — on the scrape path that
    # would roll back the price row too.
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _build(
    *,
    level: str,
    category: str,
    event: str,
    message: str,
    product: Product | None = None,
    product_id: int | None = None,
    product_name: str | None = None,
    duration_ms: int | None = None,
    details: dict[str, Any] | None = None,
) -> EventLog:
    if level not in LEVELS:
        raise ValueError(f"unknown event level {level!r}")
    if category not in CATEGORIES:
        raise ValueError(f"unknown event category {category!r}")
    if product is not None:
        product_id, product_name = product.id, product.name
    return EventLog(
        created_at=datetime.now(UTC),
        level=level,
        category=category,
        event=event[:40],
        product_id=product_id,
        product_name=product_name[:256] if product_name else None,
        message=message[:MAX_MESSAGE_LENGTH],
        duration_ms=duration_ms,
        details=_json_safe(details) if details else None,
    )


def log_event(db, **kwargs: Any) -> None:
    """Add an event to the caller's session (no flush/commit)."""
    db.add(_build(**kwargs))


async def record_event(**kwargs: Any) -> None:
    """Persist one event in its own short session. Never raises."""
    try:
        async with AsyncSessionLocal() as db:
            log_event(db, **kwargs)
            await db.commit()
    except Exception:
        logger.exception("Could not record event %s", kwargs.get("event"))


_pending: set[asyncio.Task] = set()

# Event loop bound by the FastAPI lifespan (app.main), so spawn_event can
# schedule work from threads that have no running loop of their own — e.g.
# email delivery bookkeeping inside asyncio.to_thread(...).
_loop: asyncio.AbstractEventLoop | None = None


def bind_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def _start_task(loop: asyncio.AbstractEventLoop, kwargs: dict[str, Any]) -> None:
    task = loop.create_task(record_event(**kwargs))
    _pending.add(task)  # keep a reference until done, or the task can be GC'd
    task.add_done_callback(_pending.discard)


def spawn_event(**kwargs: Any) -> None:
    """record_event for synchronous callers (APScheduler listeners, notifier
    status bookkeeping). Dropped with a log line when no loop is running or
    bound."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        _start_task(loop, kwargs)
        return

    if _loop is not None and not _loop.is_closed():
        # No loop running in this thread (e.g. inside asyncio.to_thread) —
        # schedule onto the loop bound at startup instead of dropping the event.
        _loop.call_soon_threadsafe(_start_task, _loop, kwargs)
        return

    logger.warning("No event loop — dropping event %s", kwargs.get("event"))


async def drain_pending_events() -> None:
    """Wait for spawned events (tests, shutdown)."""
    # Let callbacks scheduled from other threads via call_soon_threadsafe run
    # before we snapshot _pending, or a just-spawned task can be missed.
    await asyncio.sleep(0)
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


@sa_event.listens_for(Product, "before_delete")
def _detach_product_events(_mapper, connection, target: Product) -> None:
    # SQLite has no FK enforcement here, so ON DELETE SET NULL never fires; a
    # reused product id would otherwise inherit the old product's events.
    connection.execute(
        EventLog.__table__.update()
        .where(EventLog.__table__.c.product_id == target.id)
        .values(product_id=None)
    )
