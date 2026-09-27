"""Starred products: per-user limit, dedupe, clearing, stale ids."""
import pytest

from app.schemas import MAX_STARRED_PRODUCTS


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _token(client, username, password="secret1"):
    await client.post("/api/auth/register", json={"username": username, "password": password})
    resp = await client.post("/api/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _products(client, headers, prefix, count):
    ids = []
    for n in range(count):
        resp = await client.post(
            "/api/products",
            headers=headers,
            json={"name": f"{prefix} {n}", "url": f"https://example.com/{prefix}/{n}", "selector": ".p"},
        )
        assert resp.status_code == 201, resp.text
        ids.append(resp.json()["id"])
    return ids


async def _star(client, headers, ids):
    return await client.patch("/api/auth/me/starred", json={"starred_product_ids": ids}, headers=headers)


async def _me_starred(client, headers):
    return (await client.get("/api/auth/me", headers=headers)).json()["starred_product_ids"]


@pytest.mark.asyncio(loop_scope="session")
async def test_starred_limit_dedupe_and_clear(client):
    headers = _auth(await _token(client, "starfan"))
    assert MAX_STARRED_PRODUCTS == 6
    ids = await _products(client, headers, "star", MAX_STARRED_PRODUCTS + 1)
    allowed = ids[:MAX_STARRED_PRODUCTS]

    resp = await _star(client, headers, allowed)
    assert resp.status_code == 200, resp.text
    assert resp.json()["starred_product_ids"] == allowed
    assert await _me_starred(client, headers) == allowed

    # One over the limit is rejected and leaves the stored list alone
    resp = await _star(client, headers, ids)
    assert resp.status_code == 400
    assert str(MAX_STARRED_PRODUCTS) in resp.json()["detail"]
    assert await _me_starred(client, headers) == allowed

    # Duplicates don't count against the limit
    resp = await _star(client, headers, [ids[4]] * 7 + [ids[1]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["starred_product_ids"] == [ids[4], ids[1]]

    # Empty list clears
    resp = await _star(client, headers, [])
    assert resp.status_code == 200
    assert resp.json()["starred_product_ids"] == []

    ui = (await client.get("/api/settings/ui", headers=headers)).json()
    assert ui["max_starred_products"] == MAX_STARRED_PRODUCTS


@pytest.mark.asyncio(loop_scope="session")
async def test_deleted_product_frees_its_star_slot(client):
    """The reported bug: a starred-then-deleted product kept its slot."""
    headers = _auth(await _token(client, "stardeleter"))
    ids = await _products(client, headers, "del", MAX_STARRED_PRODUCTS + 1)

    assert (await _star(client, headers, ids[:MAX_STARRED_PRODUCTS])).status_code == 200
    assert (await client.delete(f"/api/products/{ids[0]}", headers=headers)).status_code == 204
    assert ids[0] not in await _me_starred(client, headers)

    # The freed slot is usable: 6 live stars again
    resp = await _star(client, headers, [*ids[1:MAX_STARRED_PRODUCTS], ids[MAX_STARRED_PRODUCTS]])
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["starred_product_ids"]) == MAX_STARRED_PRODUCTS


@pytest.mark.asyncio(loop_scope="session")
async def test_stale_and_foreign_ids_are_ignored(client):
    from sqlalchemy import update

    from app.database import AsyncSessionLocal
    from app.models import User

    other = _auth(await _token(client, "star-other"))
    [foreign] = await _products(client, other, "foreign", 1)

    headers = _auth(await _token(client, "star-stale"))
    ids = await _products(client, headers, "stale", MAX_STARRED_PRODUCTS)

    # Stale ids already stored (from before deletes cleaned up) are hidden from /me
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.username == "star-stale").values(starred_product_ids=f"999999,{ids[0]}")
        )
        await db.commit()
    assert await _me_starred(client, headers) == [ids[0]]

    # ...and neither they nor someone else's product count against the limit
    resp = await _star(client, headers, [999999, foreign, *ids])
    assert resp.status_code == 200, resp.text
    assert resp.json()["starred_product_ids"] == ids
