# Settings Tabs: About, Schedulers, Logs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Settings into Account · Schedulers · Logs · Admin · About tabs, with an enriched scheduler job list ("Run now") and a persistent, filterable admin event log of scrapes, alerts, notification failures and system/maintenance events.

**Architecture:** A new `event_log` table (migration 0023) is written through `app/events.py` — `log_event()` joins the caller's session (scrape path, atomic with its writes), `record_event()`/`spawn_event()` use their own short session and never raise. The scheduler, scraper, browser, notifier, backup and retention modules emit typed events; two admin endpoints (`/api/settings/logs`, enriched `/api/settings/jobs` + `/run`) serve them. The frontend puts the active tab and log filters in the URL and renders new `SchedulersTab`/`LogsTab` components.

**Tech Stack:** FastAPI, async SQLAlchemy 2, Alembic, APScheduler 3, pytest (SQLite + PostgreSQL in CI); React 19, TanStack Query 5, react-router-dom, Tailwind 4, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-settings-tabs-logs-design.md`

## Global Constraints

- Work on branch `feat/settings-tabs-logs` (create it from `main` before Task 1: `git checkout -b feat/settings-tabs-logs`).
- Backend commands run in `backend/` via `uv run …`; frontend commands in `frontend/` via `npm …`.
- Every `models.py` change ships with a hand-written migration `alembic/versions/00NN_description.py` (`revision = "0023"`, `down_revision = "0022"`). No `create_all`.
- Endpoints inject `db: AsyncSession = Depends(get_db, scope="function")` and never call `commit()`; background code with its own session commits.
- Never hold a DB session across a scrape (`scrape_price` call).
- Tests must pass on SQLite **and** PostgreSQL (`DB_TYPE=postgresql` in CI). The test DB is shared across the session: filter by your own product id / unique marker, never assert global counts.
- Admin-only endpoints use `Depends(require_admin)`.
- Event levels: `info | warning | error`. Categories: `scrape | alert | notification | system | maintenance`.
- `EVENT_LOG_RETENTION_DAYS` default `30`; `0` = keep forever.
- Event log is excluded from backup/export.
- Lint must stay clean: `uv run ruff check app tests`, `npm run lint`.
- Commit messages: short, lowercase, ending with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Non-JSON values in event `details`** (a `Decimal` price, a `datetime`) — expected: stored as strings; the scrape's price row still commits. Test: Task 1 `test_record_event_serialises_decimal_and_datetime`, Task 3 `test_scrape_events_changed_then_unchanged` asserts `details["price"] == "10.00"`.
2. **Product deleted while events reference it, on SQLite (no FK enforcement)** — expected: events keep `product_name`, `product_id` becomes NULL, so a later product reusing the id does not inherit them. Test: Task 1 `test_deleting_product_detaches_events`.
3. **New events arriving while an admin pages through Logs** — expected: page 2 neither repeats nor skips rows from page 1. Test: Task 5 `test_keyset_pagination_stable_under_inserts`.
4. **"Run now" on a product job** — expected: the product's regular next run time is unchanged (no drift away from its check time). Test: Task 6 `test_run_now_queues_one_off_and_keeps_schedule`.
5. **Non-admin opening `/setup?tab=logs` or a garbage `?tab=`** — expected: lands on Account, no admin UI flashes. Test: Task 7 `settingsTabs.test.ts` (extended in Task 9).

---

### Task 1: Event log model, migration and writer

**Files:**
- Modify: `backend/app/models.py` (imports; new `EventLog` class at end)
- Create: `backend/alembic/versions/0023_add_event_log.py`
- Create: `backend/app/events.py`
- Test: `backend/tests/test_events.py`

**Interfaces:**
- Produces:
  - `app.models.EventLog` (columns per spec §2)
  - `app.events.EventLevel = Literal["info","warning","error"]`, `EventCategory = Literal["scrape","alert","notification","system","maintenance"]`, `LEVELS`, `CATEGORIES` (tuples), `SCRAPE_RESULT_EVENTS: tuple[str, ...] = ("scrape_ok","scrape_unchanged","scrape_failed","scrape_skipped")`
  - `log_event(db, *, level, category, event, message, product=None, product_id=None, product_name=None, duration_ms=None, details=None) -> None`
  - `async record_event(**same kwargs) -> None` (never raises)
  - `spawn_event(**same kwargs) -> None` (fire-and-forget from sync code)
  - `async drain_pending_events() -> None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_events.py`:

```python
"""Event log writer: persistence, JSON safety, failure isolation, product detach."""
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

import app.events as events
from app.database import AsyncSessionLocal, run_migrations
from app.models import EventLog, Product, User


async def make_product(username: str) -> int:
    await run_migrations()
    async with AsyncSessionLocal() as db:
        user = User(username=username, hashed_password="x")
        db.add(user)
        await db.flush()
        product = Product(user_id=user.id, name=f"P-{username}", url="https://shop.example/x", selector=".p")
        db.add(product)
        await db.commit()
        return product.id


async def events_where(**filters) -> list[EventLog]:
    async with AsyncSessionLocal() as db:
        stmt = select(EventLog).filter_by(**filters).order_by(EventLog.id)
        return list((await db.execute(stmt)).scalars().all())


@pytest.mark.asyncio(loop_scope="session")
async def test_record_event_persists_with_product_snapshot():
    pid = await make_product("ev-persist")
    async with AsyncSessionLocal() as db:
        product = await db.get(Product, pid)
    await events.record_event(
        level="info", category="scrape", event="scrape_ok", message="hello", product=product, duration_ms=12
    )
    [row] = await events_where(product_id=pid)
    assert (row.level, row.category, row.event, row.message) == ("info", "scrape", "scrape_ok", "hello")
    assert row.product_name == "P-ev-persist"
    assert row.duration_ms == 12
    assert row.created_at is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_record_event_serialises_decimal_and_datetime():
    pid = await make_product("ev-json")
    when = datetime(2026, 1, 2, 3, 4, tzinfo=UTC)
    await events.record_event(
        level="info", category="scrape", event="scrape_ok", message="m", product_id=pid,
        details={"price": Decimal("10.00"), "at": when, "nested": {"p": Decimal("1.5")}, "items": (1, 2)},
    )
    [row] = await events_where(product_id=pid)
    assert row.details == {"price": "10.00", "at": when.isoformat(), "nested": {"p": "1.5"}, "items": [1, 2]}


@pytest.mark.asyncio(loop_scope="session")
async def test_message_is_truncated():
    pid = await make_product("ev-trunc")
    await events.record_event(level="info", category="system", event="x", message="a" * 5000, product_id=pid)
    [row] = await events_where(product_id=pid)
    assert len(row.message) == events.MAX_MESSAGE_LENGTH


def test_log_event_rejects_unknown_level_and_category():
    class NoDb:
        def add(self, _):
            raise AssertionError("must validate before adding")

    with pytest.raises(ValueError):
        events.log_event(NoDb(), level="debug", category="scrape", event="x", message="m")
    with pytest.raises(ValueError):
        events.log_event(NoDb(), level="info", category="nope", event="x", message="m")


@pytest.mark.asyncio(loop_scope="session")
async def test_record_event_swallows_db_failure(monkeypatch):
    def broken_session():
        raise RuntimeError("db down")

    monkeypatch.setattr(events, "AsyncSessionLocal", broken_session)
    # Must not raise.
    await events.record_event(level="error", category="system", event="x", message="m")


@pytest.mark.asyncio(loop_scope="session")
async def test_spawn_event_records_after_drain():
    pid = await make_product("ev-spawn")
    events.spawn_event(level="warning", category="system", event="spawned", message="m", product_id=pid)
    await events.drain_pending_events()
    [row] = await events_where(product_id=pid)
    assert row.event == "spawned"


@pytest.mark.asyncio(loop_scope="session")
async def test_deleting_product_detaches_events():
    pid = await make_product("ev-detach")
    await events.record_event(level="info", category="scrape", event="scrape_ok", message="m", product_id=pid,
                              product_name="P-ev-detach")
    async with AsyncSessionLocal() as db:
        await db.delete(await db.get(Product, pid))
        await db.commit()

    assert await events_where(product_id=pid) == []
    rows = await events_where(product_name="P-ev-detach")
    assert len(rows) == 1
    assert rows[0].product_id is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_events.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.events'` / `ImportError: cannot import name 'EventLog'`.

- [ ] **Step 3: Add the model**

In `backend/app/models.py`, add `JSON` to the `sqlalchemy` import list (alphabetically after `Integer`), then append:

```python
class EventLog(Base):
    """Operational event (scrape outcome, alert, delivery failure, …) for the
    admin Logs tab. Written via app.events; pruned by EVENT_LOG_RETENTION_DAYS."""

    __tablename__ = "event_log"
    __table_args__ = (
        Index("ix_event_log_product_created", "product_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    # SET NULL only fires on PostgreSQL (SQLite runs without foreign_keys);
    # app.events detaches rows on ORM product deletes for both backends.
    product_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot so rows stay readable after the product is deleted.
    product_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

- [ ] **Step 4: Add the migration**

Create `backend/alembic/versions/0023_add_event_log.py`:

```python
"""Add event_log — operational events for the admin Logs tab.

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_name", sa.String(256), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
    )
    op.create_index("ix_event_log_created_at", "event_log", ["created_at"])
    op.create_index("ix_event_log_product_created", "event_log", ["product_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_event_log_product_created", table_name="event_log")
    op.drop_index("ix_event_log_created_at", table_name="event_log")
    op.drop_table("event_log")
```

- [ ] **Step 5: Write `app/events.py`**

```python
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


def spawn_event(**kwargs: Any) -> None:
    """record_event for synchronous callers (APScheduler listeners, notifier
    status bookkeeping). Dropped with a log line when no loop is running."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No event loop — dropping event %s", kwargs.get("event"))
        return
    task = loop.create_task(record_event(**kwargs))
    _pending.add(task)  # keep a reference until done, or the task can be GC'd
    task.add_done_callback(_pending.discard)


async def drain_pending_events() -> None:
    """Wait for spawned events (tests, shutdown)."""
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
```

The listener only registers once `app.events` is imported. Make sure it always is: in `backend/app/database.py` there is nothing to change, but add `import app.events  # noqa: F401  — registers the product-delete listener` to `backend/app/main.py` directly below the `from app.scheduler import load_all_jobs, scheduler` line (Task 3 imports it from the scheduler as well, which makes this belt-and-braces for tools/tests that don't import `main`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_events.py tests/test_migrations.py -v`
Expected: PASS (all).

- [ ] **Step 7: Lint and commit**

```bash
cd backend && uv run ruff check app tests
git add app/models.py app/events.py app/main.py alembic/versions/0023_add_event_log.py tests/test_events.py
git commit -m "event log table and writer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scrape failure reason and price source on `ScrapeResult`

**Files:**
- Modify: `backend/app/scraper.py` (dataclass lines 19-23, `scrape_price` 116-134, `_scrape_price` 137-202)
- Test: `backend/tests/test_scraper_result.py`

**Interfaces:**
- Produces: `ScrapeResult(price, currency, final_url, error: str | None = None, source: str | None = None, error_detail: str | None = None)`; constants `ERROR_TIMEOUT="timeout"`, `ERROR_NAVIGATION="navigation"`, `ERROR_UNAVAILABLE="unavailable"`, `ERROR_NO_MATCH="no_match"`; sources `"selector" | "ld_json" | "itemprop" | "data_price"`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_scraper_result.py`:

