"""Event log writer: persistence, JSON safety, failure isolation, product detach."""
import asyncio
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


@pytest.mark.asyncio(loop_scope="session")
async def test_spawn_event_from_worker_thread_records_after_drain():
    """Email delivery bookkeeping runs inside asyncio.to_thread(...), where there
    is no running loop — spawn_event must still schedule the event via the
    bound loop rather than silently dropping it."""
    pid = await make_product("ev-thread")
    events.bind_event_loop(asyncio.get_running_loop())

    await asyncio.to_thread(
        lambda: events.spawn_event(level="warning", category="system", event="from_thread", message="m",
                                    product_id=pid)
    )
    await events.drain_pending_events()
    [row] = await events_where(product_id=pid)
    assert row.event == "from_thread"
