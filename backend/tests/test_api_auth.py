"""API-level tests: auth guards, settings visibility, token revocation."""
import pytest


async def _register(client, username, password="secret1"):
    return await client.post("/api/auth/register", json={"username": username, "password": password})


async def _login(client, username, password="secret1"):
    resp = await client.post("/api/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio(loop_scope="session")
async def test_auth_and_settings_guards(client):
    # First registered user becomes admin
    resp = await _register(client, "admin1")
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is True

    resp = await _register(client, "user1")
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is False

    admin_token = await _login(client, "admin1")
    user_token = await _login(client, "user1")

    # Unauthenticated requests are rejected
    assert (await client.get("/api/settings")).status_code == 401
    assert (await client.get("/api/settings/system-info")).status_code == 401
    assert (await client.get("/api/settings/ui")).status_code == 401

    # Health probe needs no auth
    assert (await client.get("/api/health")).status_code == 200

    # Full settings are admin-only
    assert (await client.get("/api/settings", headers=_auth(user_token))).status_code == 403
    resp = await client.get("/api/settings", headers=_auth(admin_token))
    assert resp.status_code == 200
    body = resp.json()
    # Secrets must never appear in the payload
    assert "telegram_bot_token" not in body
    assert "pg_password" not in body
    assert body["telegram_bot_token_set"] is False

    # UI settings are available to every authenticated user
    resp = await client.get("/api/settings/ui", headers=_auth(user_token))
    assert resp.status_code == 200
    assert set(resp.json()) == {"date_format", "time_format", "show_sparklines"}
    assert resp.json()["show_sparklines"] is True

    resp = await client.patch(
        "/api/settings/ui",
        headers=_auth(user_token),
        json={"date_format": "YYYY-MM-DD", "time_format": "12h", "show_sparklines": False},
    )
    assert resp.status_code == 200
    assert resp.json()["date_format"] == "YYYY-MM-DD"
    assert resp.json()["show_sparklines"] is False

    # Omitting show_sparklines keeps the stored value (older clients)
    resp = await client.patch(
        "/api/settings/ui",
        headers=_auth(user_token),
        json={"date_format": "YYYY-MM-DD", "time_format": "12h"},
    )
    assert resp.json()["show_sparklines"] is False

    # Saving a bot token flips the flag without echoing the token
    resp = await client.post(
        "/api/settings",
        headers=_auth(admin_token),
        json={
            "allow_registration": True,
            "date_format": "YYYY-MM-DD",
            "time_format": "12h",
            "telegram_bot_token": "123:abc",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["telegram_bot_token_set"] is True
    assert "123:abc" not in resp.text


@pytest.mark.asyncio(loop_scope="session")
async def test_logout_revokes_all_tokens(client):
    await _register(client, "revoker")
    token_a = await _login(client, "revoker")
    token_b = await _login(client, "revoker")

    assert (await client.get("/api/auth/me", headers=_auth(token_a))).status_code == 200

    resp = await client.post("/api/auth/logout", headers=_auth(token_a))
    assert resp.status_code == 200

    # Both outstanding tokens are now invalid
    assert (await client.get("/api/auth/me", headers=_auth(token_a))).status_code == 401
    assert (await client.get("/api/auth/me", headers=_auth(token_b))).status_code == 401

    # Fresh login works again
    token_c = await _login(client, "revoker")
    assert (await client.get("/api/auth/me", headers=_auth(token_c))).status_code == 200


@pytest.mark.asyncio(loop_scope="session")
async def test_product_record_all_prices_roundtrip(client):
    await _register(client, "producer")
    token = await _login(client, "producer")

    resp = await client.post(
        "/api/products",
        headers=_auth(token),
        json={"name": "Widget", "url": "https://example.com/w", "selector": ".price"},
    )
    assert resp.status_code == 201
    product = resp.json()
    assert product["record_all_prices"] is False

    resp = await client.patch(
        f"/api/products/{product['id']}",
        headers=_auth(token),
        json={"record_all_prices": True},
    )
    assert resp.status_code == 200
    assert resp.json()["record_all_prices"] is True


@pytest.mark.asyncio(loop_scope="session")
async def test_sparklines_endpoint(client):
    await _register(client, "sparkler")
    token = await _login(client, "sparkler")

    resp = await client.post(
        "/api/products",
        headers=_auth(token),
        json={"name": "Sparky", "url": "https://example.com/s", "selector": ".p"},
    )
    product_id = resp.json()["id"]

    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    for price, when in (("10.00", now - timedelta(days=2)), ("12.00", now - timedelta(days=1))):
        resp = await client.post(
            f"/api/products/{product_id}/prices",
            headers=_auth(token),
            json={"price": price, "scraped_at": when.isoformat()},
        )
        assert resp.status_code == 201

    resp = await client.get("/api/products/sparklines", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert str(product_id) in data
    assert [point["p"] for point in data[str(product_id)]] == ["10.00", "12.00"]

    # Only own products appear
    other_token = await _login(client, "user1")
    resp = await client.get("/api/products/sparklines", headers=_auth(other_token))
    assert str(product_id) not in resp.json()
