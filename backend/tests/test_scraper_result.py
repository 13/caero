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
    assert result.error == scraper.FAILURE_NO_MATCH
    assert result.source is None


@pytest.mark.asyncio(loop_scope="session")
async def test_unavailable_page():
    result = await scrape(FakePage(selector_text="9.99", availability="Currently unavailable."))
    assert result.price is None
    assert result.error == scraper.FAILURE_UNAVAILABLE


@pytest.mark.asyncio(loop_scope="session")
async def test_navigation_error_keeps_detail():
    result = await scrape(FakePage(goto_error=RuntimeError("net::ERR_NAME_NOT_RESOLVED")))
    assert result.error == scraper.FAILURE_PAGE_ERROR
    assert "ERR_NAME_NOT_RESOLVED" in result.error_detail


@pytest.mark.asyncio(loop_scope="session")
async def test_timeout(monkeypatch):
    async def slow(*_args, **_kw):
        await asyncio.sleep(5)

    monkeypatch.setattr(scraper, "_scrape_price", slow)
    monkeypatch.setattr(scraper.settings, "scrape_timeout_seconds", 0.05)
    result = await scrape(FakePage())
    assert result.error == scraper.FAILURE_TIMEOUT


def test_positional_constructor_still_works():
    result = scraper.ScrapeResult(1.0, "EUR", None)
    assert (result.error, result.source, result.error_detail) == (None, None, None)
