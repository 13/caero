"""Guard against schema drift: the migration chain must produce the models.

The test-session DB is created exclusively by `alembic upgrade head`
(conftest → run_migrations), so comparing it against Base.metadata catches
"added a model column but forgot the migration" — which would otherwise only
surface on a user's fresh install.
"""
import pytest
from sqlalchemy import inspect

import app.models  # noqa: F401 — register all models on Base
from app.database import Base, engine, run_migrations


@pytest.mark.asyncio(loop_scope="session")
async def test_migrated_schema_matches_models():
    await run_migrations()

    async with engine.connect() as conn:
        def collect(sync_conn):
            inspector = inspect(sync_conn)
            tables = {
                name: {col["name"] for col in inspector.get_columns(name)}
                for name in inspector.get_table_names()
                if name != "alembic_version"
            }
            return tables

        actual = await conn.run_sync(collect)

    expected = {
        name: {col.name for col in table.columns}
        for name, table in Base.metadata.tables.items()
    }

    assert set(actual) == set(expected), (
        f"table mismatch: missing {set(expected) - set(actual)}, "
        f"extra {set(actual) - set(expected)}"
    )
    for name in expected:
        assert actual[name] == expected[name], (
            f"{name}: missing columns {expected[name] - actual[name]}, "
            f"extra columns {actual[name] - expected[name]}"
        )
