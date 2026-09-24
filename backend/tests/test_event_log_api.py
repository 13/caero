"""Admin event-log endpoint: access, filters, search, keyset pagination."""
import uuid

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.events import record_event
from app.models import User


async def login(client, username: str, *, admin: bool) -> dict[str, str]:
    await client.post("/api/auth/register", json={"username": username, "password": "secret1"})
    if admin:
        async with AsyncSessionLocal() as db:
            await db.execute(update(User).where(User.username == username).values(is_admin=True))
            await db.commit()
    resp = await client.post("/api/auth/login", data={"username": username, "password": "secret1"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def marker() -> str:
    return f"mk{uuid.uuid4().hex[:10]}"


async def emit(message: str, *, level="info", category="system", event="test_event", product_name=None):
    await record_event(level=level, category=category, event=event, message=message, product_name=product_name)


async def get_logs(client, headers, **params):
    resp = await client.get("/api/settings/logs", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio(loop_scope="session")
async def test_logs_require_admin(client):
    user = await login(client, "logs-user", admin=False)
    assert (await client.get("/api/settings/logs")).status_code == 401
    assert (await client.get("/api/settings/logs", headers=user)).status_code == 403


@pytest.mark.asyncio(loop_scope="session")
async def test_filters_and_search(client):
    headers = await login(client, "logs-admin-filters", admin=True)
    m = marker()
    await emit(f"{m} info scrape", level="info", category="scrape")
    await emit(f"{m} error notify", level="error", category="notification")
    await emit(f"{m} warn system", level="warning", category="system", product_name=f"Widget {m}")

    all_rows = (await get_logs(client, headers, q=m))["items"]
    assert len(all_rows) == 3
    assert [r["id"] for r in all_rows] == sorted((r["id"] for r in all_rows), reverse=True)

    errors = (await get_logs(client, headers, q=m, level="error"))["items"]
    assert [r["message"] for r in errors] == [f"{m} error notify"]

    two_levels = (await get_logs(client, headers, q=m, level=["error", "warning"]))["items"]
    assert len(two_levels) == 2

    scrape = (await get_logs(client, headers, q=m, category="scrape"))["items"]
    assert [r["category"] for r in scrape] == ["scrape"]

    # Case-insensitive, matches product_name too.
    by_name = (await get_logs(client, headers, q=f"WIDGET {m.upper()}"))["items"]
    assert len(by_name) == 1

    assert all_rows[0]["created_at"].endswith(("Z", "+00:00"))


@pytest.mark.asyncio(loop_scope="session")
async def test_search_treats_like_wildcards_literally(client):
    headers = await login(client, "logs-admin-like", admin=True)
    m = marker()
    await emit(f"{m} 50% off")
    await emit(f"{m} 500 off")
    await emit(f"{m} a_b")
    await emit(f"{m} axb")

    assert [r["message"] for r in (await get_logs(client, headers, q=f"{m} 50%"))["items"]] == [f"{m} 50% off"]
    assert [r["message"] for r in (await get_logs(client, headers, q=f"{m} a_b"))["items"]] == [f"{m} a_b"]


@pytest.mark.asyncio(loop_scope="session")
async def test_keyset_pagination_stable_under_inserts(client):
    headers = await login(client, "logs-admin-page", admin=True)
    m = marker()
    for i in range(5):
        await emit(f"{m} #{i}")

    page1 = await get_logs(client, headers, q=m, limit=2)
    assert len(page1["items"]) == 2 and page1["next_before_id"] == page1["items"][-1]["id"]

    await emit(f"{m} arrived later")  # must not shift page 2

    page2 = await get_logs(client, headers, q=m, limit=2, before_id=page1["next_before_id"])
    page3 = await get_logs(client, headers, q=m, limit=2, before_id=page2["next_before_id"])
    assert page3["next_before_id"] is None

    seen = [r["message"] for p in (page1, page2, page3) for r in p["items"]]
    assert seen == [f"{m} #{i}" for i in (4, 3, 2, 1, 0)]


@pytest.mark.asyncio(loop_scope="session")
async def test_param_validation(client):
    headers = await login(client, "logs-admin-validate", admin=True)
    assert (await client.get("/api/settings/logs", headers=headers, params={"limit": 501})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"limit": 0})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"level": "debug"})).status_code == 422
    assert (await client.get("/api/settings/logs", headers=headers, params={"category": "x"})).status_code == 422