```python
"""ScrapeResult carries why a scrape failed and which strategy found the price."""
import asyncio
import json

import pytest

import app.scraper as scraper


class FakeElement:
    def __init__(self, text: str | None):
        self._text = text
        self.first = self

    async def count(self):
        return 0 if self._text is None else 1

    async def inner_text(self):
        return self._text

    async def get_attribute(self, _name):
        return None


class FakePage:
    def __init__(self, *, selector_text=None, ld_json=None, availability=None, goto_error=None):
        self.selector_text = selector_text
        self.ld_json = ld_json
        self.availability = availability
        self.goto_error = goto_error
        self.url = "https://shop.example/item"

    async def goto(self, url, **_kw):
        if self.goto_error:
            raise self.goto_error

    async def wait_for_timeout(self, _ms):
        return None

    async def wait_for_selector(self, _selector, timeout=None):
        if self.selector_text is None:
            raise TimeoutError("no element")

    def locator(self, _selector):
        return FakeElement(self.selector_text)

    async def query_selector(self, selector):
        if selector == "#availability" and self.availability:
            return FakeElement(self.availability)
        return None

    async def query_selector_all(self, selector):
        if "ld+json" in selector and self.ld_json is not None:
            return [FakeElement(json.dumps(self.ld_json))]
        return []

    async def evaluate(self, _js):
        return self.url

    async def close(self):
        return None


class FakeContext:
    def __init__(self, page):
        self.page = page

    async def new_page(self):
        return self.page

    async def close(self):
        return None


class FakeBrowser:
    def __init__(self, page):
        self.page = page

    async def new_context(self, **_kw):
        return FakeContext(self.page)


async def scrape(page: FakePage) -> scraper.ScrapeResult:
    return await scraper.scrape_price(FakeBrowser(page), "https://shop.example/item", ".price")


@pytest.mark.asyncio(loop_scope="session")
async def test_selector_hit_reports_selector_source():
    result = await scrape(FakePage(selector_text="19.99 €"))
    assert result.price == 19.99
    assert result.source == "selector"
    assert result.error is None


@pytest.mark.asyncio(loop_scope="session")
async def test_ld_json_fallback_reports_its_source():
    page = FakePage(ld_json={"offers": {"price": "5.50", "priceCurrency": "EUR"}})
    result = await scrape(page)
    assert result.price == 5.5
    assert result.source == "ld_json"


@pytest.mark.asyncio(loop_scope="session")
async def test_nothing_found_is_no_match():
    result = await scrape(FakePage())
    assert result.price is None
    assert result.error == scraper.ERROR_NO_MATCH
    assert result.source is None


@pytest.mark.asyncio(loop_scope="session")
async def test_unavailable_page():
    result = await scrape(FakePage(selector_text="9.99", availability="Currently unavailable."))
    assert result.price is None
    assert result.error == scraper.ERROR_UNAVAILABLE


@pytest.mark.asyncio(loop_scope="session")
async def test_navigation_error_keeps_detail():
    result = await scrape(FakePage(goto_error=RuntimeError("net::ERR_NAME_NOT_RESOLVED")))
    assert result.error == scraper.ERROR_NAVIGATION
    assert "ERR_NAME_NOT_RESOLVED" in result.error_detail


@pytest.mark.asyncio(loop_scope="session")
async def test_timeout(monkeypatch):
    async def slow(*_args, **_kw):
        await asyncio.sleep(5)

    monkeypatch.setattr(scraper, "_scrape_price", slow)
    monkeypatch.setattr(scraper.settings, "scrape_timeout_seconds", 0.05)
    result = await scrape(FakePage())
    assert result.error == scraper.ERROR_TIMEOUT


def test_positional_constructor_still_works():
    result = scraper.ScrapeResult(1.0, "EUR", None)
    assert (result.error, result.source, result.error_detail) == (None, None, None)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_scraper_result.py -v`
Expected: FAIL — `AttributeError: 'ScrapeResult' object has no attribute 'source'` / no `ERROR_NO_MATCH`.

- [ ] **Step 3: Implement**

In `backend/app/scraper.py` replace the dataclass with:

```python
ERROR_TIMEOUT = "timeout"
ERROR_NAVIGATION = "navigation"
ERROR_UNAVAILABLE = "unavailable"
ERROR_NO_MATCH = "no_match"


@dataclass
class ScrapeResult:
    price: float | None
    currency: str | None
    final_url: str | None
    # Why no price was found (ERROR_*) — surfaced in the admin event log.
    error: str | None = None
    # Which strategy produced the price: selector | ld_json | itemprop | data_price.
    # A product that only works via a fallback has a silently broken selector.
    source: str | None = None
    error_detail: str | None = None
```

In `scrape_price`, the timeout branch returns:

```python
            return ScrapeResult(None, None, None, error=ERROR_TIMEOUT)
```

In `_scrape_price`:
- unavailable branch: `return ScrapeResult(None, None, await _current_url(page), error=ERROR_UNAVAILABLE)`
- declare `source = None` next to `price = None` / `currency = None`
- primary selector: after `price = parse_price(text, price_format)` add `if price is not None: source = "selector"` (inside the `if await el.count() > 0:` block, after `currency = detect_currency(text)`)
- fallback 1: after `price, currency = await _try_ld_json(page)` add `if price is not None: source = "ld_json"`
- fallback 2: after `price, currency = await _try_itemprop(page)` add `if price is not None: source = "itemprop"`
- fallback 3: after `currency = None` add `if price is not None: source = "data_price"`
- final return:

```python
        return ScrapeResult(
            price,
            currency,
            await _current_url(page),
            error=None if price is not None else ERROR_NO_MATCH,
            source=source,
        )
```

- exception branch:

```python
    except Exception as exc:
        logger.warning("scrape_price failed for %s: %s", url, exc)
        return ScrapeResult(None, None, None, error=ERROR_NAVIGATION, error_detail=str(exc)[:300])
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_scraper_result.py tests/test_scrape_flow.py tests/test_stability.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && uv run ruff check app tests
git add app/scraper.py tests/test_scraper_result.py
git commit -m "scraper: report failure reason and price source

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scrape-path events (scheduled, check-all, manual check)

**Files:**
- Modify: `backend/app/scheduler.py` (imports; `check_url_redirect` 183-207; `scrape_and_record` 210-218; `run_check_all` 225-246; `_scrape_and_record_locked` 249-430)
- Modify: `backend/app/routers/products.py` (`check_product_now` 361-407; add `import time`)
- Test: `backend/tests/test_scrape_flow.py` (append)

**Interfaces:**
- Consumes: `log_event`, `record_event` (Task 1); `ScrapeResult.error/source/error_detail` (Task 2).
- Produces:
  - `scrape_and_record(product_id) -> str | None` — outcome `"ok" | "unchanged" | "failed" | "skipped"`, `None` if product missing/inactive.
  - `log_scrape_success(db, product, *, price, prev_price, currency, changed, source, duration_ms, manual=False) -> None`
  - `log_scrape_failure(db, product, result, *, duration_ms, manual=False) -> None`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_scrape_flow.py` (add `from app.models import EventLog` to the model import line):

```python
async def events_for(product_id: int) -> list[EventLog]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(EventLog).where(EventLog.product_id == product_id).order_by(EventLog.id)
        )
        return list(result.scalars().all())


def codes(rows: list[EventLog]) -> list[str]:
    return [r.event for r in rows]


@pytest.mark.asyncio(loop_scope="session")
async def test_scrape_events_changed_then_unchanged(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-ok")
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://shop.example/item", source="selector"))

    assert await scheduler_mod.scrape_and_record(pid) == "ok"
    assert await scheduler_mod.scrape_and_record(pid) == "unchanged"

    rows = await events_for(pid)
    assert codes(rows) == ["scrape_ok", "scrape_unchanged"]
    assert rows[0].level == "info" and rows[0].category == "scrape"
    assert rows[0].details["price"] == "10.00"
    assert rows[0].details["source"] == "selector"
    assert rows[0].duration_ms is not None
    assert rows[0].product_name == "P-ev-flow-ok"


@pytest.mark.asyncio(loop_scope="session")
async def test_record_all_prices_unchanged_is_still_unchanged_event(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-all", record_all_prices=True)
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://shop.example/item"))
    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)
    assert codes(await events_for(pid)) == ["scrape_ok", "scrape_unchanged"]


@pytest.mark.asyncio(loop_scope="session")
async def test_failure_events_threshold_and_recovery(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-fail")
    monkeypatch.setattr(scheduler_mod.settings, "scraper_failure_alert_threshold", 2)
    scrape_returning(monkeypatch, ScrapeResult(None, None, None, error="no_match"))

    assert await scheduler_mod.scrape_and_record(pid) == "failed"
    await scheduler_mod.scrape_and_record(pid)

    rows = await events_for(pid)
    assert codes(rows) == ["scrape_failed", "scrape_failed", "selector_broken"]
    assert rows[0].level == "warning"
    assert rows[0].details["error"] == "no_match"
    assert rows[1].details["consecutive_failures"] == 2
    assert rows[2].level == "error" and rows[2].category == "alert"

    scrape_returning(monkeypatch, ScrapeResult(9.5, "EUR", "https://shop.example/item"))
    await scheduler_mod.scrape_and_record(pid)
    assert codes(await events_for(pid))[-2:] == ["scrape_recovered", "scrape_ok"]


@pytest.mark.asyncio(loop_scope="session")
async def test_redirect_events(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-redirect")
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://other.example/different"))

    assert await scheduler_mod.scrape_and_record(pid) == "skipped"
    await scheduler_mod.scrape_and_record(pid)

    rows = await events_for(pid)
    assert codes(rows) == ["url_redirected", "scrape_skipped", "scrape_skipped"]
    assert rows[0].details == {"from": "https://shop.example/item", "to": "https://other.example/different"}
    assert rows[1].details["reason"] == "redirected"


@pytest.mark.asyncio(loop_scope="session")
async def test_alert_triggered_event(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-alert")
    async with AsyncSessionLocal() as db:
        db.add(Alert(product_id=pid, condition="changed", email="a@example.com"))
        await db.commit()
    scrape_returning(
        monkeypatch,
        ScrapeResult(20.0, "EUR", "https://shop.example/item"),
        ScrapeResult(18.0, "EUR", "https://shop.example/item"),
    )
    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    [alert_event] = [r for r in await events_for(pid) if r.event == "alert_triggered"]
    assert alert_event.category == "alert"
    assert alert_event.details["condition"] == "changed"
    assert alert_event.details["price"] == "18.00"


@pytest.mark.asyncio(loop_scope="session")
async def test_browser_unavailable_is_skipped_event(monkeypatch, sent_notifications):
    pid = await make_product("ev-flow-nobrowser")

    async def no_browser():
        return None

    monkeypatch.setattr(scheduler_mod, "ensure_browser", no_browser)
    assert await scheduler_mod.scrape_and_record(pid) == "skipped"
    [row] = await events_for(pid)
    assert (row.event, row.details["reason"]) == ("scrape_skipped", "browser_unavailable")


@pytest.mark.asyncio(loop_scope="session")
async def test_check_all_event_counts(monkeypatch, sent_notifications):
    ok_pid = await make_product("ev-flow-ca-ok")
    bad_pid = await make_product("ev-flow-ca-bad")
    scrape_returning(
        monkeypatch,
        ScrapeResult(10.0, "EUR", "https://shop.example/item"),
        ScrapeResult(None, None, None, error="timeout"),
    )
    await scheduler_mod.run_check_all([ok_pid, bad_pid])

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(EventLog).where(EventLog.event == "check_all").order_by(EventLog.id.desc()).limit(1)
        )).scalar_one()
    assert row.details == {"total": 2, "ok": 1, "failed": 1, "skipped": 0}


@pytest.mark.asyncio(loop_scope="session")
async def test_manual_check_logs_event(monkeypatch, sent_notifications):
    from app.routers.products import check_product_now

    pid = await make_product("ev-flow-manual")
    scrape_returning(monkeypatch, ScrapeResult(7.0, "EUR", "https://shop.example/item", source="itemprop"))
    async with AsyncSessionLocal() as db:
        product = await db.get(Product, pid)
        user = await db.get(User, product.user_id)
        await check_product_now(pid, user, db)
        await db.commit()

    [row] = await events_for(pid)
    assert row.event == "scrape_ok"
    assert row.details["manual"] is True
    assert row.details["source"] == "itemprop"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_scrape_flow.py -v`
Expected: new tests FAIL (`scrape_and_record` returns `None`, no events); existing tests PASS.

- [ ] **Step 3: Add event helpers to `scheduler.py`**

Add imports near the top of `backend/app/scheduler.py`:

```python
from app.events import log_event, record_event
from app.scraper import ScrapeResult
```

(`app.scraper` imports Patchright at module level; this is already imported transitively in production. If `ruff`/tests complain about import cost, keep it as `from typing import TYPE_CHECKING` + `if TYPE_CHECKING: from app.scraper import ScrapeResult` — only the type is needed.)

Add after `_notify_scraping_recovered`:

```python
def log_scrape_success(
    db,
    product: Product,
    *,
    price: Decimal,
    prev_price: Decimal | None,
    currency: str,
    changed: bool,
    source: str | None,
    duration_ms: int | None,
    manual: bool = False,
) -> None:
    prefix = "Manual check: " if manual else ""
    if changed:
        was = f" (was {format_price(prev_price, currency)})" if prev_price is not None else ""
        message = f"{prefix}Price {format_price(price, currency)}{was}"
    else:
        message = f"{prefix}Price unchanged at {format_price(price, currency)}"
    details = {"price": price, "prev_price": prev_price, "currency": currency, "source": source}
    if manual:
        details["manual"] = True
    log_event(
        db,
        level="info",
        category="scrape",
        event="scrape_ok" if changed else "scrape_unchanged",
        message=message,
        product=product,
        duration_ms=duration_ms,
        details=details,
    )


def log_scrape_failure(
    db, product: Product, result: ScrapeResult, *, duration_ms: int | None, manual: bool = False
) -> None:
    prefix = "Manual check: " if manual else ""
    details = {
        "error": result.error,
        "error_detail": result.error_detail,
        "consecutive_failures": product.consecutive_scrape_failures,
        "url": product.url,
    }
    if manual:
        details["manual"] = True
    log_event(
        db,
        level="warning",
        category="scrape",
        event="scrape_failed",
        message=f"{prefix}No price found ({result.error or 'unknown'})",
        product=product,
        duration_ms=duration_ms,
        details=details,
    )


def log_scrape_skipped(db, product: Product, *, reason: str, message: str, duration_ms: int | None = None) -> None:
    log_event(
        db,
        level="warning",
        category="scrape",
        event="scrape_skipped",
        message=message,
        product=product,
        duration_ms=duration_ms,
        details={"reason": reason},
    )
```

