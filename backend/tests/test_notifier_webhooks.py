"""Webhook channel dispatch in notify()."""
import pytest

import app.notifier as notifier
from app.config import settings


@pytest.fixture
def webhook_calls(monkeypatch):
    calls = []

    async def fake_post(channel, url, **kwargs):
        calls.append({"channel": channel, "url": url, **kwargs})

    monkeypatch.setattr(notifier, "_post_with_retry", fake_post)
    return calls


@pytest.mark.asyncio(loop_scope="session")
async def test_all_configured_webhooks_receive_notification(monkeypatch, webhook_calls):
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.sh/caero")
    monkeypatch.setattr(settings, "gotify_url", "https://gotify.example/")
    monkeypatch.setattr(settings, "gotify_token", "tok")
    monkeypatch.setattr(settings, "discord_webhook_url", "https://discord.com/api/webhooks/x")

    await notifier.notify(email=None, telegram_chat_id=None, message=notifier.Notification(title="Subj", text=["Body"]))

    channels = {c["channel"] for c in webhook_calls}
    assert channels == {"ntfy", "Gotify", "Discord"}

    gotify = next(c for c in webhook_calls if c["channel"] == "Gotify")
    assert gotify["url"] == "https://gotify.example/message"
    assert gotify["params"] == {"token": "tok"}
    assert gotify["json"]["title"] == "Subj"

    discord = next(c for c in webhook_calls if c["channel"] == "Discord")
    assert discord["json"]["content"].startswith("**Subj**")

    ntfy = next(c for c in webhook_calls if c["channel"] == "ntfy")
    assert ntfy["headers"]["Title"] == "Subj"
    assert "Click" not in ntfy["headers"]


@pytest.mark.asyncio(loop_scope="session")
async def test_ntfy_title_with_non_ascii_product_is_encoded(monkeypatch, webhook_calls):
    import httpx

    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.sh/caero")
    message = notifier.Notification(
        title="Price dropped", product="Kaffeemühle", links=[("Open shop", "https://shop.example")]
    )
    await notifier.notify(email=None, telegram_chat_id=None, message=message)

    headers = webhook_calls[0]["headers"]
    assert headers["Title"].startswith("=?utf-8?")
    assert headers["Click"] == "https://shop.example"
    httpx.Request("POST", "https://ntfy.sh/caero", headers=headers)  # must not raise


@pytest.mark.asyncio(loop_scope="session")
async def test_no_channels_configured_is_a_noop(webhook_calls):
    await notifier.notify(email=None, telegram_chat_id=None, message=notifier.Notification(title="S"))
    assert webhook_calls == []


@pytest.mark.asyncio(loop_scope="session")
async def test_gotify_needs_both_url_and_token(monkeypatch, webhook_calls):
    monkeypatch.setattr(settings, "gotify_url", "https://gotify.example")

    await notifier.notify(email=None, telegram_chat_id=None, message=notifier.Notification(title="S"))
    assert webhook_calls == []


@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_test_endpoint(client, monkeypatch, webhook_calls):
    from sqlalchemy import update

    from app.database import AsyncSessionLocal
    from app.models import User

    resp = await client.post(
        "/api/auth/register", json={"username": "hook-admin", "password": "secret1"}
    )
    assert resp.status_code == 201
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.username == "hook-admin").values(is_admin=True))
        await db.commit()
    resp = await client.post("/api/auth/login", data={"username": "hook-admin", "password": "secret1"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    # Nothing configured → error, no sends
    resp = await client.post("/api/settings/test-webhooks", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"
    assert webhook_calls == []

    # One channel configured → test message dispatched
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.sh/caero")
    resp = await client.post("/api/settings/test-webhooks", headers=headers)
    assert resp.json()["status"] == "sent"
    assert "ntfy" in resp.json()["message"]
    assert len(webhook_calls) == 1

    # Admin-only
    resp = await client.post("/api/settings/test-webhooks")
    assert resp.status_code == 401
