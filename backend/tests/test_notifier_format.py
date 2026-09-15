"""Notification rendering: Telegram HTML, plain text, links, prices."""
from decimal import Decimal

import httpx
import pytest

import app.notifier as notifier
from app.config import settings
from app.notifier import (
    Notification,
    build_alert_message,
    format_price,
    render_discord,
    render_plain,
    render_telegram_html,
    telegram_payload,
)


def alert(**overrides):
    kwargs = dict(
        product_id=7,
        product_name="Sony <WH-1000XM5> & Case",
        product_url="https://shop.example/item?a=1&b=2",
        condition="lowered_percent",
        current_price=Decimal("279.00"),
        currency="EUR",
        threshold_percent=Decimal("10"),
        previous_price=Decimal("329.00"),
    )
    kwargs.update(overrides)
    return build_alert_message(**kwargs)


@pytest.mark.parametrize(
    ("price", "currency", "expected"),
    [
        (Decimal("279"), "EUR", "€279.00"),
        (Decimal("1234.5"), "USD", "$1,234.50"),
        (Decimal("12"), "CHF", "CHF 12.00"),
        (Decimal("12"), None, "12.00"),
        (None, "EUR", "—"),
    ],
)
def test_format_price(price, currency, expected):
    assert format_price(price, currency) == expected


def test_telegram_html_escapes_product_name_and_urls(monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    text = render_telegram_html(alert())

    assert "📉 <b>Price dropped</b>" in text
    assert "Sony &lt;WH-1000XM5&gt; &amp; Case" in text
    assert "<WH-1000XM5>" not in text
    assert 'href="https://shop.example/item?a=1&amp;b=2"' in text
    assert "Now: <b>€279.00</b>" in text
    assert "Was: <b>€329.00 (−15.2%)</b>" in text
    assert "at least 10% down" in text


def test_caero_link_only_when_public_url_set(monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    assert [label for label, _ in alert().links] == ["Open shop"]

    monkeypatch.setattr(settings, "public_url", "https://caero.example.com/")
    links = dict(alert().links)
    assert links["Open in Caero"] == "https://caero.example.com/products/7"
    assert "Open in Caero: https://caero.example.com/products/7" in render_plain(alert())
    assert "[Open in Caero](<https://caero.example.com/products/7>)" in render_discord(alert())


def test_telegram_uses_buttons_for_public_domains(monkeypatch):
    monkeypatch.setattr(settings, "public_url", "https://caero.example.com")
    payload = telegram_payload("42", alert())

    assert payload["parse_mode"] == "HTML"
    buttons = payload["reply_markup"]["inline_keyboard"][0]
    assert [b["text"] for b in buttons] == ["Open in Caero", "Open shop"]
    assert "<a href" not in payload["text"]


@pytest.mark.parametrize("base", ["http://192.168.1.5:8000", "http://localhost:8000", "http://caero:8000"])
def test_telegram_falls_back_to_text_links_for_lan_urls(monkeypatch, base):
    monkeypatch.setattr(settings, "public_url", base)
    payload = telegram_payload("42", alert())

    assert "reply_markup" not in payload
    assert f'<a href="{base}/products/7">Open in Caero</a>' in payload["text"]


@pytest.mark.parametrize(
    ("condition", "title", "fact"),
    [
        ("below", "Below your target price", ("Target", "€300.00")),
        ("lowered", "Price dropped", ("Now", "€279.00")),
        ("changed", "Price changed", ("Was", "€329.00 (−15.2%)")),
    ],
)
def test_alert_conditions(condition, title, fact):
    message = alert(condition=condition, threshold_price=Decimal("300"))
    assert message.title == title
    assert fact in message.facts


def test_price_increase_shows_plus_sign():
    message = alert(condition="changed", current_price=Decimal("350"))
    assert ("Was", "€329.00 (+6.4%)") in message.facts


def test_first_price_has_no_was_line():
    message = alert(condition="below", previous_price=None, threshold_price=Decimal("300"))
    assert [label for label, _ in message.facts] == ["Now", "Target"]


def test_plain_text_is_readable():
    message = Notification(
        emoji="⚠️", title="Selector broken", product="Lamp", facts=[("Failed checks", "3 in a row")],
        text=["Check the selector."], links=[("Open shop", "https://shop.example")],
    )
    assert message.subject == "Selector broken: Lamp"
    assert render_plain(message) == (
        "Lamp\n\nFailed checks: 3 in a row\n\nCheck the selector.\n\nOpen shop: https://shop.example\n"
    )


@pytest.mark.asyncio(loop_scope="session")
async def test_telegram_400_resends_as_plain_text(monkeypatch):
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        sent.append(json.loads(request.content))
        return httpx.Response(400 if len(sent) == 1 else 200, json={}, request=request)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        notifier.httpx, "AsyncClient", lambda: real_client(transport=httpx.MockTransport(handler))
    )

    await notifier.send_telegram_message("tok", "42", alert())

    assert len(sent) == 2
    assert sent[0]["parse_mode"] == "HTML"
    assert "parse_mode" not in sent[1]
    assert sent[1]["text"].startswith("📉 Price dropped: Sony <WH-1000XM5> & Case")