- [ ] **Step 4: Emit `url_redirected` in `check_url_redirect`**

Inside `if not product.url_redirected:` right after `product.url_redirected = True`:

```python
            log_event(
                db,
                level="warning",
                category="scrape",
                event="url_redirected",
                message=f"URL now redirects to {final_url}",
                product=product,
                details={"from": product.url, "to": final_url},
            )
```

- [ ] **Step 5: Return outcomes and log in `scrape_and_record` / `_scrape_and_record_locked`**

Replace `scrape_and_record`:

```python
async def scrape_and_record(product_id: int) -> str | None:
    """Scrape the current price for a product and persist it.

    Returns the outcome ("ok" | "unchanged" | "failed" | "skipped"), or None
    when the product no longer exists or is inactive.
    """
    browser = await ensure_browser()
    if browser is None:
        logger.warning("Browser not available, skipping job for product %d", product_id)
        async with AsyncSessionLocal() as db:
            product = await db.get(Product, product_id)
        if product is not None:
            await record_event(
                level="warning",
                category="scrape",
                event="scrape_skipped",
                message="Scrape skipped: browser unavailable",
                product=product,
                details={"reason": "browser_unavailable"},
            )
        return "skipped"

    async with product_scrape_lock(product_id):
        return await _scrape_and_record_locked(product_id, browser)
```

In `_scrape_and_record_locked` (signature `-> str | None`):

1. Both early `return` statements for a missing/inactive product become `return None`.
2. After the elapsed-time logging add `duration_ms = int(elapsed * 1000)`.
3. Redirect branch becomes:

```python
        if product.url_redirected:
            logger.debug("Skipping price record for product %d — URL redirected", product_id)
            log_scrape_skipped(
                db,
                product,
                reason="redirected",
                message="Price not recorded: URL redirects elsewhere",
                duration_ms=duration_ms,
            )
            await db.commit()
            return "skipped"
```

4. Failure branch becomes (notification code kept verbatim, just moved after the commit and keyed on the precomputed flags):

```python
        if result.price is None:
            logger.warning("Could not scrape price for product %d (%s)", product_id, product.url)
            product.consecutive_scrape_failures += 1
            _record_scrape_failure(product_id)
            log_scrape_failure(db, product, result, duration_ms=duration_ms)

            # Exactly-once notification when the threshold is first reached.
            threshold_reached = product.consecutive_scrape_failures == failure_threshold
            storm = threshold_reached and scraping_looks_broken()
            if threshold_reached and storm and product.user_id not in _storm_notified_users:
                log_event(
                    db,
                    level="error",
                    category="system",
                    event="scraping_down",
                    message=f"Scraping looks down: {len(_failing_products)} products failing",
                    product=product,
                    details={"failing_products": len(_failing_products)},
                )
            elif threshold_reached and not storm:
                log_event(
                    db,
                    level="error",
                    category="alert",
                    event="selector_broken",
                    message=f"Selector broken: {failure_threshold} failed checks in a row",
                    product=product,
                    details={"failures": failure_threshold},
                )
            await db.commit()

            if threshold_reached:
                if storm:
                    # (keep the existing comment block)
                    await _notify_scraping_down(product, db)
                else:
                    await _notify_product_owner(
                        product,
                        db,
                        Notification(  # unchanged "Selector broken" notification
                            emoji="⚠️",
                            title="Selector broken",
                            product=product.name,
                            facts=[("Failed checks", f"{failure_threshold} in a row")],
                            text=[
                                "No price was found with the CSS selector. The page layout "
                                "probably changed, or the item is no longer available."
                            ],
                            links=product_links(product.id, product.url),
                        ),
                    )
            return "failed"
```

5. Recovery: inside `if product.user_id in _storm_notified_users:` before `await _notify_scraping_recovered(product, db)`:

```python
            log_event(
                db,
                level="info",
                category="system",
                event="scraping_recovered",
                message="Scraping recovered",
                product=product,
            )
```

and inside `elif product.consecutive_scrape_failures >= failure_threshold:` before the notify call:

```python
            log_event(
                db,
                level="info",
                category="alert",
                event="scrape_recovered",
                message=f"Recovered after {product.consecutive_scrape_failures} failed checks",
                product=product,
                details={"failures_before": product.consecutive_scrape_failures},
            )
```

6. Currency flip: inside `if prev is not None and prev.currency and currency != prev.currency:` after the `logger.warning(...)`:

```python
                log_event(
                    db,
                    level="warning",
                    category="scrape",
                    event="currency_changed",
                    message=f"Currency changed {prev.currency} → {currency}",
                    product=product,
                    details={"was": prev.currency, "now": currency},
                )
```

7. Alerts: inside `if triggered:` after `alert.last_triggered_at = now`:

```python
                log_event(
                    db,
                    level="info",
                    category="alert",
                    event="alert_triggered",
                    message=f"Alert fired ({alert.condition}) at {format_price(price, currency)}",
                    product=product,
                    details={
                        "alert_id": alert.id,
                        "condition": alert.condition,
                        "price": price,
                        "threshold_price": alert.threshold_price,
                        "threshold_percent": alert.threshold_percent,
                    },
                )
```

8. Before the final `await db.commit()`:

```python
        log_scrape_success(
            db,
            product,
            price=price,
            prev_price=prev_price,
            currency=currency,
            changed=changed,
            source=result.source,
            duration_ms=duration_ms,
        )
```

and after the existing info/debug logging at the end: `return "ok" if changed else "unchanged"`.

- [ ] **Step 6: Tally outcomes in `run_check_all`**

```python
    _check_all_running = True
    counts = {"ok": 0, "failed": 0, "skipped": 0}
    try:
        for product_id in product_ids:
            try:
                outcome = await scrape_and_record(product_id)
            except Exception:
                # One bad product must not abort the rest of the pass.
                logger.exception("Check-all failed for product %d", product_id)
                outcome = "failed"
            if outcome in ("ok", "unchanged"):
                counts["ok"] += 1
            elif outcome in counts:
                counts[outcome] += 1
    finally:
        _check_all_running = False

    await record_event(
        level="warning" if counts["failed"] else "info",
        category="system",
        event="check_all",
        message=(
            f"Check all finished: {counts['ok']} ok, {counts['failed']} failed, "
            f"{counts['skipped']} skipped of {len(product_ids)}"
        ),
        details={"total": len(product_ids), **counts},
    )
```

(The early "already running" return stays before this and logs nothing.)

- [ ] **Step 7: Manual check in `routers/products.py`**

Add `import time` to the top-level imports. In `check_product_now`, change the import line to
`from app.scheduler import check_url_redirect, log_scrape_failure, log_scrape_skipped, log_scrape_success, product_scrape_lock`
and rewrite the body after the lock:

```python
    started = time.monotonic()
    async with product_scrape_lock(product_id):
        result = await scrape_price(browser, product.url, product.selector, product.price_format)
    duration_ms = int((time.monotonic() - started) * 1000)

    await check_url_redirect(product, result.final_url, db)

    if product.url_redirected:
        log_scrape_skipped(
            db,
            product,
            reason="redirected",
            message="Manual check: price not recorded, URL redirects elsewhere",
            duration_ms=duration_ms,
        )
        return CheckResult(product_id=product_id, price=None, error="URL redirected")

    if result.price is None:
        log_scrape_failure(db, product, result, duration_ms=duration_ms, manual=True)
        return CheckResult(product_id=product_id, price=None, error="Could not scrape price")

    if product.consecutive_scrape_failures > 0:
        product.consecutive_scrape_failures = 0

    price = Decimal(str(result.price)).quantize(Decimal("0.01"))

    prev = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.product_id == product_id)
            .order_by(PriceHistory.scraped_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    changed = prev is None or prev.price != price
    currency = result.currency or (prev.currency if prev else None) or "EUR"
    if changed or product.record_all_prices:
        db.add(PriceHistory(product_id=product_id, price=price, currency=currency))

    log_scrape_success(
        db,
        product,
        price=price,
        prev_price=prev.price if prev else None,
        currency=currency,
        changed=changed,
        source=result.source,
        duration_ms=duration_ms,
        manual=True,
    )
    return CheckResult(product_id=product_id, price=price)
```

- [ ] **Step 8: Run tests**

Run: `cd backend && uv run pytest tests/test_scrape_flow.py tests/test_stability.py tests/test_scheduler_logic.py -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd backend && uv run ruff check app tests
git add app/scheduler.py app/routers/products.py tests/test_scrape_flow.py
git commit -m "log scrape outcomes, alerts and check-all to the event log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: System and maintenance events, event-log retention

**Files:**
- Modify: `backend/app/browser.py` (`start_browser` 93-103, `ensure_browser` 106-143)
- Modify: `backend/app/notifier.py` (`_record_delivery` 77-86)
- Modify: `backend/app/scheduler.py` (add `MAINTENANCE_JOBS`, `_on_job_event`, `install_job_listener`, `product_id_from_job`)
- Modify: `backend/app/backup.py` (`run_backup` 126-145; note in `build_export_payload` docstring)
- Modify: `backend/app/retention.py` (add `prune_event_log`, `run_nightly_retention`)
- Modify: `backend/app/config.py` (new field next to `price_history_thin_after_days`, line ~93)
- Modify: `backend/app/main.py` (lifespan 82-105)
- Modify: `.env.example` (next to `PRICE_HISTORY_THIN_AFTER_DAYS`, line ~124)
- Test: `backend/tests/test_system_events.py`

**Interfaces:**
- Consumes: `record_event`, `spawn_event`, `drain_pending_events` (Task 1).
- Produces:
  - `scheduler.MAINTENANCE_JOBS: dict[str, dict]` — `{"maintenance_backup": {"name": "Nightly backup", "event": "backup", "hour": 3, "minute": 30}, "maintenance_retention": {"name": "Nightly retention", "event": "retention", "hour": 4, "minute": 0}}`
  - `scheduler.product_id_from_job(job_id: str) -> int | None`
  - `scheduler.install_job_listener() -> None`
  - `retention.prune_event_log() -> int`, `retention.run_nightly_retention() -> None`
  - `settings.event_log_retention_days: int`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_system_events.py`:

