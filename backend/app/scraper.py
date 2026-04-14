"""Price scraper using Playwright."""
from __future__ import annotations

import json
import logging
import re

from playwright.async_api import Browser, Page

logger = logging.getLogger(__name__)


def _parse_price(raw: str) -> float | None:
    """Normalise European and English price strings to float."""
    if not raw:
        return None
    # Remove currency symbols and whitespace
    cleaned = re.sub(r"[^\d.,]", "", raw.strip())
    if not cleaned:
        return None

    # Detect European format: 1.234,56 or 1234,56
    if re.search(r"\d\.\d{3},\d{2}$", cleaned):
        # Thousands dot + comma decimal: 1.234,56 → 1234.56
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif re.search(r",\d{2}$", cleaned):
        # Comma decimal only: 1234,56 → 1234.56
        cleaned = cleaned.replace(",", ".")
    else:
        # English format or no decimal: remove commas as thousands sep
        cleaned = cleaned.replace(",", "")

    try:
        return float(cleaned)
    except ValueError:
        return None


async def _try_ld_json(page: Page) -> float | None:
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
                if isinstance(offers, dict):
                    price = offers.get("price")
                    if price is not None:
                        return float(price)
                elif isinstance(offers, list) and offers:
                    price = offers[0].get("price")
                    if price is not None:
                        return float(price)
    except Exception:
        pass
    return None


async def _try_itemprop(page: Page) -> float | None:
    try:
        el = await page.query_selector("[itemprop='price']")
        if el:
            content = await el.get_attribute("content")
            if content:
                return _parse_price(content)
            text = await el.inner_text()
            return _parse_price(text)
    except Exception:
        pass
    return None


async def _try_data_price(page: Page) -> float | None:
    try:
        el = await page.query_selector("[data-price]")
        if el:
            val = await el.get_attribute("data-price")
            if val:
                return _parse_price(val)
    except Exception:
        pass
    return None


async def scrape_price(browser: Browser, url: str, selector: str) -> float | None:
    """
    Scrape a price from the given URL using the given CSS selector.
    Falls back to ld+json, itemprop, and data-price if selector fails.
    """
    page = None
    try:
        page = await browser.new_page()
        await page.set_extra_http_headers(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            }
        )
        await page.goto(url, timeout=30000, wait_until="networkidle")
        await page.wait_for_timeout(3000)

        # Primary: user-supplied CSS selector
        try:
            await page.wait_for_selector(selector, timeout=10000)
            el = await page.query_selector(selector)
            if el:
                text = await el.inner_text()
                price = _parse_price(text)
                if price is not None:
                    return price
        except Exception:
            pass

        # Fallback 1: ld+json
        price = await _try_ld_json(page)
        if price is not None:
            return price

        # Fallback 2: itemprop="price"
        price = await _try_itemprop(page)
        if price is not None:
            return price

        # Fallback 3: data-price attribute
        price = await _try_data_price(page)
        return price

    except Exception as exc:
        logger.warning("scrape_price failed for %s: %s", url, exc)
        return None
    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass
