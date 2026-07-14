"""Export → import round-trip, including the PG sequence regression.

Importing preserves row ids, which bypasses the id sequence on PostgreSQL;
without the post-import setval, the next regular insert collides. Creating a
product right after an import is exactly that scenario.
"""
import pytest


async def _login(client, username, password="secret1"):
    resp = await client.post("/api/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio(loop_scope="session")
async def test_export_import_roundtrip_and_insert_after_import(client):
    resp = await client.post(
        "/api/auth/register", json={"username": "impex-admin", "password": "secret1"}
    )
    assert resp.status_code == 201

    # Depending on test order this user may not be the first (auto-admin) one;
    # promote it directly so the export/import endpoints are reachable.
    from sqlalchemy import update

    from app.database import AsyncSessionLocal
    from app.models import User

    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.username == "impex-admin").values(is_admin=True))
        await db.commit()

    headers = await _login(client, "impex-admin")

    resp = await client.post(
        "/api/products",
        headers=headers,
        json={
            "name": "Roundtrip",
            "url": "https://example.com/rt",
            "selector": ".price",
            "record_all_prices": True,
            "price_format": "eu",
        },
    )
    assert resp.status_code == 201
    product_id = resp.json()["id"]

    resp = await client.post(
        f"/api/products/{product_id}/prices",
        headers=headers,
        json={"price": "9.99", "scraped_at": "2026-07-01T10:00:00"},
    )
    assert resp.status_code == 201

    export = (await client.get("/api/settings/export", headers=headers)).json()
    assert any(p["name"] == "Roundtrip" for p in export["products"])

    resp = await client.post("/api/settings/import", headers=headers, json=export)
    assert resp.status_code == 200, resp.text

    # Product survived with its toggles
    headers = await _login(client, "impex-admin")  # import wiped token versions? re-login to be safe
    products = (await client.get("/api/products", headers=headers)).json()
    restored = next(p for p in products if p["name"] == "Roundtrip")
    assert restored["record_all_prices"] is True
    assert restored["price_format"] == "eu"

    # The regression: a fresh insert directly after an id-preserving import.
    resp = await client.post(
        "/api/products",
        headers=headers,
        json={"name": "After Import", "url": "https://example.com/ai", "selector": ".p"},
    )
    assert resp.status_code == 201, resp.text