```python
"""Events from outside the scrape path: browser, notifier, APScheduler, maintenance."""
from datetime import UTC, datetime, timedelta

import pytest
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED, JobExecutionEvent
from sqlalchemy import select

import app.browser as browser_mod
import app.notifier as notifier
import app.retention as retention
import app.scheduler as scheduler_mod
from app.database import AsyncSessionLocal, run_migrations
from app.events import drain_pending_events
from app.models import EventLog


async def latest(event: str) -> EventLog | None:
    async with AsyncSessionLocal() as db:
        return (await db.execute(
            select(EventLog).where(EventLog.event == event).order_by(EventLog.id.desc()).limit(1)
        )).scalar_one_or_none()


@pytest.fixture(autouse=True)
async def migrated():
    await run_migrations()


@pytest.mark.asyncio(loop_scope="session")
async def test_browser_launch_failure_and_relaunch(monkeypatch):
    before = await latest("browser_launch_failed")

    async def failing_launch():
        raise RuntimeError("chromium missing")

    browser_mod.set_browser(None, backend="unavailable")
    monkeypatch.setattr(browser_mod, "_launch", failing_launch)
    assert await browser_mod.ensure_browser() is None
    row = await latest("browser_launch_failed")
    assert row is not None and row.id != (before.id if before else None)
    assert "chromium missing" in row.message

    async def ok_launch():
        browser_mod.set_browser(object(), backend="fake")  # type: ignore[arg-type]

    monkeypatch.setattr(browser_mod, "_launch", ok_launch)
    try:
        assert await browser_mod.ensure_browser() is not None
        row = await latest("browser_relaunched")
        assert row.details == {"reason": "not_running"}
    finally:
        browser_mod.set_browser(None, backend="unavailable")


@pytest.mark.asyncio(loop_scope="session")
async def test_delivery_failure_event():
    notifier.reset_channel_status()
    try:
        notifier._record_delivery("ntfy", RuntimeError("connection refused"))
        await drain_pending_events()
        row = await latest("notify_failed")
        assert row.category == "notification" and row.level == "error"
        assert row.details["channel"] == "ntfy"
        assert "connection refused" in row.message
    finally:
        notifier.reset_channel_status()


def test_product_id_from_job():
    assert scheduler_mod.product_id_from_job("product_42") == 42
    assert scheduler_mod.product_id_from_job("product_42__run_now") == 42
    assert scheduler_mod.product_id_from_job("maintenance_backup") is None
    assert scheduler_mod.product_id_from_job("product_x") is None


@pytest.mark.asyncio(loop_scope="session")
async def test_job_listener_records_missed_and_error():
    when = datetime.now(UTC)
    scheduler_mod._on_job_event(JobExecutionEvent(EVENT_JOB_MISSED, "maintenance_backup", "default", when))
    scheduler_mod._on_job_event(
        JobExecutionEvent(EVENT_JOB_ERROR, "maintenance_retention", "default", when, exception=ValueError("bad"))
    )
    await drain_pending_events()

    missed = await latest("job_missed")
    assert missed.details["job_id"] == "maintenance_backup"
    error = await latest("job_error")
    assert error.level == "error"
    assert "ValueError" in error.message


@pytest.mark.asyncio(loop_scope="session")
async def test_prune_event_log_respects_cutoff(monkeypatch):
    marker = "prune-marker-7f3a"
    async with AsyncSessionLocal() as db:
        db.add(EventLog(created_at=datetime.now(UTC) - timedelta(days=40), level="info",
                        category="system", event="old", message=marker))
        db.add(EventLog(created_at=datetime.now(UTC) - timedelta(days=1), level="info",
                        category="system", event="new", message=marker))
        await db.commit()

    monkeypatch.setattr(retention.settings, "event_log_retention_days", 0)
    assert await retention.prune_event_log() == 0

    monkeypatch.setattr(retention.settings, "event_log_retention_days", 30)
    assert await retention.prune_event_log() >= 1
    async with AsyncSessionLocal() as db:
        left = (await db.execute(select(EventLog.event).where(EventLog.message == marker))).scalars().all()
    assert left == ["new"]


@pytest.mark.asyncio(loop_scope="session")
async def test_nightly_retention_records_event(monkeypatch):
    monkeypatch.setattr(retention.settings, "price_history_thin_after_days", 0)
    await retention.run_nightly_retention()
    row = await latest("retention")
    assert row.category == "maintenance"
    assert set(row.details) == {"price_rows_deleted", "events_deleted"}


@pytest.mark.asyncio(loop_scope="session")
async def test_backup_records_success_and_failure(monkeypatch, tmp_path):
    import app.backup as backup

    monkeypatch.setattr(backup.settings, "backup_keep", 2)
    monkeypatch.setattr(backup, "get_backups_dir", lambda: tmp_path)
    assert await backup.run_backup() is not None
    row = await latest("backup")
    assert row.level == "info" and row.details["file"].startswith("caero-backup-")

    async def boom(_db):
        raise RuntimeError("disk full")

    monkeypatch.setattr(backup, "build_export_payload", boom)
    assert await backup.run_backup() is None
    row = await latest("backup")
    assert row.level == "error" and "disk full" in row.message
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_system_events.py -v`
Expected: FAIL (no events recorded, missing `product_id_from_job`, `prune_event_log`, `run_nightly_retention`, `event_log_retention_days`).

- [ ] **Step 3: Config + .env.example**

`backend/app/config.py`, next to `price_history_thin_after_days`:

```python
    # Admin event log (Settings → Logs): rows older than this are deleted
    # nightly. 0 = keep forever.
    event_log_retention_days: int = Field(default=30, ge=0)
```

`.env.example`, below `PRICE_HISTORY_THIN_AFTER_DAYS=0`:

```
# Days to keep admin event-log entries (Settings → Logs). 0 = forever.
EVENT_LOG_RETENTION_DAYS=30
```

- [ ] **Step 4: Browser events**

In `backend/app/browser.py`, `start_browser` except-branch, after `await _reset_playwright()`:

```python
        from app.events import record_event

        await record_event(
            level="error",
            category="system",
            event="browser_launch_failed",
            message=f"Could not start scraping browser: {exc}",
            details={"error": str(exc)[:300]},
        )
```

In `ensure_browser`: in the `except Exception as exc:` branch, before `return None`, add the same `record_event` call with message `f"Could not relaunch scraping browser: {exc}"`. Before the success `logger.warning("Relaunched …")` line add:

```python
        from app.events import record_event

        await record_event(
            level="warning",
            category="system",
            event="browser_relaunched",
            message="Scraping browser relaunched",
            details={"reason": "crashed" if dead is not None else "not_running"},
        )
```

(Lazy imports: `browser.py` must stay importable without the DB stack; see its module docstring about circular imports.)

- [ ] **Step 5: Notifier delivery failures**

In `backend/app/notifier.py` `_record_delivery`, at the end of the `else:` branch:

```python
        from app.events import spawn_event

        # last_error is already redacted (bot token, SMTP password, …).
        spawn_event(
            level="error",
            category="notification",
            event="notify_failed",
            message=f"{channel} delivery failed: {status.last_error}",
            details={"channel": channel, "consecutive_failures": status.consecutive_failures},
        )
```

- [ ] **Step 6: Scheduler listener and maintenance table**

In `backend/app/scheduler.py` add below `_check_all_running = False`:

```python
# Nightly maintenance jobs, registered in main.py. One table so the Schedulers
# tab can name them and find their last run in the event log.
MAINTENANCE_JOBS: dict[str, dict] = {
    "maintenance_backup": {"name": "Nightly backup", "event": "backup", "hour": 3, "minute": 30},
    "maintenance_retention": {"name": "Nightly retention", "event": "retention", "hour": 4, "minute": 0},
}

RUN_NOW_SUFFIX = "__run_now"
```

and at the end of the module:

```python
def product_id_from_job(job_id: str) -> int | None:
    base = job_id.removesuffix(RUN_NOW_SUFFIX)
    if not base.startswith("product_"):
        return None
    try:
        return int(base.removeprefix("product_"))
    except ValueError:
        return None


def _on_job_event(ev) -> None:
    """APScheduler listener: a missed or crashed run otherwise leaves no trace."""
    from apscheduler.events import EVENT_JOB_MISSED

    from app.events import spawn_event

    product_id = product_id_from_job(ev.job_id)
    if ev.code == EVENT_JOB_MISSED:
        spawn_event(
            level="warning",
            category="system",
            event="job_missed",
            message=f"Job {ev.job_id} missed its run at {ev.scheduled_run_time:%Y-%m-%d %H:%M}",
            product_id=product_id,
            details={"job_id": ev.job_id, "scheduled_run_time": ev.scheduled_run_time},
        )
    else:
        spawn_event(
            level="error",
            category="system",
            event="job_error",
            message=f"Job {ev.job_id} raised {type(ev.exception).__name__}: {ev.exception}",
            product_id=product_id,
            details={"job_id": ev.job_id, "exception": repr(ev.exception)[:300]},
        )


def install_job_listener() -> None:
    from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED

    scheduler.add_listener(_on_job_event, EVENT_JOB_MISSED | EVENT_JOB_ERROR)
```

- [ ] **Step 7: Retention**

Append to `backend/app/retention.py` (add `EventLog` to the `app.models` import):

```python
async def prune_event_log() -> int:
    """Delete event-log rows older than EVENT_LOG_RETENTION_DAYS. Returns the count."""
    days = settings.event_log_retention_days
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
        price_rows = await thin_price_history()
        events_deleted = await prune_event_log()
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
```

- [ ] **Step 8: Backup**

In `backend/app/backup.py` rename the current `run_backup` body to `async def _write_backup() -> Path:` (drop its `backup_keep <= 0` check) and add:

```python
async def run_backup() -> Path | None:
    """Write one full-export backup file and rotate old ones (nightly cron)."""
    if settings.backup_keep <= 0:
        return None

    from app.events import record_event

    try:
        target = await _write_backup()
    except Exception as exc:
        logger.exception("Backup failed")
        await record_event(
            level="error",
            category="maintenance",
            event="backup",
            message=f"Backup failed: {exc}",
        )
        return None

    await record_event(
        level="info",
        category="maintenance",
        event="backup",
        message=f"Backup written: {target.name}",
        details={"file": target.name, "kept": settings.backup_keep},
    )
    return target
```

Add to `build_export_payload`'s docstring (create one if absent): `The admin event log is deliberately not exported — it is operational data, not user data.`

- [ ] **Step 9: Lifespan wiring**

In `backend/app/main.py` lifespan, replace the scheduler/maintenance block:

```python
    # Start APScheduler and load product jobs
    scheduler.start()
    install_job_listener()
    await load_all_jobs()

    # Nightly maintenance: JSON backup + retention (price-history thinning and
    # event-log pruning; each a no-op when disabled via settings).
    from app.backup import run_backup
    from app.retention import run_nightly_retention

    for job_id, func in (("maintenance_backup", run_backup), ("maintenance_retention", run_nightly_retention)):
        spec = MAINTENANCE_JOBS[job_id]
        scheduler.add_job(func, "cron", hour=spec["hour"], minute=spec["minute"], id=job_id, replace_existing=True)
```

Change the import to `from app.scheduler import MAINTENANCE_JOBS, install_job_listener, load_all_jobs, scheduler`. In shutdown, after `scheduler.shutdown(wait=False)`:

```python
    from app.events import drain_pending_events

    await drain_pending_events()
```

- [ ] **Step 10: Run tests**

Run: `cd backend && uv run pytest -v`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
cd backend && uv run ruff check app tests
git add app/browser.py app/notifier.py app/scheduler.py app/backup.py app/retention.py app/config.py app/main.py ../.env.example tests/test_system_events.py
git commit -m "log browser, delivery, scheduler and maintenance events; prune event log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Logs API

**Files:**
- Modify: `backend/app/schemas.py` (add `EventLogOut`, `EventLogPage` near `JobOut`, line ~356)
- Modify: `backend/app/routers/settings.py` (new endpoint in the "System info & jobs" block)
- Test: `backend/tests/test_event_log_api.py`

**Interfaces:**
- Consumes: `EventLog`, `EventLevel`, `EventCategory`, `record_event`.
- Produces: `GET /api/settings/logs?level=&level=&category=&product_id=&q=&before_id=&limit=` → `{"items": [EventLogOut], "next_before_id": int | null}`; `EventLogOut` fields: `id, created_at (UTC-aware ISO), level, category, event, product_id, product_name, message, duration_ms, details`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_event_log_api.py`:

```python
"""Admin event-log endpoint: access, filters, search, keyset pagination."""
import uuid

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.events import record_event
from app.models import User


async def login(client, username: str, *, admin: bool) -> dict[str, str]:
    await client.post("/api/auth/register", json={"username": username, "password": "secret1"})
    if admin:
        async with AsyncSessionLocal() as db:
            await db.execute(update(User).where(User.username == username).values(is_admin=True))
            await db.commit()
    resp = await client.post("/api/auth/login", data={"username": username, "password": "secret1"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def marker() -> str:
    return f"mk{uuid.uuid4().hex[:10]}"


async def emit(message: str, *, level="info", category="system", event="test_event", product_name=None):
    await record_event(level=level, category=category, event=event, message=message, product_name=product_name)


async def get_logs(client, headers, **params):
    resp = await client.get("/api/settings/logs", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio(loop_scope="session")
async def test_logs_require_admin(client):
    user = await login(client, "logs-user", admin=False)
    assert (await client.get("/api/settings/logs")).status_code == 401
    assert (await client.get("/api/settings/logs", headers=user)).status_code == 403


@pytest.mark.asyncio(loop_scope="session")
async def test_filters_and_search(client):
    headers = await login(client, "logs-admin-filters", admin=True)
    m = marker()
    await emit(f"{m} info scrape", level="info", category="scrape")
    await emit(f"{m} error notify", level="error", category="notification")
    await emit(f"{m} warn system", level="warning", category="system", product_name=f"Widget {m}")

    all_rows = (await get_logs(client, headers, q=m))["items"]
    assert len(all_rows) == 3
    assert [r["id"] for r in all_rows] == sorted((r["id"] for r in all_rows), reverse=True)

    errors = (await get_logs(client, headers, q=m, level="error"))["items"]
    assert [r["message"] for r in errors] == [f"{m} error notify"]

    two_levels = (await get_logs(client, headers, q=m, level=["error", "warning"]))["items"]
    assert len(two_levels) == 2

    scrape = (await get_logs(client, headers, q=m, category="scrape"))["items"]
    assert [r["category"] for r in scrape] == ["scrape"]

    # Case-insensitive, matches product_name too.
    by_name = (await get_logs(client, headers, q=f"WIDGET {m.upper()}"))["items"]
    assert len(by_name) == 1

    assert all_rows[0]["created_at"].endswith(("Z", "+00:00"))


@pytest.mark.asyncio(loop_scope="session")
async def test_search_treats_like_wildcards_literally(client):
    headers = await login(client, "logs-admin-like", admin=True)
    m = marker()
    await emit(f"{m} 50% off")
    await emit(f"{m} 500 off")
    await emit(f"{m} a_b")
    await emit(f"{m} axb")

    assert [r["message"] for r in (await get_logs(client, headers, q=f"{m} 50%"))["items"]] == [f"{m} 50% off"]
    assert [r["message"] for r in (await get_logs(client, headers, q=f"{m} a_b"))["items"]] == [f"{m} a_b"]


@pytest.mark.asyncio(loop_scope="session")
async def test_keyset_pagination_stable_under_inserts(client):
    headers = await login(client, "logs-admin-page", admin=True)
    m = marker()
    for i in range(5):
        await emit(f"{m} #{i}")

    page1 = await get_logs(client, headers, q=m, limit=2)
    assert len(page1["items"]) == 2 and page1["next_before_id"] == page1["items"][-1]["id"]

    await emit(f"{m} arrived later")  # must not shift page 2

    page2 = await get_logs(client, headers, q=m, limit=2, before_id=page1["next_before_id"])
    page3 = await get_logs(client, headers, q=m, limit=2, before_id=page2["next_before_id"])
    assert page3["next_before_id"] is None

    seen = [r["message"] for p in (page1, page2, page3) for r in p["items"]]
    assert seen == [f"{m} #{i}" for i in (4, 3, 2, 1, 0)]


@pytest.mark.asyncio(loop_scope="session")
async def test_param_validation(client):
    headers = await login(client, "logs-admin-validate", admin=True)
    assert (await client.get("/api/settings/logs", headers=headers, params={"limit": 501})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"limit": 0})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"level": "debug"})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"category": "x"})).status_code == 422
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_event_log_api.py -v`
Expected: FAIL with 404 on `/api/settings/logs`.

- [ ] **Step 3: Schemas**

In `backend/app/schemas.py` (ensure `from datetime import UTC, datetime`, `from typing import Any` and `field_validator` are imported):

```python
class EventLogOut(BaseModel):
    id: int
    created_at: datetime
    level: str
    category: str
    event: str
    product_id: int | None
    product_name: str | None
    message: str
    duration_ms: int | None
    details: dict[str, Any] | None

    model_config = {"from_attributes": True}

    @field_validator("created_at")
    @classmethod
    def _assume_utc(cls, value: datetime) -> datetime:
        # SQLite hands back naive datetimes; they are UTC (func.now / datetime.now(UTC)).
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class EventLogPage(BaseModel):
    items: list[EventLogOut]
    next_before_id: int | None
