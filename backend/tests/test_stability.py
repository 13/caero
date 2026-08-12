"""Failure-path tests: browser recovery, scrape timeouts, failure storms,
duplicate check-all, and the SQLite locking pragmas.

These cover the paths that turn a transient problem into a permanent one.
"""
import asyncio

import pytest

import app.browser as browser_mod
import app.scheduler as scheduler_mod
from app.config import settings
from app.database import AsyncSessionLocal, engine, run_migrations
from app.models import Product, User
from app.scraper import ScrapeResult, scrape_price


class DeadBrowser:
    def __init__(self) -> None:
        self.closed = False

    def is_connected(self) -> bool:
        return False

    async def close(self) -> None:
        self.closed = True


class LiveBrowser:
    def is_connected(self) -> bool:
        return True


@pytest.fixture(autouse=True)
def clean_health():
    scheduler_mod.reset_scrape_health()
    yield
    scheduler_mod.reset_scrape_health()
    browser_mod.set_browser(None, backend="unavailable")


@pytest.fixture
def sent_notifications(monkeypatch):
    captured = {"notify": [], "alerts": []}

    async def fake_notify(**kwargs):
        captured["notify"].append(kwargs)

    async def fake_send_alert(**kwargs):
        captured["alerts"].append(kwargs)

    monkeypatch.setattr(scheduler_mod, "notify", fake_notify)
    monkeypatch.setattr(scheduler_mod, "send_alert", fake_send_alert)
    return captured


async def make_product(username: str) -> int:
    """One product owned by its own fresh user."""
    await run_migrations()
    async with AsyncSessionLocal() as db:
        user = User(username=username, hashed_password="x", default_email=f"{username}@example.com")
        db.add(user)
        await db.flush()
        product = Product(
            user_id=user.id,
            name=f"P-{username}",
            url="https://shop.example/item",
            selector=".price",
        )
        db.add(product)
        await db.commit()
        return product.id


def subjects(captured, needle: str) -> list[dict]:
    return [n for n in captured["notify"] if needle in n["subject"]]


class TestBrowserRecovery:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_live_browser_is_reused(self, monkeypatch):
        live = LiveBrowser()
        browser_mod.set_browser(live, backend="patchright")

        async def fail_launch():
            raise AssertionError("must not relaunch a live browser")

        monkeypatch.setattr(browser_mod, "_launch", fail_launch)
        assert await browser_mod.ensure_browser() is live

    @pytest.mark.asyncio(loop_scope="session")
    async def test_dead_browser_is_relaunched_and_closed(self, monkeypatch):
        dead = DeadBrowser()
        replacement = LiveBrowser()
        browser_mod.set_browser(dead, backend="patchright")

        async def fake_launch():
            browser_mod.set_browser(replacement, backend="patchright")

        monkeypatch.setattr(browser_mod, "_launch", fake_launch)

        assert await browser_mod.ensure_browser() is replacement
        assert dead.closed  # the corpse is reaped, not leaked

    @pytest.mark.asyncio(loop_scope="session")
    async def test_concurrent_callers_relaunch_once(self, monkeypatch):
        """A scrape burst notices the dead browser all at once."""
        browser_mod.set_browser(DeadBrowser(), backend="patchright")
        launches = 0

        async def fake_launch():
            nonlocal launches
            launches += 1
            await asyncio.sleep(0.01)  # widen the race window
            browser_mod.set_browser(LiveBrowser(), backend="patchright")

        monkeypatch.setattr(browser_mod, "_launch", fake_launch)

        results = await asyncio.gather(*[browser_mod.ensure_browser() for _ in range(5)])
        assert launches == 1
        assert all(r is not None for r in results)

    @pytest.mark.asyncio(loop_scope="session")
    async def test_failed_relaunch_reports_unavailable(self, monkeypatch):
        browser_mod.set_browser(DeadBrowser(), backend="patchright")

        async def fake_launch():
            raise RuntimeError("no chromium")

        monkeypatch.setattr(browser_mod, "_launch", fake_launch)

        assert await browser_mod.ensure_browser() is None
        assert browser_mod.get_backend() == "unavailable"
        assert not browser_mod.browser_connected()

    @pytest.mark.asyncio(loop_scope="session")
    async def test_test_doubles_count_as_connected(self):
        browser_mod.set_browser(object(), backend="fake")
        assert browser_mod.browser_connected()


class TestScrapeTimeout:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_wedged_browser_does_not_hold_the_slot(self, monkeypatch):
        """A hung scrape must return, not park its concurrency slot forever."""

        class HangingBrowser:
            async def new_context(self, **_kwargs):
                await asyncio.sleep(30)

        monkeypatch.setattr(settings, "scrape_timeout_seconds", 1)

        result = await asyncio.wait_for(
            scrape_price(HangingBrowser(), "https://shop.example/x", ".price"),
            timeout=5,
        )
        assert result == ScrapeResult(None, None, None)

        # The semaphore slot came back: a second scrape still runs.
        again = await asyncio.wait_for(
            scrape_price(HangingBrowser(), "https://shop.example/x", ".price"),
            timeout=5,
        )
        assert again == ScrapeResult(None, None, None)


