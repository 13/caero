"""Admin notification settings: public URL and delivery status."""
import pytest
from sqlalchemy import update

import app.notifier as notifier
from app.database import AsyncSessionLocal
from app.models import User


async def admin_headers(client, username: str) -> dict[str, str]:
    await client.post("/api/auth/register", json={"username": username, "password": "secret1"})
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.username == username).values(is_admin=True))
        await db.commit()
    resp = await client.post("/api/auth/login", data={"username": username, "password": "secret1"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def settings_body(**overrides):
    return {"allow_registration": True, "date_format": "DD.MM.YYYY", "time_format": "24h", **overrides}


@pytest.mark.asyncio(loop_scope="session")
async def test_public_url_setting_roundtrip(client):
    headers = await admin_headers(client, "public-url-admin")
    try:
        resp = await client.post(
            "/api/settings", headers=headers, json=settings_body(public_url="https://caero.example.com/")
        )
        assert resp.status_code == 200
        assert resp.json()["public_url"] == "https://caero.example.com"
        assert notifier.caero_url("/products/3") == "https://caero.example.com/products/3"

        # None keeps the stored value
        resp = await client.post("/api/settings", headers=headers, json=settings_body())
        assert resp.json()["public_url"] == "https://caero.example.com"

        # Not a URL → rejected
        resp = await client.post("/api/settings", headers=headers, json=settings_body(public_url="caero.local"))
        assert resp.status_code == 422
    finally:
        resp = await client.post("/api/settings", headers=headers, json=settings_body(public_url=""))
        assert resp.json()["public_url"] == ""
    assert notifier.get_public_url() == notifier.settings.public_url.strip()


@pytest.mark.asyncio(loop_scope="session")
async def test_notification_status_endpoint(client):
    headers = await admin_headers(client, "status-admin")
    notifier.reset_channel_status()
    notifier._record_delivery("ntfy", RuntimeError("connection refused"))
    try:
        resp = await client.get("/api/settings/notification-status", headers=headers)
        assert resp.status_code == 200
        [row] = resp.json()
        assert row["channel"] == "ntfy"
        assert row["consecutive_failures"] == 1
        assert "connection refused" in row["last_error"]

        assert (await client.get("/api/settings/notification-status")).status_code == 401
    finally:
        notifier.reset_channel_status()
