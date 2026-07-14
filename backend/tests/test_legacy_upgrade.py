"""Upgrade paths for pre-1.6 databases.

The v1.6.0 release stamped legacy (create_all-era) databases straight to head
without applying migrations 0014+ — startup then crashed on missing columns.
These tests build a *real* 0013-era schema (via alembic, not current models)
and verify both the corrected legacy path and the self-heal for databases the
broken release already mis-stamped.

Run in a subprocess: the scenario needs its own database and engine, and
app.database builds the engine at import time from the environment.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent

SCENARIO_SCRIPT = """
import asyncio
import os

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import inspect as sa_inspect, text

from app.database import LEGACY_STAMP_REVISION, _alembic_config, engine, run_migrations

MODE = os.environ["SCENARIO"]


def check(sync_conn):
    inspector = sa_inspect(sync_conn)
    product_cols = {c["name"] for c in inspector.get_columns("products")}
    settings_cols = {c["name"] for c in inspector.get_columns("app_settings")}
    version = sync_conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    return version, "record_all_prices" in product_cols, "show_sparklines" in settings_cols


async def main():
    config = _alembic_config()
    head = ScriptDirectory.from_config(config).get_current_head()

    # Build the real v1.3–v1.5 era schema: everything up to 0013, nothing newer.
    await asyncio.to_thread(command.upgrade, config, LEGACY_STAMP_REVISION)

    async with engine.begin() as conn:
        if MODE == "pre_alembic":
            # Old installs never ran alembic — no version table at all.
            await conn.execute(text("DROP TABLE alembic_version"))
        elif MODE == "botched_head":
            # What v1.6.0 left behind: version row claims head, schema is 0013.
            await conn.execute(
                text("UPDATE alembic_version SET version_num = :v"), {"v": head}
            )
        else:
            raise SystemExit(f"unknown scenario {MODE}")

    await run_migrations()

    async with engine.connect() as conn:
        version, has_record_all, has_sparklines = await conn.run_sync(check)

    assert version == head, f"version {version} != head {head}"
    assert has_record_all, "products.record_all_prices missing after upgrade"
    assert has_sparklines, "app_settings.show_sparklines missing after upgrade"
    await engine.dispose()
    print(f"OK {MODE} -> {version}")


asyncio.run(main())
"""


@pytest.mark.parametrize("scenario", ["pre_alembic", "botched_head"])
def test_legacy_database_upgrades_to_head(scenario, tmp_path):
    env = os.environ.copy()
    env.update({
        "DB_TYPE": "sqlite",
        "SQLITE_PATH": str(tmp_path / f"legacy-{scenario}.db"),
        "SINGLE_USER_MODE": "true",
        "SCENARIO": scenario,
    })
    result = subprocess.run(
        [sys.executable, "-c", SCENARIO_SCRIPT],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    assert f"OK {scenario}" in result.stdout
