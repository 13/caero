"""Shared Patchright browser instance.

Ownership lives here rather than in the FastAPI lifespan so a browser that dies
mid-run can be replaced in place. That happens for real: the container's memory
ceiling makes the OOM killer pick the largest RSS, which is Chromium and not
uvicorn, so the app survives its own scraper. Without a relaunch path every
later scrape fails silently and every product drifts into "selector broken".

Consumers read the browser from here instead of importing app.main, which would
be a circular import.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from patchright.async_api import Browser

logger = logging.getLogger(__name__)

_browser: Browser | None = None
_backend: str = "unknown"
_playwright = None
# time.monotonic() of the last real launch; None for test doubles, which are
# never recycled.
_launched_at: float | None = None
# Scrapes currently holding the browser (borrow_browser). Recycling waits for 0.
_in_use = 0
# Serializes relaunches: a scrape burst notices the dead browser all at once,
# and each caller must not start its own Chromium.
_relaunch_lock = asyncio.Lock()

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-setuid-sandbox",
]


def set_browser(browser: Browser | None, backend: str = "patchright") -> None:
    global _browser, _backend
    _browser = browser
    _backend = backend


def get_browser() -> Browser | None:
    return _browser


def get_backend() -> str:
    return _backend


def browser_connected() -> bool:
    """True when a browser handle exists and its connection is still live."""
    if _browser is None:
        return False
    # Test doubles have no is_connected(); treat them as alive.
    is_connected = getattr(_browser, "is_connected", None)
    if is_connected is None:
        return True
    try:
        return bool(is_connected()) and _driver_alive(_browser)
    except Exception:
        return False


def _driver_alive(browser: Browser) -> bool:
    """False once the Node driver behind the browser has died.

    is_connected() only flips on a close event sent *by* the driver, so a
    driver that died (it can run out of JS heap after weeks of uptime) leaves
    a handle that claims to be connected while every call fails. The
    transport's error future is set as soon as the driver pipe closes.
    tests/test_stability.py kills a real driver to guard these private names.
    """
    try:
        error_future = browser._impl_obj._connection._transport.on_error_future
    except AttributeError:
        return True  # test doubles
    return not error_future.done()


async def _reset_playwright() -> None:
    global _playwright
    pw = _playwright
    _playwright = None
    if pw is not None:
        # Bounded: stopping a driver that already died must not hang the relaunch.
        try:
            async with asyncio.timeout(10):
                await pw.stop()
        except Exception:
            pass


def _due_for_recycle() -> bool:
    from app.config import settings

    max_age = settings.scraper_browser_max_age_hours
    return (
        bool(max_age)
        and _launched_at is not None
        and _in_use == 0
        and time.monotonic() - _launched_at >= max_age * 3600
    )


async def _launch() -> None:
    global _browser, _backend, _playwright, _launched_at

    import patchright.async_api

    from app.config import settings

    if _playwright is None:
        _playwright = await patchright.async_api.async_playwright().start()

    headless = settings.scraper_headless
    _browser = await _playwright.chromium.launch(headless=headless, args=LAUNCH_ARGS)
    _backend = "patchright"
    _launched_at = time.monotonic()
    logger.info("Patchright browser started in %s mode", "headless" if headless else "headed")


async def start_browser() -> None:
    """Launch the shared browser at startup. Failure is not fatal — the first
    scrape retries via ensure_browser()."""
    global _browser, _backend
    try:
        await _launch()
    except Exception as exc:
        logger.error("Could not start Patchright browser: %s", exc)
        _browser = None
        _backend = "unavailable"
        await _reset_playwright()

        from app.events import record_event

        await record_event(
            level="error",
            category="system",
            event="browser_launch_failed",
            message=f"Could not start scraping browser: {exc}",
            details={"error": str(exc)[:300]},
        )


async def ensure_browser() -> Browser | None:
    """Return a live browser, relaunching it if the current one is gone.

    Covers both a crashed browser and a startup launch that failed, so a
    transient problem no longer leaves the container running without ever
    scraping again. Also recycles a browser past SCRAPER_BROWSER_MAX_AGE_HOURS
    once no scrape holds it (see borrow_browser).
    """
    global _browser, _backend

    if browser_connected() and not _due_for_recycle():
        return _browser

    async with _relaunch_lock:
        # Another caller may have relaunched while this one waited.
        connected = browser_connected()
        if connected and not _due_for_recycle():
            return _browser

        reason = "recycled" if connected else "crashed" if _browser is not None else "not_running"
        dead = _browser
        _browser = None
        if dead is not None:
            try:
                async with asyncio.timeout(10):
                    await dead.close()
            except Exception:
                pass
        # Relaunch on a fresh driver: the old one may be what died, and a
        # launch through it would fail on the same closed pipe.
        await _reset_playwright()

        try:
            await _launch()
        except Exception as exc:
            logger.error("Could not relaunch scraping browser: %s", exc)
            _browser = None
            _backend = "unavailable"
            # The Playwright driver may be the broken part; drop it so the next
            # attempt starts a fresh one.
            await _reset_playwright()

            from app.events import record_event

            await record_event(
                level="error",
                category="system",
                event="browser_launch_failed",
                message=f"Could not relaunch scraping browser: {exc}",
                details={"error": str(exc)[:300]},
            )
            return None

        from app.events import record_event

        if reason == "recycled":
            await record_event(
                level="info",
                category="system",
                event="browser_relaunched",
                message="Scraping browser recycled",
                details={"reason": reason},
            )
            logger.info("Recycled scraping browser and driver")
            return _browser

        await record_event(
            level="warning",
            category="system",
            event="browser_relaunched",
            message="Scraping browser relaunched",
            details={"reason": reason},
        )

        logger.warning("Relaunched scraping browser after it became unavailable")
        return _browser


@asynccontextmanager
async def borrow_browser() -> AsyncIterator[Browser | None]:
    """ensure_browser() for the length of a scrape: a borrowed browser is
    never recycled out from under its user."""
    global _in_use
    browser = await ensure_browser()
    if browser is None:
        yield None
        return
    _in_use += 1
    try:
        yield browser
    finally:
        _in_use -= 1


async def stop_browser() -> None:
    global _browser, _backend
    browser = _browser
    _browser = None
    _backend = "unavailable"
    if browser is not None:
        try:
            await browser.close()
        except Exception:
            pass
    await _reset_playwright()
