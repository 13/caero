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
from app.models import Alert, PriceHistory, Product, User
from app.scraper import ScrapeResult


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
    broken = [n for n in sent_notifications["notify"] if "Selector broken" in n["subject"]]
    assert len(broken) == 1

    await scheduler_mod.scrape_and_record(pid)  # stays broken — no repeat
    broken = [n for n in sent_notifications["notify"] if "Selector broken" in n["subject"]]
    assert len(broken) == 1
    assert (await product_by_id(pid)).consecutive_scrape_failures == 3

    scrape_returning(monkeypatch, ScrapeResult(9.5, "EUR", "https://shop.example/item"))
    await scheduler_mod.scrape_and_record(pid)
    recovered = [n for n in sent_notifications["notify"] if "Recovered" in n["subject"]]
    assert len(recovered) == 1
    assert (await product_by_id(pid)).consecutive_scrape_failures == 0


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

    changed = [n for n in sent_notifications["notify"] if "Currency changed" in n["subject"]]
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
async def test_redirect_blocks_recording_and_notifies(monkeypatch, sent_notifications):
    pid = await make_product("flow-redirect")
    scrape_returning(monkeypatch, ScrapeResult(10.0, "EUR", "https://other.example/different"))

    await scheduler_mod.scrape_and_record(pid)

    assert await prices_for(pid) == []
    assert (await product_by_id(pid)).url_redirected is True
    redirected = [n for n in sent_notifications["notify"] if "URL Redirected" in n["subject"]]
    assert len(redirected) == 1
