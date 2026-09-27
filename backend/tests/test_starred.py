"""Starred products: per-user limit, dedupe, clearing."""
import pytest

from app.schemas import MAX_STARRED_PRODUCTS


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _token(client, username, password="secret1"):
    await client.post("/api/auth/register", json={"username": username, "password": password})
    resp = await client.post("/api/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.mark.asyncio(loop_scope="session")
async def test_starred_limit_dedupe_and_clear(client):
    headers = _auth(await _token(client, "starfan"))
    assert MAX_STARRED_PRODUCTS == 6

    ids = list(range(1, MAX_STARRED_PRODUCTS + 1))
    resp = await client.patch("/api/auth/me/starred", json={"starred_product_ids": ids}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["starred_product_ids"] == ids
    assert (await client.get("/api/auth/me", headers=headers)).json()["starred_product_ids"] == ids

    # One over the limit is rejected and leaves the stored list alone
    resp = await client.patch(
        "/api/auth/me/starred", json={"starred_product_ids": [*ids, 99]}, headers=headers
    )
    assert resp.status_code == 400
    assert str(MAX_STARRED_PRODUCTS) in resp.json()["detail"]
    assert (await client.get("/api/auth/me", headers=headers)).json()["starred_product_ids"] == ids

    # Duplicates don't count against the limit
    resp = await client.patch(
        "/api/auth/me/starred", json={"starred_product_ids": [5, 5, 5, 5, 5, 5, 5, 2]}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["starred_product_ids"] == [5, 2]

    # Empty list clears
    resp = await client.patch("/api/auth/me/starred", json={"starred_product_ids": []}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["starred_product_ids"] == []

    ui = (await client.get("/api/settings/ui", headers=headers)).json()
    assert ui["max_starred_products"] == MAX_STARRED_PRODUCTS
