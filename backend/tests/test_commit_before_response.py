"""Writes must be committed before the response reaches the client.

Otherwise a client that acts on a 201 right away (the UI navigating to a new
product, a script adding prices) can get a 404 for the row it just created.
httpx's ASGITransport only returns after the whole ASGI call, cleanup included,
so the check hooks the raw `send` to look at the DB when the response starts.
"""
import json

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Product


@pytest.mark.asyncio(loop_scope="session")
async def test_created_product_is_committed_before_response_starts(client):
    from app.main import app

    await client.post("/api/auth/register", json={"username": "commit-order", "password": "secret1"})
    resp = await client.post("/api/auth/login", data={"username": "commit-order", "password": "secret1"})
    token = resp.json()["access_token"]

    name = "commit-order-widget"
    body = json.dumps(
        {"name": name, "url": "https://example.com/w", "selector": ".price", "active": False}
    ).encode()
    visible_at_response_start: bool | None = None
    status: int | None = None

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        nonlocal visible_at_response_start, status
        if message["type"] == "http.response.start":
            status = message["status"]
            async with AsyncSessionLocal() as db:
                row = (await db.execute(select(Product).where(Product.name == name))).scalar_one_or_none()
            visible_at_response_start = row is not None

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/products",
        "raw_path": b"/api/products",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"test"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"authorization", f"Bearer {token}".encode()),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    await app(scope, receive, send)

    assert status == 201
    assert visible_at_response_start is True