```

- [ ] **Step 4: Endpoint**

In `backend/app/routers/settings.py` (imports: `Query` from fastapi, `or_` and `func` from sqlalchemy, `EventLog` from `app.models`, `EventCategory, EventLevel` from `app.events`, `EventLogOut, EventLogPage` from `app.schemas`):

```python
def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/logs", response_model=EventLogPage)
async def list_event_log(
    level: list[EventLevel] = Query(default=[]),
    category: list[EventCategory] = Query(default=[]),
    product_id: int | None = Query(default=None, ge=1),
    q: str | None = Query(default=None, max_length=200),
    before_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db, scope="function"),
    _admin: User = Depends(require_admin),
) -> EventLogPage:
    # Keyset pagination on id: stable while new events keep arriving.
    stmt = select(EventLog).order_by(EventLog.id.desc()).limit(limit)
    if before_id is not None:
        stmt = stmt.where(EventLog.id < before_id)
    if level:
        stmt = stmt.where(EventLog.level.in_(level))
    if category:
        stmt = stmt.where(EventLog.category.in_(category))
    if product_id is not None:
        stmt = stmt.where(EventLog.product_id == product_id)
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip().lower())}%"
        stmt = stmt.where(
            or_(
                func.lower(EventLog.message).like(pattern, escape="\\"),
                func.lower(EventLog.product_name).like(pattern, escape="\\"),
            )
        )

    rows = (await db.execute(stmt)).scalars().all()
    return EventLogPage(
        items=[EventLogOut.model_validate(r) for r in rows],
        next_before_id=rows[-1].id if len(rows) == limit else None,
    )
```

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run pytest tests/test_event_log_api.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && uv run ruff check app tests
git add app/schemas.py app/routers/settings.py tests/test_event_log_api.py
git commit -m "admin event log endpoint with filters and keyset paging

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Enriched jobs API and "Run now"

**Files:**
- Modify: `backend/app/schedule_utils.py` (add `describe_schedule`)
- Modify: `backend/app/scheduler.py` (`scrape_in_progress`; `remove_product_job` also drops a pending run-now job)
- Modify: `backend/app/schemas.py` (`JobOut` replaced, add `JobsOut`, `JobRunOut`)
- Modify: `backend/app/routers/settings.py` (`list_jobs` 361-370 replaced; new `run_job_now`)
- Test: `backend/tests/test_jobs_api.py`

**Interfaces:**
- Consumes: `MAINTENANCE_JOBS`, `RUN_NOW_SUFFIX`, `product_id_from_job` (Task 4); `SCRAPE_RESULT_EVENTS` (Task 1).
- Produces:
  - `describe_schedule(interval_minutes: int, check_time_hhmm: str) -> str`
  - `scheduler.scrape_in_progress(product_id: int) -> bool`
  - `GET /api/settings/jobs` → `{"jobs": [JobOut], "check_all_running": bool}`; `JobOut = {id, kind: "product"|"maintenance", name, product_id, owner, schedule, next_run_time, last_run_at, last_status: "ok"|"failed"|"skipped"|null, last_duration_ms, last_message, consecutive_failures, running}`
  - `POST /api/settings/jobs/{job_id}/run` → 202 `{"queued": true}`; 404 unknown.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_jobs_api.py`:

```python
"""Enriched scheduler job list and the admin "Run now" action."""
import pytest
from sqlalchemy import update

import app.scheduler as scheduler_mod
from app.database import AsyncSessionLocal
from app.events import record_event
from app.models import Product, User
from app.schedule_utils import describe_schedule


async def login(client, username: str, *, admin: bool) -> dict[str, str]:
    await client.post("/api/auth/register", json={"username": username, "password": "secret1"})
    if admin:
        async with AsyncSessionLocal() as db:
            await db.execute(update(User).where(User.username == username).values(is_admin=True))
            await db.commit()
    resp = await client.post("/api/auth/login", data={"username": username, "password": "secret1"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def scheduled_product(owner: str, name: str) -> int:
    async with AsyncSessionLocal() as db:
        user = User(username=owner, hashed_password="x")
        db.add(user)
        await db.flush()
        product = Product(user_id=user.id, name=name, url="https://shop.example/j", selector=".p",
                          check_interval_minutes=60, check_time_hhmm="08:00")
        db.add(product)
        await db.commit()
        scheduler_mod.add_product_job(product)
        return product.id


def test_describe_schedule():
    assert describe_schedule(60, "08:00") == "Every 1 h from 08:00"
    assert describe_schedule(30, "10:00") == "Every 30 min from 10:00"
    assert describe_schedule(1440, "09:30") == "Daily at 09:30"
    assert describe_schedule(2880, "09:30") == "Every 2 d at 09:30"
    assert describe_schedule(90, "07:00") == "Every 90 min from 07:00"


@pytest.mark.asyncio(loop_scope="session")
async def test_jobs_are_enriched_and_failing_first(client):
    headers = await login(client, "jobs-admin", admin=True)
    ok_pid = await scheduled_product("jobs-owner-ok", "Healthy widget")
    bad_pid = await scheduled_product("jobs-owner-bad", "Broken widget")
    try:
        async with AsyncSessionLocal() as db:
            ok, bad = await db.get(Product, ok_pid), await db.get(Product, bad_pid)
        await record_event(level="info", category="scrape", event="scrape_ok", message="fine", product=ok,
                           duration_ms=1200)
        await record_event(level="warning", category="scrape", event="scrape_failed", message="No price found",
                           product=bad, duration_ms=800)

        resp = await client.get("/api/settings/jobs", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["check_all_running"] is False
        jobs = {j["id"]: j for j in body["jobs"]}

        healthy = jobs[f"product_{ok_pid}"]
        assert healthy["kind"] == "product"
        assert healthy["name"] == "Healthy widget"
        assert healthy["owner"] == "jobs-owner-ok"
        assert healthy["schedule"] == "Every 1 h from 08:00"
        assert healthy["last_status"] == "ok"
        assert healthy["last_duration_ms"] == 1200
        assert healthy["running"] is False

        broken = jobs[f"product_{bad_pid}"]
        assert broken["last_status"] == "failed"
        assert broken["last_message"] == "No price found"

        ids = [j["id"] for j in body["jobs"]]
        assert ids.index(f"product_{bad_pid}") < ids.index(f"product_{ok_pid}")
    finally:
        scheduler_mod.remove_product_job(ok_pid)
        scheduler_mod.remove_product_job(bad_pid)


@pytest.mark.asyncio(loop_scope="session")
async def test_run_now_queues_one_off_and_keeps_schedule(client):
    headers = await login(client, "jobs-admin-run", admin=True)
    pid = await scheduled_product("jobs-owner-run", "Run widget")
    job_id = f"product_{pid}"
    try:
        before = scheduler_mod.scheduler.get_job(job_id).next_run_time

        resp = await client.post(f"/api/settings/jobs/{job_id}/run", headers=headers)
        assert resp.status_code == 202
        assert resp.json() == {"queued": True}

        one_off = scheduler_mod.scheduler.get_job(job_id + scheduler_mod.RUN_NOW_SUFFIX)
        assert one_off is not None
        assert one_off.args == (pid,)
        # The regular schedule is untouched — no drift away from the check time.
        assert scheduler_mod.scheduler.get_job(job_id).next_run_time == before

        # Hidden from the listing.
        listed = [j["id"] for j in (await client.get("/api/settings/jobs", headers=headers)).json()["jobs"]]
        assert job_id + scheduler_mod.RUN_NOW_SUFFIX not in listed
    finally:
        scheduler_mod.remove_product_job(pid)
    assert scheduler_mod.scheduler.get_job(job_id + scheduler_mod.RUN_NOW_SUFFIX) is None


@pytest.mark.asyncio(loop_scope="session")
async def test_run_now_errors_and_access(client):
    admin = await login(client, "jobs-admin-404", admin=True)
    user = await login(client, "jobs-user", admin=False)
    assert (await client.post("/api/settings/jobs/nope/run", headers=admin)).status_code == 404
    assert (await client.post("/api/settings/jobs/nope/run", headers=user)).status_code == 403
    assert (await client.get("/api/settings/jobs", headers=user)).status_code == 403
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_jobs_api.py -v`
Expected: FAIL (`ImportError: describe_schedule`, list-shaped response, 404/405 on `/run`).

- [ ] **Step 3: `describe_schedule`**

Append to `backend/app/schedule_utils.py`:

```python
def describe_schedule(interval_minutes: int, check_time_hhmm: str) -> str:
    """Human-readable schedule for the admin Schedulers tab."""
    if interval_minutes % 1440 == 0:
        days = interval_minutes // 1440
        return f"Daily at {check_time_hhmm}" if days == 1 else f"Every {days} d at {check_time_hhmm}"
    if interval_minutes % 60 == 0:
        return f"Every {interval_minutes // 60} h from {check_time_hhmm}"
    return f"Every {interval_minutes} min from {check_time_hhmm}"
```

- [ ] **Step 4: Scheduler helpers**

In `backend/app/scheduler.py`:

```python
def scrape_in_progress(product_id: int) -> bool:
    # .get, not product_scrape_lock(): looking must not create a lock.
    lock = _product_locks.get(product_id)
    return lock is not None and lock.locked()
```

In `remove_product_job`, after the existing `scheduler.remove_job(job_id)` block add:

```python
    if scheduler.get_job(job_id + RUN_NOW_SUFFIX):
        scheduler.remove_job(job_id + RUN_NOW_SUFFIX)
```

- [ ] **Step 5: Schemas**

Replace `JobOut` in `backend/app/schemas.py`:

```python
class JobOut(BaseModel):
    id: str
    kind: Literal["product", "maintenance"]
    name: str
    product_id: int | None = None
    owner: str | None = None
    schedule: str
    next_run_time: datetime | None
    last_run_at: datetime | None = None
    last_status: Literal["ok", "failed", "skipped"] | None = None
    last_duration_ms: int | None = None
    last_message: str | None = None
    consecutive_failures: int = 0
    running: bool = False

    @field_validator("last_run_at")
    @classmethod
    def _assume_utc(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class JobsOut(BaseModel):
    jobs: list[JobOut]
    check_all_running: bool


class JobRunOut(BaseModel):
    queued: bool
```

(ensure `Literal` is imported from `typing`).

- [ ] **Step 6: Endpoints**

Replace `list_jobs` in `backend/app/routers/settings.py` (imports: `SCRAPE_RESULT_EVENTS` from `app.events`; `JobsOut, JobRunOut` from `app.schemas`; `describe_schedule` from `app.schedule_utils`; `UTC`/`datetime` if not present):

