"""Integration tests for scrape_and_record — the app's core loop.

scrape_price is faked; everything else (sessions, records, notifications,
alert evaluation, failure counters) runs for real against the test DB.
"""
from decimal import Decimal

import pytest
from sqlalchemy import select

import app.scheduler as scheduler_mod
from app.browser import set_browser
from app.database import AsyncSessionLocal, run_migrations
from app.models import Alert, EventLog, PriceHistory, Product, User
from app.scraper import FAILURE_NO_MATCH, FAILURE_TIMEOUT, ScrapeResult


@pytest.fixture(autouse=True)
def fake_browser():
    set_browser(object(), backend="fake")  # type: ignore[arg-type]
    # Scraper health is global (a storm spans products), so it must not leak
    # between tests — a leftover storm suppresses per-product notifications.
    scheduler_mod.reset_scrape_health()
    yield
    scheduler_mod.reset_scrape_health()
    set_browser(None, backend="unavailable")


@pytest.fixture
def sent_notifications(monkeypatch):
    """Capture owner notifications and price alerts instead of sending them."""
    captured = {"notify": [], "alerts": []}

    async def fake_notify(**kwargs):
        captured["notify"].append(kwargs)

    async def fake_send_alert(**kwargs):
        captured["alerts"].append(kwargs)

    monkeypatch.setattr(scheduler_mod, "notify", fake_notify)
    monkeypatch.setattr(scheduler_mod, "send_alert", fake_send_alert)
    return captured


def scrape_returning(monkeypatch, *results: ScrapeResult):
    """Make scrape_price return the given results in order (last one repeats)."""
    queue = list(results)

    async def fake_scrape(browser, url, selector, price_format="auto"):
        return queue.pop(0) if len(queue) > 1 else queue[0]

    monkeypatch.setattr("app.scraper.scrape_price", fake_scrape)


async def make_product(username: str, **overrides) -> int:
    await run_migrations()
    async with AsyncSessionLocal() as db:
        user = User(username=username, hashed_password="x", default_email="o@example.com")
        db.add(user)
        await db.flush()
        product = Product(
            user_id=user.id,
            name=f"P-{username}",
            url="https://shop.example/item",
            selector=".price",
            **overrides,
        )
        db.add(product)
        await db.commit()
        return product.id


async def prices_for(product_id: int) -> list[PriceHistory]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PriceHistory).where(PriceHistory.product_id == product_id).order_by(PriceHistory.id)
        )
        return result.scalars().all()


async def product_by_id(product_id: int) -> Product:
    async with AsyncSessionLocal() as db:
        return await db.get(Product, product_id)


@pytest.mark.asyncio(loop_scope="session")
async def test_records_price_and_currency(monkeypatch, sent_notifications):
    pid = await make_product("flow-record")
    scrape_returning(monkeypatch, ScrapeResult(19.99, "USD", "https://shop.example/item"))

    await scheduler_mod.scrape_and_record(pid)

    rows = await prices_for(pid)
    assert len(rows) == 1
    assert rows[0].price == Decimal("19.99")
    assert rows[0].currency == "USD"


@pytest.mark.asyncio(loop_scope="session")
async def test_unchanged_price_not_recorded_by_default(monkeypatch, sent_notifications):
    pid = await make_product("flow-unchanged")
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://shop.example/item"))

    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    assert len(await prices_for(pid)) == 1


@pytest.mark.asyncio(loop_scope="session")
async def test_record_all_prices_stores_every_check(monkeypatch, sent_notifications):
    pid = await make_product("flow-recordall", record_all_prices=True)
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://shop.example/item"))

    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    assert len(await prices_for(pid)) == 2


@pytest.mark.asyncio(loop_scope="session")
async def test_failure_threshold_and_recovery_notifications(monkeypatch, sent_notifications):
    pid = await make_product("flow-failure")
    monkeypatch.setattr(scheduler_mod.settings, "scraper_failure_alert_threshold", 2)

    scrape_returning(monkeypatch, ScrapeResult(None, None, None))
    await scheduler_mod.scrape_and_record(pid)
    assert sent_notifications["notify"] == []  # below threshold

    await scheduler_mod.scrape_and_record(pid)
    broken = [n for n in sent_notifications["notify"] if "Selector broken" in n["message"].title]
    assert len(broken) == 1

    await scheduler_mod.scrape_and_record(pid)  # stays broken — no repeat
    broken = [n for n in sent_notifications["notify"] if "Selector broken" in n["message"].title]
    assert len(broken) == 1
    assert (await product_by_id(pid)).consecutive_scrape_failures == 3

    scrape_returning(monkeypatch, ScrapeResult(9.5, "EUR", "https://shop.example/item"))
    await scheduler_mod.scrape_and_record(pid)
    recovered = [n for n in sent_notifications["notify"] if "Recovered" in n["message"].title]
    assert len(recovered) == 1
    assert (await product_by_id(pid)).consecutive_scrape_failures == 0