class TestFailureStorm:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_widespread_failure_sends_one_notice_per_user(
        self, monkeypatch, sent_notifications
    ):
        monkeypatch.setattr(scheduler_mod.settings, "scraper_failure_alert_threshold", 1)
        monkeypatch.setattr(scheduler_mod.settings, "scrape_storm_min_products", 3)
        browser_mod.set_browser(object(), backend="fake")

        async def fake_scrape(browser, url, selector, price_format="auto"):
            return ScrapeResult(None, None, None)

        monkeypatch.setattr("app.scraper.scrape_price", fake_scrape)

        for i in range(4):
            await scheduler_mod.scrape_and_record(await make_product(f"storm-{i}"))

        # The first two cross the threshold before a storm is recognisable; from
        # the third on it is one message per user, not one per product.
        assert len(subjects(sent_notifications, "Selector broken")) == 2
        assert len(subjects(sent_notifications, "Scraping is failing")) == 2
        assert scheduler_mod.scraping_looks_broken()

    @pytest.mark.asyncio(loop_scope="session")
    async def test_recovery_answers_the_outage_notice(self, monkeypatch, sent_notifications):
        monkeypatch.setattr(scheduler_mod.settings, "scraper_failure_alert_threshold", 1)
        monkeypatch.setattr(scheduler_mod.settings, "scrape_storm_min_products", 2)
        browser_mod.set_browser(object(), backend="fake")

        current = {"result": ScrapeResult(None, None, None)}

        async def fake_scrape(browser, url, selector, price_format="auto"):
            return current["result"]

        monkeypatch.setattr("app.scraper.scrape_price", fake_scrape)

        pids = [await make_product(f"storm-recover-{i}") for i in range(3)]
        for pid in pids:
            await scheduler_mod.scrape_and_record(pid)
        assert scheduler_mod.scraping_looks_broken()
        notified_before = set(scheduler_mod._storm_notified_users)
        assert len(notified_before) == 2

        current["result"] = ScrapeResult(12.0, "EUR", "https://shop.example/item")
        await scheduler_mod.scrape_and_record(pids[-1])

        assert len(subjects(sent_notifications, "Scraping recovered")) == 1
        assert not scheduler_mod.scraping_looks_broken()
        assert scheduler_mod.last_successful_scrape_at() is not None
        # Only the recovered owner is cleared; the others still owe a notice.
        assert len(scheduler_mod._storm_notified_users) == len(notified_before) - 1

    @pytest.mark.asyncio(loop_scope="session")
    async def test_isolated_failure_still_reports_a_broken_selector(
        self, monkeypatch, sent_notifications
    ):
        monkeypatch.setattr(scheduler_mod.settings, "scraper_failure_alert_threshold", 1)
        monkeypatch.setattr(scheduler_mod.settings, "scrape_storm_min_products", 3)
        browser_mod.set_browser(object(), backend="fake")

        async def fake_scrape(browser, url, selector, price_format="auto"):
            return ScrapeResult(None, None, None)

        monkeypatch.setattr("app.scraper.scrape_price", fake_scrape)

        await scheduler_mod.scrape_and_record(await make_product("storm-single"))

        assert len(subjects(sent_notifications, "Selector broken")) == 1
        assert not scheduler_mod.scraping_looks_broken()


class TestCheckAllGuard:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_second_pass_is_dropped_not_queued(self, monkeypatch):
        calls: list[int] = []

        async def fake_scrape_and_record(product_id: int) -> None:
            calls.append(product_id)
            assert scheduler_mod.check_all_in_progress()
            await asyncio.sleep(0.01)

        monkeypatch.setattr(scheduler_mod, "scrape_and_record", fake_scrape_and_record)

        await asyncio.gather(
            scheduler_mod.run_check_all([1, 2, 3]),
            scheduler_mod.run_check_all([1, 2, 3]),
        )

        assert calls == [1, 2, 3]
        assert not scheduler_mod.check_all_in_progress()

    @pytest.mark.asyncio(loop_scope="session")
    async def test_one_failure_does_not_abort_the_pass(self, monkeypatch):
        seen: list[int] = []

        async def fake_scrape_and_record(product_id: int) -> None:
            seen.append(product_id)
            if product_id == 2:
                raise RuntimeError("boom")

        monkeypatch.setattr(scheduler_mod, "scrape_and_record", fake_scrape_and_record)

        await scheduler_mod.run_check_all([1, 2, 3])
        assert seen == [1, 2, 3]
        assert not scheduler_mod.check_all_in_progress()


class TestHealthEndpoint:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_reports_scraper_state(self, client):
        browser_mod.set_browser(object(), backend="fake")

        response = await client.get("/api/health")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["browser_connected"] is True
        assert body["browser_backend"] == "fake"
        assert body["scraping_degraded"] is False
        assert "last_successful_scrape_at" in body

    @pytest.mark.asyncio(loop_scope="session")
    async def test_stays_200_when_scraping_is_broken(self, client, monkeypatch):
        """Failing the probe would restart-loop the container over a problem a
        restart may not fix."""
        browser_mod.set_browser(None, backend="unavailable")
        monkeypatch.setattr(scheduler_mod.settings, "scrape_storm_min_products", 1)
        scheduler_mod._record_scrape_failure(1)

        response = await client.get("/api/health")

        assert response.status_code == 200
        assert response.json()["browser_connected"] is False
        assert response.json()["scraping_degraded"] is True


class TestSqlitePragmas:
    @pytest.mark.asyncio(loop_scope="session")
    async def test_wal_and_busy_timeout_are_set(self):
        if settings.db_type != "sqlite":
            pytest.skip("SQLite-only pragmas")

        async with engine.connect() as conn:
            journal_mode = await conn.exec_driver_sql("PRAGMA journal_mode")
            busy_timeout = await conn.exec_driver_sql("PRAGMA busy_timeout")
            assert journal_mode.scalar().lower() == "wal"
            assert busy_timeout.scalar() == 10000