```python
_STATUS_BY_EVENT = {
    "scrape_ok": "ok",
    "scrape_unchanged": "ok",
    "scrape_failed": "failed",
    "scrape_skipped": "skipped",
}


def _last_status(row: EventLog | None) -> str | None:
    if row is None:
        return None
    if row.event in _STATUS_BY_EVENT:
        return _STATUS_BY_EVENT[row.event]
    return "failed" if row.level == "error" else "ok"


@router.get("/jobs", response_model=JobsOut)
async def list_jobs(
    db: AsyncSession = Depends(get_db, scope="function"),
    _user=Depends(require_admin),
) -> JobsOut:
    from app.scheduler import (
        MAINTENANCE_JOBS,
        RUN_NOW_SUFFIX,
        check_all_in_progress,
        product_id_from_job,
        scheduler,
        scrape_in_progress,
    )

    jobs = [j for j in scheduler.get_jobs() if not j.id.endswith(RUN_NOW_SUFFIX)]
    product_ids = [pid for j in jobs if (pid := product_id_from_job(j.id)) is not None]

    products: dict[int, tuple[Product, str]] = {}
    last_scrape: dict[int, EventLog] = {}
    if product_ids:
        rows = await db.execute(
            select(Product, User.username).join(User, Product.user_id == User.id).where(Product.id.in_(product_ids))
        )
        products = {p.id: (p, username) for p, username in rows.all()}
        newest = (
            select(func.max(EventLog.id))
            .where(EventLog.product_id.in_(product_ids), EventLog.event.in_(SCRAPE_RESULT_EVENTS))
            .group_by(EventLog.product_id)
        )
        for row in (await db.execute(select(EventLog).where(EventLog.id.in_(newest)))).scalars():
            last_scrape[row.product_id] = row

    maintenance_events = [spec["event"] for spec in MAINTENANCE_JOBS.values()]
    newest_maintenance = (
        select(func.max(EventLog.id)).where(EventLog.event.in_(maintenance_events)).group_by(EventLog.event)
    )
    last_maintenance = {
        row.event: row
        for row in (await db.execute(select(EventLog).where(EventLog.id.in_(newest_maintenance)))).scalars()
    }

    out: list[JobOut] = []
    for job in jobs:
        next_run = getattr(job, "next_run_time", None)
        pid = product_id_from_job(job.id)
        if pid is not None:
            product, owner = products.get(pid, (None, None))
            last = last_scrape.get(pid)
            out.append(JobOut(
                id=job.id,
                kind="product",
                name=product.name if product else f"Product #{pid}",
                product_id=pid,
                owner=owner,
                schedule=(
                    describe_schedule(product.check_interval_minutes, product.check_time_hhmm)
                    if product else "—"
                ),
                next_run_time=next_run,
                last_run_at=last.created_at if last else None,
                last_status=_last_status(last),
                last_duration_ms=last.duration_ms if last else None,
                last_message=last.message if last else None,
                consecutive_failures=product.consecutive_scrape_failures if product else 0,
                running=scrape_in_progress(pid),
            ))
        else:
            spec = MAINTENANCE_JOBS.get(job.id)
            last = last_maintenance.get(spec["event"]) if spec else None
            out.append(JobOut(
                id=job.id,
                kind="maintenance",
                name=spec["name"] if spec else job.id,
                schedule=f"Daily at {spec['hour']:02d}:{spec['minute']:02d}" if spec else str(job.trigger),
                next_run_time=next_run,
                last_run_at=last.created_at if last else None,
                last_status=_last_status(last),
                last_message=last.message if last else None,
            ))

    far_future = datetime.max.replace(tzinfo=UTC)
    out.sort(key=lambda j: (j.last_status != "failed", j.next_run_time or far_future))
    return JobsOut(jobs=out, check_all_running=check_all_in_progress())


@router.post("/jobs/{job_id}/run", response_model=JobRunOut, status_code=status.HTTP_202_ACCEPTED)
async def run_job_now(job_id: str, _user=Depends(require_admin)) -> JobRunOut:
    from app.scheduler import RUN_NOW_SUFFIX, scheduler

    job = scheduler.get_job(job_id)
    if job is None or job_id.endswith(RUN_NOW_SUFFIX):
        raise HTTPException(status_code=404, detail="Job not found")
    # A separate one-off job: modify_job(next_run_time=now) would re-anchor the
    # interval trigger and drift the product away from its check time. The
    # per-product lock still serialises it against a scheduled run.
    scheduler.add_job(
        job.func,
        "date",
        run_date=datetime.now(UTC),
        args=job.args,
        kwargs=job.kwargs,
        id=job_id + RUN_NOW_SUFFIX,
        replace_existing=True,
        misfire_grace_time=None,
    )
    return JobRunOut(queued=True)
```

(If `status`/`HTTPException`/`Product`/`User`/`func` aren't yet imported in `settings.py`, add them; check the top of the file.)

- [ ] **Step 7: Run tests**

Run: `cd backend && uv run pytest -v`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
cd backend && uv run ruff check app tests
git add app/schedule_utils.py app/scheduler.py app/schemas.py app/routers/settings.py tests/test_jobs_api.py
git commit -m "enriched scheduler jobs endpoint and run now

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Settings tabs in the URL, About tab

**Files:**
- Create: `frontend/src/components/setup/settingsTabs.ts`
- Create: `frontend/src/components/setup/settingsTabs.test.ts`
- Modify: `frontend/src/pages/Setup.tsx` (whole file)
- Modify: `frontend/src/components/setup/AboutSection.tsx:12` (drop `mt-8`)

**Interfaces:**
- Produces: `type SettingsTab = 'account' | 'schedulers' | 'admin' | 'about'`; `visibleTabs(isAdmin: boolean): SettingsTab[]`; `resolveTab(raw: string | null, isAdmin: boolean): SettingsTab`. (Task 9 adds `'logs'`.)

- [ ] **Step 1: Write the failing test**

`frontend/src/components/setup/settingsTabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveTab, visibleTabs } from './settingsTabs'

describe('settings tabs', () => {
  it('shows admin-only tabs to admins only', () => {
    expect(visibleTabs(false)).toEqual(['account', 'about'])
    expect(visibleTabs(true)).toEqual(['account', 'schedulers', 'admin', 'about'])
  })

  it('resolves known tabs', () => {
    expect(resolveTab('about', false)).toBe('about')
    expect(resolveTab('schedulers', true)).toBe('schedulers')
  })

  it('falls back to account for missing, unknown or forbidden tabs', () => {
    expect(resolveTab(null, true)).toBe('account')
    expect(resolveTab('garbage', true)).toBe('account')
    expect(resolveTab('schedulers', false)).toBe('account')
    expect(resolveTab('admin', false)).toBe('account')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/setup/settingsTabs.test.ts`
Expected: FAIL — cannot resolve `./settingsTabs`.

- [ ] **Step 3: Implement `settingsTabs.ts`**

```ts
export type SettingsTab = 'account' | 'schedulers' | 'admin' | 'about'

const ALL_TABS: readonly SettingsTab[] = ['account', 'schedulers', 'admin', 'about']
const ADMIN_TABS: ReadonlySet<SettingsTab> = new Set<SettingsTab>(['schedulers', 'admin'])

export function visibleTabs(isAdmin: boolean): SettingsTab[] {
  return ALL_TABS.filter((tab) => isAdmin || !ADMIN_TABS.has(tab))
}

/** Tab from the URL, or 'account' when missing, unknown or not permitted. */
export function resolveTab(raw: string | null, isAdmin: boolean): SettingsTab {
  const match = visibleTabs(isAdmin).find((tab) => tab === raw)
  return match ?? 'account'
}
```

- [ ] **Step 4: Rewrite `Setup.tsx`**

```tsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Clock, Info, Shield, User } from 'lucide-react'
import { useMe } from '../api/hooks'
import PreferencesSection from '../components/setup/PreferencesSection'
import SelectorDefaultsSection from '../components/setup/SelectorDefaultsSection'
import {
  ChangePasswordSection,
  DangerZoneSection,
  MyDataSection,
  NotificationDefaultsSection,
} from '../components/setup/AccountSections'
import {
  FullDataSection,
  NotificationTestsSection,
  SchedulerJobsSection,
  UserManagementSection,
} from '../components/setup/AdminSections'
import AboutSection from '../components/setup/AboutSection'
import { resolveTab, visibleTabs, type SettingsTab } from '../components/setup/settingsTabs'

const TAB_META: Record<SettingsTab, { label: string; icon: React.ElementType }> = {
  account: { label: 'Account', icon: User },
  schedulers: { label: 'Schedulers', icon: Clock },
  admin: { label: 'Admin', icon: Shield },
  about: { label: 'About', icon: Info },
}

export default function Setup() {
  const { data: me } = useMe()
  const isAdmin = !!me?.is_admin
  const [searchParams, setSearchParams] = useSearchParams()
  // Derived, not state: the URL is the source of truth, so refresh and shared
  // links keep the tab, and a non-admin's ?tab=admin quietly lands on Account.
  const activeTab = resolveTab(searchParams.get('tab'), isAdmin)
  const [toastMsg, setToastMsg] = useState('')

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  const selectTab = (tab: SettingsTab) =>
    setSearchParams(tab === 'account' ? {} : { tab }, { replace: true })

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        {me?.username && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Signed in as <span className="font-medium text-gray-700 dark:text-gray-300">{me.username}</span>
            {me.is_admin && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">Admin</span>
            )}
          </p>
        )}
      </div>

      {/* Tab bar — scrolls sideways on narrow phones instead of the page */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto"
      >
        {visibleTabs(isAdmin).map((key) => {
          const { label, icon: Icon } = TAB_META[key]
          const selected = activeTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selected
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </div>

      {activeTab === 'account' && (
        <div className="space-y-4">
          <PreferencesSection showToast={showToast} />
          <ChangePasswordSection showToast={showToast} />
          <NotificationDefaultsSection showToast={showToast} />
          <SelectorDefaultsSection showToast={showToast} isAdmin={isAdmin} />
          <MyDataSection showToast={showToast} />
          <DangerZoneSection showToast={showToast} />
        </div>
      )}

      {activeTab === 'schedulers' && (
        <div className="space-y-4">
          <SchedulerJobsSection />
        </div>
      )}

      {activeTab === 'admin' && (
        <div className="space-y-4">
          <NotificationTestsSection showToast={showToast} />
          <FullDataSection showToast={showToast} />
          <UserManagementSection showToast={showToast} />
        </div>
      )}

      {activeTab === 'about' && <AboutSection />}

      {/* Global Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-400 dark:text-green-600" />
          {toastMsg}
        </div>
      )}

    </div>
  )
}
```

In `AboutSection.tsx` line 12 change `p-5 mt-8` to `p-5`.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/setup/settingsTabs.ts frontend/src/components/setup/settingsTabs.test.ts frontend/src/pages/Setup.tsx frontend/src/components/setup/AboutSection.tsx
git commit -m "settings: tabs in url, about and schedulers tabs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Schedulers tab

**Files:**
- Modify: `frontend/src/api/types.ts:255-258` (replace `JobOut`)
- Modify: `frontend/src/api/hooks.ts:393-400` (`useJobs`), add `useRunJob`; update type import list
- Modify: `frontend/src/utils/format.ts` (add `formatRelativeTime`, `formatDuration`)
- Modify: `frontend/src/utils/format.test.ts` (append tests)
- Create: `frontend/src/components/setup/SchedulersTab.tsx`
- Modify: `frontend/src/components/setup/AdminSections.tsx:254-278` (delete `SchedulerJobsSection`, drop now-unused imports)
- Modify: `frontend/src/pages/Setup.tsx` (render `SchedulersTab`)

**Interfaces:**
- Consumes: `GET /api/settings/jobs`, `POST /api/settings/jobs/{id}/run` (Task 6).
- Produces: `JobOut`, `JobStatus`, `JobsResponse` types; `useJobs(enabled?)`, `useRunJob()`; `formatRelativeTime(value: string | null, now?: number): string`, `formatDuration(ms: number | null): string`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/utils/format.test.ts` (add `formatDuration, formatRelativeTime` to its import from `./format`):

```ts
describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const at = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000).toISOString()

  it('handles near times', () => {
    expect(formatRelativeTime(at(-10), now)).toBe('just now')
    expect(formatRelativeTime(at(10), now)).toBe('in a moment')
  })
  it('uses minutes, hours and days', () => {
    expect(formatRelativeTime(at(-5 * 60), now)).toBe('5 min ago')
    expect(formatRelativeTime(at(3 * 3600), now)).toBe('in 3 h')
    expect(formatRelativeTime(at(-2 * 86400), now)).toBe('2 d ago')
  })
  it('returns a dash for missing or invalid values', () => {
    expect(formatRelativeTime(null, now)).toBe('—')
    expect(formatRelativeTime('nope', now)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats ms, seconds and minutes', () => {
    expect(formatDuration(850)).toBe('850 ms')
    expect(formatDuration(12345)).toBe('12.3 s')
    expect(formatDuration(125000)).toBe('2 min 5 s')
    expect(formatDuration(119600)).toBe('2 min 0 s')
    expect(formatDuration(null)).toBe('—')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/utils/format.test.ts`
Expected: FAIL — `formatRelativeTime is not a function`.

- [ ] **Step 3: Implement formatters**

Append to `frontend/src/utils/format.ts`:

```ts
export function formatRelativeTime(value: string | null, now: number = Date.now()) {
  if (!value) return '—'
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Math.round((t - now) / 1000)
  const abs = Math.abs(diff)
  if (abs < 45) return diff >= 0 ? 'in a moment' : 'just now'
  const [amount, unit] =
    abs < 3600 ? [Math.round(abs / 60), 'min'] : abs < 86400 ? [Math.round(abs / 3600), 'h'] : [Math.round(abs / 86400), 'd']
  return diff > 0 ? `in ${amount} ${unit}` : `${amount} ${unit} ago`
}

export function formatDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSeconds = Math.round(ms / 1000)
  return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`
}
```

Run: `cd frontend && npx vitest run src/utils/format.test.ts` → PASS.

- [ ] **Step 4: Types and hooks**

`frontend/src/api/types.ts`, replace `JobOut`:

```ts
export type JobStatus = 'ok' | 'failed' | 'skipped'

export interface JobOut {
  id: string
  kind: 'product' | 'maintenance'
  name: string
  product_id: number | null
  owner: string | null
  schedule: string
  next_run_time: string | null
  last_run_at: string | null
  last_status: JobStatus | null
  last_duration_ms: number | null
  last_message: string | null
  consecutive_failures: number
  running: boolean
}

export interface JobsResponse {
  jobs: JobOut[]
  check_all_running: boolean
}
```

`frontend/src/api/hooks.ts`: replace `JobOut` with `JobsResponse` in the type import list, and replace `useJobs`:

```ts
/** Scheduler job list — admin only. */
export function useJobs(enabled = true) {
  return useQuery<JobsResponse>({
    queryKey: ['scheduler-jobs'],
    queryFn: () => apiFetch<JobsResponse>('/api/settings/jobs'),
    enabled,
    refetchInterval: 30_000,
  })
}

/** Queue a one-off run of a scheduler job — admin only. */
export function useRunJob() {
  const qc = useQueryClient()
  return useMutation<{ queued: boolean }, Error, string>({
    mutationFn: (jobId) =>
      apiFetch<{ queued: boolean }>(`/api/settings/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduler-jobs'] })
      qc.invalidateQueries({ queryKey: ['event-log'] })
    },
    onError: () => {
      // e.g. 404: the job vanished (product deleted) — refresh the list.
      qc.invalidateQueries({ queryKey: ['scheduler-jobs'] })
    },
  })
}
```

- [ ] **Step 5: `SchedulersTab.tsx`**

```tsx
import { Clock, Loader2, Play, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useJobs, useMe, useRunJob, useUiSettings } from '../../api/hooks'
import type { JobOut, JobStatus } from '../../api/types'
import { formatDateTime, formatDuration, formatRelativeTime } from '../../utils/format'
import Section from './Section'

