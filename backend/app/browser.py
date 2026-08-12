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
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from patchright.async_api import Browser

logger = logging.getLogger(__name__)

_browser: Browser | None = None
_backend: str = "unknown"
_playwright = None
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
        return bool(is_connected())
    except Exception:
        return False


async def _reset_playwright() -> None:
    global _playwright
    pw = _playwright
    _playwright = None
    if pw is not None:
        try:
            await pw.stop()
        except Exception:
            pass


async def _launch() -> None:
    global _browser, _backend, _playwright

    import patchright.async_api

    from app.config import settings

    if _playwright is None:
        _playwright = await patchright.async_api.async_playwright().start()

    headless = settings.scraper_headless
    _browser = await _playwright.chromium.launch(headless=headless, args=LAUNCH_ARGS)
    _backend = "patchright"
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


async def ensure_browser() -> Browser | None:
    """Return a live browser, relaunching it if the current one is gone.

    Covers both a crashed browser and a startup launch that failed, so a
    transient problem no longer leaves the container running without ever
    scraping again.
    """
    global _browser, _backend

    if browser_connected():
        return _browser

    async with _relaunch_lock:
        # Another caller may have relaunched while this one waited.
        if browser_connected():
            return _browser

        dead = _browser
        _browser = None
        if dead is not None:
            try:
                await dead.close()
            except Exception:
                pass

        try:
            await _launch()
        except Exception as exc:
            logger.error("Could not relaunch scraping browser: %s", exc)
            _browser = None
            _backend = "unavailable"
            # The Playwright driver may be the broken part; drop it so the next
            # attempt starts a fresh one.
            await _reset_playwright()
            return None

        logger.warning("Relaunched scraping browser after it became unavailable")
        return _browser


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
