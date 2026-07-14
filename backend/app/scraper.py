"""Price scraper using Patchright."""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

from patchright.async_api import Browser, Page

from app.config import settings
from app.parsing import detect_currency, parse_price

logger = logging.getLogger(__name__)

_scrape_sem = asyncio.Semaphore(settings.scraper_concurrency)


@dataclass
class ScrapeResult:
    price: float | None
    currency: str | None
    final_url: str | None


async def _is_unavailable(page: Page) -> bool:
    """Detect an explicit "product unavailable" state (Amazon-style pages).

    Returns True only on a positive unavailability signal — the availability box
    says so AND there's no active buy box — so it stays a no-op for sites that
    don't render these markers and for in-stock products.
    """
    try:
        avail = await page.query_selector("#availability")
        if avail is None:
            return False
        text = (await avail.inner_text() or "").strip().lower()
        markers = (
            "non disponibile",        # IT — "Attualmente non disponibile"
            "currently unavailable",  # EN
            "nicht verfügbar",        # DE
            "no disponible",          # ES
            "non disponible",         # FR
        )
        if not any(marker in text for marker in markers):
            return False
        # Confirm there's no purchasable buy box, to avoid false positives where
        # the unavailable text refers to one shipping option but the item sells.
        buy_box = await page.query_selector(
            "#add-to-cart-button, #buy-now-button, #addToCart_feature_div input[name='submit.add-to-cart']"
        )
        return buy_box is None
    except Exception:
        return False


async def _try_ld_json(page: Page) -> tuple[float | None, str | None]:
    try:
        scripts = await page.query_selector_all("script[type='application/ld+json']")
        for script in scripts:
            text = await script.inner_text()
            data = json.loads(text)
            # Handle @graph array
            if isinstance(data, dict) and "@graph" in data:
                data = data["@graph"]
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "offers" in item:
                        data = item
                        break
            if isinstance(data, dict):
                offers = data.get("offers")
                if isinstance(offers, list) and offers:
                    offers = offers[0]
                if isinstance(offers, dict):
                    price = offers.get("price")
                    if price is not None:
                        currency = offers.get("priceCurrency")
                        return float(price), currency if isinstance(currency, str) else None
    except Exception:
        pass
    return None, None


async def _try_itemprop(page: Page) -> tuple[float | None, str | None]:
    try:
        el = await page.query_selector("[itemprop='price']")
        if el:
            currency = None
            currency_el = await page.query_selector("[itemprop='priceCurrency']")
            if currency_el:
                currency = await currency_el.get_attribute("content")

            content = await el.get_attribute("content")
            if content:
                return parse_price(content), currency
            text = await el.inner_text()
            return parse_price(text), currency or detect_currency(text)
    except Exception:
        pass
    return None, None


async def _try_data_price(page: Page) -> float | None:
    try:
        el = await page.query_selector("[data-price]")
        if el:
            val = await el.get_attribute("data-price")
            if val:
                return parse_price(val)
    except Exception:
        pass
    return None


async def scrape_price(
    browser: Browser, url: str, selector: str, price_format: str = "auto"
) -> ScrapeResult:
    """
    Scrape a price from the given URL using the given CSS selector.
    Falls back to ld+json, itemprop, and data-price if selector fails.
    """
    async with _scrape_sem:
        return await _scrape_price(browser, url, selector, price_format)


async def _scrape_price(
    browser: Browser, url: str, selector: str, price_format: str = "auto"
) -> ScrapeResult:
    context = None
    page = None
    try:
        # Realistic context; deliberately no user_agent override — Patchright's
        # own UA matches the bundled Chromium, a stale hardcoded one is a
        # fingerprinting red flag. Locale/timezone must agree with each other,
        # so both come from config.
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            locale=settings.scraper_locale,
            timezone_id=settings.scraper_timezone,
            has_touch=False,
            is_mobile=False,
        )
        page = await context.new_page()

        await page.goto(url, timeout=60000, wait_until="domcontentloaded")
        await page.wait_for_timeout(500)

        # If the page explicitly reports the product as unavailable, return no
        # price up front — don't let the selector or fallbacks pick up a stale or
        # unrelated price elsewhere on the page.
        if await _is_unavailable(page):
            logger.info("Product page reports unavailable, returning no price: %s", url)
            return ScrapeResult(None, None, await _current_url(page))

        price = None
        currency = None

        # Primary: user-supplied CSS selector
        try:
            await page.wait_for_selector(selector, timeout=10000)
            el = page.locator(selector).first
            if await el.count() > 0:
                text = await el.inner_text()
                price = parse_price(text, price_format)
                currency = detect_currency(text)
        except Exception:
            pass

        # Fallback 1: ld+json
        if price is None:
            price, currency = await _try_ld_json(page)

        # Fallback 2: itemprop="price"
        if price is None:
            price, currency = await _try_itemprop(page)

        # Fallback 3: data-price attribute
        if price is None:
            price = await _try_data_price(page)
            currency = None

        return ScrapeResult(price, currency, await _current_url(page))

    except Exception as exc:
        logger.warning("scrape_price failed for %s: %s", url, exc)
        return ScrapeResult(None, None, None)
    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass
        if context:
            try:
                await context.close()
            except Exception:
                pass


async def _current_url(page: Page) -> str | None:
    # Capture URL after all scraping so JS-based redirects (including pushState)
    # are reflected. page.url is a cached Python-side property; evaluate forces
    # a browser round-trip.
    try:
        return await page.evaluate("window.location.href")
    except Exception:
        return page.url