const STATUS: Record<JobStatus | 'never', { dot: string; label: string }> = {
  ok: { dot: 'bg-green-500', label: 'Last run OK' },
  failed: { dot: 'bg-red-500', label: 'Last run failed' },
  skipped: { dot: 'bg-amber-500', label: 'Last run skipped' },
  never: { dot: 'bg-gray-300 dark:bg-gray-600', label: 'Not run yet' },
}

function JobRow({ job, linkable, dateFormat, busy, onRun }: {
  job: JobOut
  linkable: boolean
  dateFormat?: string
  busy: boolean
  onRun: () => void
}) {
  const status = STATUS[job.last_status ?? 'never']
  const nameCls = 'font-medium text-sm truncate'
  return (
    <li className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${status.dot}`} title={status.label} aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {linkable && job.product_id ? (
              <Link to={`/products/${job.product_id}`} className={`${nameCls} text-indigo-600 dark:text-indigo-400 hover:underline`}>
                {job.name}
              </Link>
            ) : (
              <span className={`${nameCls} text-gray-900 dark:text-gray-100`}>{job.name}</span>
            )}
            <span className="sr-only">{status.label}</span>
            {job.consecutive_failures > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                {job.consecutive_failures} failed in a row
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {job.schedule}{job.owner ? ` · ${job.owner}` : ''}
          </p>
          {job.last_status === 'failed' && job.last_message && (
            <p className="text-xs text-red-600 dark:text-red-400 truncate">{job.last_message}</p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs sm:w-56 shrink-0 text-gray-700 dark:text-gray-300">
        <dt className="text-gray-500 dark:text-gray-400">Next</dt>
        <dd title={formatDateTime(job.next_run_time, dateFormat)}>
          {job.next_run_time ? formatRelativeTime(job.next_run_time) : 'paused'}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Last</dt>
        <dd title={formatDateTime(job.last_run_at, dateFormat)}>
          {formatRelativeTime(job.last_run_at)}
          {job.last_duration_ms != null ? ` · ${formatDuration(job.last_duration_ms)}` : ''}
        </dd>
      </dl>
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        aria-label={`Run ${job.name} now`}
        className="self-start sm:self-center shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        Run now
      </button>
    </li>
  )
}

export default function SchedulersTab({ showToast }: { showToast: (msg: string) => void }) {
  const { data, isLoading, error } = useJobs()
  const { data: me } = useMe()
  const { data: uiSettings } = useUiSettings()
  const runJob = useRunJob()

  const jobs = data?.jobs ?? []
  const productJobs = jobs.filter((j) => j.kind === 'product')
  const maintenanceJobs = jobs.filter((j) => j.kind === 'maintenance')
  const failing = productJobs.filter((j) => j.last_status === 'failed').length

  const run = (job: JobOut) =>
    runJob.mutate(job.id, {
      onSuccess: () => showToast(`Queued: ${job.name}`),
      onError: (err) => showToast(err.message || 'Could not start the job'),
    })

  const renderRows = (list: JobOut[]) => (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {list.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          linkable={!!me && job.owner === me.username}
          dateFormat={uiSettings?.date_format}
          busy={job.running || (runJob.isPending && runJob.variables === job.id)}
          onRun={() => run(job)}
        />
      ))}
    </ul>
  )

  const summary = [
    `${productJobs.length} scheduled`,
    `${failing} failing`,
    ...(data?.check_all_running ? ['Check all running'] : []),
  ].join(' · ')

  return (
    <div className="space-y-4">
      <Section icon={Clock} title="Scrape jobs" description={`${summary} · refreshes every 30s`}>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        ) : productJobs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No products are scheduled. Inactive products and products with checks disabled have no job.
          </p>
        ) : (
          renderRows(productJobs)
        )}
      </Section>
      {maintenanceJobs.length > 0 && (
        <Section icon={Wrench} title="Maintenance" description="Nightly backup and retention">
          {renderRows(maintenanceJobs)}
        </Section>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Wire it in and remove the old section**

In `frontend/src/components/setup/AdminSections.tsx` delete `SchedulerJobsSection` (lines 254-278). In `Setup.tsx` drop `SchedulerJobsSection` from the `AdminSections` import, add `import SchedulersTab from '../components/setup/SchedulersTab'`, and replace the schedulers block with:

```tsx
      {activeTab === 'schedulers' && <SchedulersTab showToast={showToast} />}
```

Run `cd frontend && npm run lint` and remove any imports it now reports unused in `AdminSections.tsx` (likely `Clock`, `useJobs`, and `formatDateTime`/`useUiSettings` if nothing else there uses them — check with a search in that file before deleting).

- [ ] **Step 7: Verify**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

Manual check (backend running on :8000 with `npm run dev`): log in as admin → Settings → Schedulers shows rows with schedule, next/last, Run now → toast "Queued: …"; at 375 px width no horizontal page scroll.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/hooks.ts frontend/src/utils/format.ts frontend/src/utils/format.test.ts frontend/src/components/setup/SchedulersTab.tsx frontend/src/components/setup/AdminSections.tsx frontend/src/pages/Setup.tsx
git commit -m "schedulers tab with last result and run now

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Logs tab

**Files:**
- Create: `frontend/src/utils/logFilters.ts`
- Create: `frontend/src/utils/logFilters.test.ts`
- Modify: `frontend/src/api/types.ts` (append event-log types)
- Modify: `frontend/src/api/hooks.ts` (add `useEventLog`; import `useInfiniteQuery`)
- Create: `frontend/src/components/setup/LogsTab.tsx`
- Modify: `frontend/src/components/setup/settingsTabs.ts` + `.test.ts` (add `'logs'`)
- Modify: `frontend/src/pages/Setup.tsx` (tab meta + render)

**Interfaces:**
- Consumes: `GET /api/settings/logs` (Task 5); `formatDuration` (Task 8).
- Produces: `EventLevel`, `EventCategory`, `EventLogEntry`, `EventLogPage` types; `LogFilters`, `LEVELS`, `CATEGORIES`, `parseLogFilters(params)`, `writeLogFilters(params, filters)`, `logQueryString(filters, beforeId?, limit?)`, `eventDetailRows(entry)`; `useEventLog(filters, autoRefresh)`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/utils/logFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EventLogEntry } from '../api/types'
import { eventDetailRows, logQueryString, parseLogFilters, writeLogFilters } from './logFilters'

describe('log filters', () => {
  it('parses valid values and drops invalid ones', () => {
    const f = parseLogFilters(new URLSearchParams('tab=logs&level=error,bogus,warning&category=nope&product=12&product_name=Widget&q=abc'))
    expect(f).toEqual({ levels: ['error', 'warning'], category: null, productId: 12, productName: 'Widget', q: 'abc' })
  })

  it('ignores a non-positive or non-integer product', () => {
    expect(parseLogFilters(new URLSearchParams('product=-1')).productId).toBeNull()
    expect(parseLogFilters(new URLSearchParams('product=1.5')).productId).toBeNull()
  })

  it('writes filters back and keeps unrelated params such as tab', () => {
    const params = writeLogFilters(new URLSearchParams('tab=logs&q=old'), {
      levels: ['info'], category: 'scrape', productId: null, productName: null, q: '  ',
    })
    expect(params.toString()).toBe('tab=logs&level=info&category=scrape')
  })

  it('round-trips', () => {
    const f = { levels: ['error' as const], category: 'alert' as const, productId: 3, productName: 'X', q: 'hi' }
    expect(parseLogFilters(writeLogFilters(new URLSearchParams(), f))).toEqual(f)
  })

  it('builds the API query with repeated level params and cursor', () => {
    const qs = logQueryString(
      { levels: ['error', 'warning'], category: null, productId: 7, productName: 'X', q: ' a ' }, 99, 50,
    )
    expect(qs).toBe('level=error&level=warning&product_id=7&q=a&before_id=99&limit=50')
  })
})

describe('eventDetailRows', () => {
  const base: EventLogEntry = {
    id: 1, created_at: '2026-09-24T10:00:00Z', level: 'warning', category: 'scrape', event: 'scrape_failed',
    product_id: 1, product_name: 'P', message: 'm', duration_ms: 1500,
    details: { error: 'no_match', consecutive_failures: 2, extra: { a: 1 }, none: null },
  }

  it('lists event, duration and details', () => {
    expect(eventDetailRows(base)).toEqual([
      ['event', 'scrape_failed'],
      ['duration', '1.5 s'],
      ['error', 'no_match'],
      ['consecutive_failures', '2'],
      ['extra', '{"a":1}'],
      ['none', '—'],
    ])
  })
})
```

Update `settingsTabs.test.ts` expectations:

```ts
    expect(visibleTabs(true)).toEqual(['account', 'schedulers', 'logs', 'admin', 'about'])
```

and add to the fallback case: `expect(resolveTab('logs', false)).toBe('account')`, and to known tabs: `expect(resolveTab('logs', true)).toBe('logs')`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/utils/logFilters.test.ts src/components/setup/settingsTabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types**

Append to `frontend/src/api/types.ts`:

```ts
export type EventLevel = 'info' | 'warning' | 'error'
export type EventCategory = 'scrape' | 'alert' | 'notification' | 'system' | 'maintenance'

export interface EventLogEntry {
  id: number
  created_at: string
  level: EventLevel
  category: EventCategory
  event: string
  product_id: number | null
  product_name: string | null
  message: string
  duration_ms: number | null
  details: Record<string, unknown> | null
}

export interface EventLogPage {
  items: EventLogEntry[]
  next_before_id: number | null
}
```

- [ ] **Step 4: `logFilters.ts`**

```ts
import type { EventCategory, EventLevel, EventLogEntry } from '../api/types'
import { formatDuration } from './format'

export const LEVELS: readonly EventLevel[] = ['info', 'warning', 'error']
export const CATEGORIES: readonly EventCategory[] = ['scrape', 'alert', 'notification', 'system', 'maintenance']

export interface LogFilters {
  levels: EventLevel[]
  category: EventCategory | null
  productId: number | null
  /** Display-only label for the product chip; not sent to the API. */
  productName: string | null
  q: string
}

const FILTER_KEYS = ['level', 'category', 'product', 'product_name', 'q']

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const levels = (params.get('level') ?? '')
    .split(',')
    .filter((l): l is EventLevel => (LEVELS as readonly string[]).includes(l))
  const rawCategory = params.get('category')
  const category = (CATEGORIES as readonly string[]).includes(rawCategory ?? '') ? (rawCategory as EventCategory) : null
  const product = Number(params.get('product'))
  const productId = Number.isInteger(product) && product > 0 ? product : null
  return {
    levels,
    category,
    productId,
    productName: productId ? params.get('product_name') : null,
    q: params.get('q') ?? '',
  }
}

/** Returns a copy of `params` with the log filters replaced (other keys, e.g. `tab`, kept). */
export function writeLogFilters(params: URLSearchParams, filters: LogFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  FILTER_KEYS.forEach((key) => next.delete(key))
  if (filters.levels.length) next.set('level', filters.levels.join(','))
  if (filters.category) next.set('category', filters.category)
  if (filters.productId) {
    next.set('product', String(filters.productId))
    if (filters.productName) next.set('product_name', filters.productName)
  }
  if (filters.q.trim()) next.set('q', filters.q.trim())
  return next
}

export function logQueryString(filters: LogFilters, beforeId?: number, limit = 100): string {
  const p = new URLSearchParams()
  filters.levels.forEach((l) => p.append('level', l))
  if (filters.category) p.append('category', filters.category)
  if (filters.productId) p.set('product_id', String(filters.productId))
  if (filters.q.trim()) p.set('q', filters.q.trim())
  if (beforeId) p.set('before_id', String(beforeId))
  p.set('limit', String(limit))
  return p.toString()
}

export function eventDetailRows(entry: EventLogEntry): [string, string][] {
  const rows: [string, string][] = [['event', entry.event]]
  if (entry.duration_ms != null) rows.push(['duration', formatDuration(entry.duration_ms)])
  for (const [key, value] of Object.entries(entry.details ?? {})) {
    rows.push([key, value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)])
  }
  return rows
}
```

- [ ] **Step 5: Tabs helper gets `logs`**

In `settingsTabs.ts`:

```ts
export type SettingsTab = 'account' | 'schedulers' | 'logs' | 'admin' | 'about'

const ALL_TABS: readonly SettingsTab[] = ['account', 'schedulers', 'logs', 'admin', 'about']
const ADMIN_TABS: ReadonlySet<SettingsTab> = new Set<SettingsTab>(['schedulers', 'logs', 'admin'])
```

Run: `cd frontend && npx vitest run src/utils/logFilters.test.ts src/components/setup/settingsTabs.test.ts` → PASS.

- [ ] **Step 6: Hook**

In `frontend/src/api/hooks.ts` add `useInfiniteQuery` to the `@tanstack/react-query` import, add `EventLogPage` to the type imports, `import { logQueryString, type LogFilters } from '../utils/logFilters'`, and:

```ts
/** Admin event log, newest first, keyset-paged. */
export function useEventLog(filters: LogFilters, autoRefresh: boolean) {
  return useInfiniteQuery({
    // Keyed on the API query (without cursor) — productName is display-only.
    queryKey: ['event-log', logQueryString(filters)],
    queryFn: ({ pageParam }) =>
      apiFetch<EventLogPage>(`/api/settings/logs?${logQueryString(filters, pageParam)}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before_id ?? undefined,
    refetchInterval: autoRefresh ? 15_000 : false,
  })
}
```

- [ ] **Step 7: `LogsTab.tsx`**

```tsx
import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, ScrollText, X } from 'lucide-react'
import { useEventLog, useUiSettings } from '../../api/hooks'
import type { EventCategory, EventLevel, EventLogEntry } from '../../api/types'
import { formatDateTime } from '../../utils/format'
import {
  CATEGORIES,
  LEVELS,
  eventDetailRows,
  logQueryString,
  parseLogFilters,
  writeLogFilters,
  type LogFilters,
} from '../../utils/logFilters'
import Section from './Section'