@pytest.mark.asyncio(loop_scope="session")
async def test_failure_streak_records_reason_and_start(monkeypatch, sent_notifications):
    pid = await make_product("flow-reason")

    scrape_returning(monkeypatch, ScrapeResult(None, None, None, FAILURE_NO_MATCH))
    await scheduler_mod.scrape_and_record(pid)
    first = await product_by_id(pid)
    assert first.last_scrape_error == FAILURE_NO_MATCH
    assert first.scrape_failing_since is not None

    # The streak start stays put; the reason follows the latest check.
    scrape_returning(monkeypatch, ScrapeResult(None, None, None, FAILURE_TIMEOUT))
    await scheduler_mod.scrape_and_record(pid)
    second = await product_by_id(pid)
    assert second.last_scrape_error == FAILURE_TIMEOUT
    assert second.scrape_failing_since == first.scrape_failing_since

    scrape_returning(monkeypatch, ScrapeResult(9.5, "EUR", "https://shop.example/item"))
    await scheduler_mod.scrape_and_record(pid)
    recovered = await product_by_id(pid)
    assert recovered.consecutive_scrape_failures == 0
    assert recovered.last_scrape_error is None
    assert recovered.scrape_failing_since is None


@pytest.mark.asyncio(loop_scope="session")
async def test_currency_change_notifies_once(monkeypatch, sent_notifications):
    pid = await make_product("flow-currency")
    scrape_returning(
        monkeypatch,
        ScrapeResult(10.0, "EUR", "https://shop.example/item"),
        ScrapeResult(11.0, "USD", "https://shop.example/item"),
        ScrapeResult(12.0, "USD", "https://shop.example/item"),
    )

    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    changed = [n for n in sent_notifications["notify"] if "Currency changed" in n["message"].title]
    assert len(changed) == 1


@pytest.mark.asyncio(loop_scope="session")
async def test_below_alert_fires_on_crossing_only(monkeypatch, sent_notifications):
    pid = await make_product("flow-alert")
    async with AsyncSessionLocal() as db:
        db.add(Alert(product_id=pid, condition="below", threshold_price=Decimal("10"), email="a@example.com"))
        await db.commit()

    scrape_returning(
        monkeypatch,
        ScrapeResult(12.0, "EUR", "https://shop.example/item"),
        ScrapeResult(9.0, "EUR", "https://shop.example/item"),   # crossing → fires
        ScrapeResult(8.0, "EUR", "https://shop.example/item"),   # still below → quiet
    )

    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    assert len(sent_notifications["alerts"]) == 1
    assert sent_notifications["alerts"][0]["current_price"] == Decimal("9.00")

    async with AsyncSessionLocal() as db:
        alert = (await db.execute(select(Alert).where(Alert.product_id == pid))).scalar_one()
        assert alert.last_triggered_at is not None
        assert alert.last_checked_at is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_alert_carries_scraped_currency(monkeypatch, sent_notifications):
    from app.notifier import build_alert_message

    pid = await make_product("flow-alert-currency")
    async with AsyncSessionLocal() as db:
        db.add(Alert(product_id=pid, condition="changed", email="a@example.com"))
        await db.commit()

    scrape_returning(
        monkeypatch,
        ScrapeResult(20.0, "USD", "https://shop.example/item"),
        ScrapeResult(18.5, "USD", "https://shop.example/item"),
    )
    await scheduler_mod.scrape_and_record(pid)
    await scheduler_mod.scrape_and_record(pid)

    [sent] = sent_notifications["alerts"]
    assert sent["product_id"] == pid
    assert sent["currency"] == "USD"
    assert sent["current_price"] == Decimal("18.50")

    # The kwargs the scheduler passes must build a real message end to end.
    message = build_alert_message(**{k: v for k, v in sent.items() if k not in ("to_email", "telegram_chat_id")})
    assert ("Now", "$18.50") in message.facts
    assert ("Was", "$20.00 (−7.5%)") in message.facts


@pytest.mark.asyncio(loop_scope="session")
async def test_redirect_blocks_recording_and_notifies(monkeypatch, sent_notifications):
    pid = await make_product("flow-redirect")
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://other.example/different"))

    await scheduler_mod.scrape_and_record(pid)

    assert await prices_for(pid) == []
    assert (await product_by_id(pid)).url_redirected is True
    redirected = [n for n in sent_notifications["notify"] if "URL redirected" in n["message"].title]
    assert len(redirected) == 1


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
