"""Test environment: isolated SQLite DB, fixed secret, no single-user mode.

Must set env vars before any `app.*` import — app.config instantiates
Settings at import time and app.database builds the engine from it.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="caero-tests-")
# DB_TYPE stays overridable so CI can run the same suite against PostgreSQL
# (see the `backend-postgres` job in .github/workflows/ci.yml).
os.environ.setdefault("DB_TYPE", "sqlite")
os.environ["SQLITE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["SINGLE_USER_MODE"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production-use-only-tests"

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402


@pytest_asyncio.fixture(scope="session")
async def client():
    """HTTP client against the real ASGI app with a migrated throwaway DB.

    ASGITransport does not run the lifespan, so migrations are applied
    manually and no browser/scheduler is started.
    """
    from app.database import run_migrations
    from app.main import app

    await run_migrations()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