const LEVEL_STYLE: Record<EventLevel, string> = {
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const controlCls =
  'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 px-2.5 py-1.5'

function EventRow({ entry, dateFormat, expanded, onToggle, onFilterProduct }: {
  entry: EventLogEntry
  dateFormat?: string
  expanded: boolean
  onToggle: () => void
  onFilterProduct: (id: number, name: string) => void
}) {
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className={`shrink-0 mt-0.5 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${LEVEL_STYLE[entry.level]}`}>
        {entry.level}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500 dark:text-gray-400">
          <time dateTime={entry.created_at}>{formatDateTime(entry.created_at, dateFormat)}</time>
          <span>{entry.category}</span>
          {entry.product_name && (entry.product_id ? (
            <button
              type="button"
              onClick={() => onFilterProduct(entry.product_id!, entry.product_name!)}
              title="Show only this product"
              className="text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-[16rem]"
            >
              {entry.product_name}
            </button>
          ) : (
            <span className="line-through truncate max-w-[16rem]" title="Product deleted">{entry.product_name}</span>
          ))}
        </div>
        <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{entry.message}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          Details
        </button>
        {expanded && (
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
            {eventDetailRows(entry).map(([key, value]) => (
              <Fragment key={key}>
                <dt className="text-gray-500 dark:text-gray-400">{key}</dt>
                <dd className="font-mono break-all text-gray-700 dark:text-gray-200">{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    </li>
  )
}

export default function LogsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseLogFilters(searchParams)
  const filterKey = logQueryString(filters)
  const { data: uiSettings } = useUiSettings()

  const [search, setSearch] = useState(filters.q)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(true)
  // Which filter set the user paged past page 1 for (reset implicitly when filters change).
  const [loadedMoreFor, setLoadedMoreFor] = useState<string | null>(null)

  // Refetching every page while someone reads page 3 or an expanded row would
  // shift the list under them.
  const live = autoRefresh && expanded.size === 0 && loadedMoreFor !== filterKey
  const query = useEventLog(filters, live)
  const entries = query.data?.pages.flatMap((p) => p.items) ?? []

  const update = (patch: Partial<LogFilters>) => {
    setExpanded(new Set())
    setSearchParams(writeLogFilters(searchParams, { ...filters, ...patch }), { replace: true })
  }

  useEffect(() => {
    if (search.trim() === filters.q) return
    const timer = setTimeout(() => update({ q: search }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const toggleLevel = (level: EventLevel) =>
    update({ levels: filters.levels.includes(level) ? filters.levels.filter((l) => l !== level) : [...filters.levels, level] })

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Section icon={ScrollText} title="Event log" description="Scrapes, alerts, delivery failures and system events">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Level">
          {LEVELS.map((level) => {
            const on = filters.levels.includes(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(level)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                  on
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {level}
              </button>
            )
          })}
        </div>
        <select
          aria-label="Category"
          value={filters.category ?? ''}
          onChange={(e) => update({ category: (e.target.value || null) as EventCategory | null })}
          className={controlCls}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="search"
          aria-label="Search logs"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${controlCls} min-w-0 sm:flex-1`}
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
      </div>

      {filters.productId && (
        <div>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
            Product: {filters.productName ?? `#${filters.productId}`}
            <button
              type="button"
              aria-label="Clear product filter"
              onClick={() => update({ productId: null, productName: null })}
              className="hover:text-indigo-900 dark:hover:text-indigo-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {query.isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{query.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No events match these filters.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {entries.map((entry) => (
            <EventRow
              key={entry.id}
              entry={entry}
              dateFormat={uiSettings?.date_format}
              expanded={expanded.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
              onFilterProduct={(productId, productName) => update({ productId, productName })}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => {
            setLoadedMoreFor(filterKey)
            query.fetchNextPage()
          }}
          disabled={query.isFetchingNextPage}
          className="w-full py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Section>
  )
}
```

- [ ] **Step 8: Wire into `Setup.tsx`**

Add `ScrollText` to the lucide import, `import LogsTab from '../components/setup/LogsTab'`, add to `TAB_META`:

```tsx
  logs: { label: 'Logs', icon: ScrollText },
```

(between `schedulers` and `admin`), and render:

```tsx
      {activeTab === 'logs' && <LogsTab />}
```

Note: `selectTab` replaces all params, so switching tabs clears log filters — intended.

- [ ] **Step 9: Verify**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: PASS.

Manual check: Settings → Logs as admin: level chips toggle and show in the URL; typing in search updates `?q=` after ~300 ms; clicking a product name adds the chip; "Details" expands; "Load more" appears with > 100 events; reload keeps tab + filters; at 375 px no horizontal page scroll.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/utils/logFilters.ts frontend/src/utils/logFilters.test.ts frontend/src/api/types.ts frontend/src/api/hooks.ts frontend/src/components/setup/LogsTab.tsx frontend/src/components/setup/settingsTabs.ts frontend/src/components/setup/settingsTabs.test.ts frontend/src/pages/Setup.tsx
git commit -m "logs tab with filters, search and paging

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end test and docs

**Files:**
- Modify: `frontend/e2e/app.spec.ts` (append a third serial test — it must reuse the file's `USERNAME`, which is the admin on a fresh CI DB)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; tab buttons have `role="tab"`, run buttons `aria-label="Run <name> now"`, category select `aria-label="Category"`.

- [ ] **Step 1: Add the e2e test**

Append to `frontend/e2e/app.spec.ts`:

```ts
test('settings tabs: about for everyone, schedulers and logs for admins', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()

  await page.goto('/setup?tab=about')
  // Wait for /me so admin-ness is known before inspecting tabs.
  await expect(page.getByText('Signed in as')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Backend Version:')).toBeVisible()

  // On a reused (non-fresh) DB this user may not be the admin — then only
  // the non-admin expectations apply.
  if (!(await page.getByRole('tab', { name: 'Logs' }).isVisible())) {
    await expect(page.getByRole('tab', { name: 'Schedulers' })).toHaveCount(0)
    return
  }

  await page.getByRole('tab', { name: 'Schedulers' }).click()
  await expect(page).toHaveURL(/tab=schedulers/)
  await page.getByRole('button', { name: 'Run Nightly retention now' }).click()

  await page.getByRole('tab', { name: 'Logs' }).click()
  await page.getByLabel('Category').selectOption('maintenance')
  await expect(page).toHaveURL(/category=maintenance/)
  // The one-off job runs asynchronously; reload until its event shows up.
  await expect(async () => {
    await page.reload()
    await expect(page.getByText(/Retention finished/).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
})
```

- [ ] **Step 2: Run e2e locally**

```bash
cd frontend && npm run build
cd ../backend && uv run fastapi run app/main.py --port 8000 &   # serves the built frontend
cd ../frontend && npx playwright test e2e/app.spec.ts
```

Expected: 3 passed. (Stop the backend afterwards.) If your local DB is not fresh, the admin branch may be skipped — run once against a throwaway `SQLITE_PATH` to exercise it.

- [ ] **Step 3: Update `CLAUDE.md`**

In the backend architecture list, after the `stats.py` bullet, add:

```markdown
- `events.py` — admin event log (Settings → Logs), table `event_log`. `log_event(db, …)` joins the caller's session (the scrape path, so events commit with the writes they describe); `record_event`/`spawn_event` open their own session and never raise. `details` is JSON-made-safe (Decimals → strings). A `before_delete` listener on `Product` nulls `event_log.product_id` (SQLite has no FK enforcement). Pruned nightly by `EVENT_LOG_RETENTION_DAYS` (default 30, 0 = keep) in `retention.run_nightly_retention`; deliberately excluded from backup/export. Scrape outcomes carry `ScrapeResult.error` (`timeout`/`navigation`/`unavailable`/`no_match`) and `source` (`selector`/`ld_json`/`itemprop`/`data_price`).
```

In the `scheduler.py` bullet, append: `` `scrape_and_record` returns the outcome (`ok`/`unchanged`/`failed`/`skipped`). Nightly jobs are declared once in `MAINTENANCE_JOBS`. An APScheduler listener logs missed/errored runs. Admin "Run now" (`POST /api/settings/jobs/{id}/run`) adds a one-off `<id>__run_now` date job — never `modify_job(next_run_time=…)`, which would re-anchor the interval and drift the product off its check time. ``

In the `routers/` bullet, append: `` Admin-only `/api/settings/jobs` (enriched with last result from the event log) and `/api/settings/logs` (keyset-paged via `before_id`). ``

In the frontend paragraph, after the sentence about `useSettings`, add: `` Settings tabs (Account · Schedulers · Logs · Admin · About) live in `?tab=`; Logs filters live in the URL too (`utils/logFilters.ts`). ``

- [ ] **Step 4: Full verification**

```bash
cd backend && uv run ruff check app tests && uv run pytest
cd ../frontend && npm run lint && npm test && npm run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/app.spec.ts CLAUDE.md
git commit -m "e2e for settings tabs; document event log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
