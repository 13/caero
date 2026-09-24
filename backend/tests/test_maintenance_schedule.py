"""Nightly backup/retention: toggles, run times and keep knobs from AppSettings."""
from dataclasses import replace

import pytest
from sqlalchemy import select, update

import app.scheduler as scheduler_mod
from app.config import settings as config_settings
from app.database import AsyncSessionLocal
from app.maintenance import OVERRIDABLE_KNOBS, config_from_row, load_maintenance_config
from app.models import AppSettings, EventLog
from app.scheduler import (
    MAINTENANCE_JOBS,
    MAINTENANCE_MISFIRE_GRACE_SECONDS,
    apply_maintenance_schedule,
    apply_maintenance_schedule_after_commit,
    load_maintenance_schedule,
)
from tests.test_jobs_api import login

DEFAULTS = {"backup_enabled": True, "backup_time": "03:30", "retention_enabled": True, "retention_time": "04:00"}
RESET = {**DEFAULTS, **dict.fromkeys(OVERRIDABLE_KNOBS)}


def _remove_maintenance_jobs() -> None:
    for job_id in MAINTENANCE_JOBS:
        if scheduler_mod.scheduler.get_job(job_id) is not None:
            scheduler_mod.scheduler.remove_job(job_id)


def _job(job_id: str):
    return scheduler_mod.scheduler.get_job(job_id)


def _hhmm(job) -> str:
    fields = {f.name: str(f) for f in job.trigger.fields}
    return f"{int(fields['hour']):02d}:{int(fields['minute']):02d}"


def _paused(job) -> bool:
    return job.next_run_time is None


@pytest.fixture
def no_maintenance_jobs():
    _remove_maintenance_jobs()
    yield
    _remove_maintenance_jobs()


def test_config_defaults_and_env_fallback(monkeypatch):
    monkeypatch.setattr(config_settings, "backup_keep", 4)
    config = config_from_row(None)
    assert (config.backup_time, config.retention_time) == ("03:30", "04:00")
    assert config.backup_enabled and config.retention_enabled
    assert config.backup_keep == 4

    row = AppSettings(id=1, backup_keep=0, backup_time="bogus")
    config = config_from_row(row)
    assert config.backup_keep == 0  # DB override wins over env
    assert config.backup_time == "03:30"  # invalid stored time → default, not a crash
    assert config.noop_reason("backup") == "Backups to keep is 0"


def test_apply_pauses_retimes_resumes_and_tolerates_lateness(no_maintenance_jobs):
    base = config_from_row(None)
    apply_maintenance_schedule(replace(base, backup_enabled=False))
    # add_job before scheduler.start() stores pending jobs; next_run_time is set
    # only for the explicitly paused one.
    assert _job("maintenance_backup").next_run_time is None
    for job_id in MAINTENANCE_JOBS:
        assert _job(job_id).misfire_grace_time == MAINTENANCE_MISFIRE_GRACE_SECONDS
        assert _job(job_id).coalesce is True

    apply_maintenance_schedule(replace(base, backup_enabled=False, retention_time="01:05"))
    assert _paused(_job("maintenance_backup"))
    assert _hhmm(_job("maintenance_retention")) == "01:05"
    assert _job("maintenance_retention").next_run_time is not None

    apply_maintenance_schedule(replace(base, backup_time="22:45"))
    backup = _job("maintenance_backup")
    assert not _paused(backup)
    assert (backup.next_run_time.hour, backup.next_run_time.minute) == (22, 45)
    assert [j.id for j in scheduler_mod.scheduler.get_jobs()].count("maintenance_backup") == 1


@pytest.mark.asyncio(loop_scope="session")
async def test_after_commit_apply_skips_rolled_back_changes(client, no_maintenance_jobs):
    apply_maintenance_schedule(config_from_row(None))
    changed = replace(config_from_row(None), backup_time="05:55")

    async with AsyncSessionLocal() as db:
        apply_maintenance_schedule_after_commit(db, changed)
        await db.rollback()
    assert _hhmm(_job("maintenance_backup")) == "03:30"

    async with AsyncSessionLocal() as db:
        apply_maintenance_schedule_after_commit(db, changed)
        await db.commit()
    assert _hhmm(_job("maintenance_backup")) == "05:55"


@pytest.mark.asyncio(loop_scope="session")
async def test_startup_loads_schedule_from_db(client, no_maintenance_jobs):
    headers = await login(client, "maint-startup-admin", admin=True)
    try:
        resp = await client.patch("/api/settings", headers=headers,
                                  json={"retention_enabled": False, "backup_time": "02:20"})
        assert resp.status_code == 200, resp.text
        _remove_maintenance_jobs()  # as after a restart

        await load_maintenance_schedule()
        assert _hhmm(_job("maintenance_backup")) == "02:20"
        assert _paused(_job("maintenance_retention"))
    finally:
        await client.patch("/api/settings", headers=headers, json=RESET)


@pytest.mark.asyncio(loop_scope="session")
async def test_patch_updates_schedule_jobs_list_and_logs(client, no_maintenance_jobs):
    headers = await login(client, "maint-admin", admin=True)
    apply_maintenance_schedule(config_from_row(None))
    try:
        before = (await client.get("/api/settings", headers=headers)).json()
        assert {k: before[k] for k in DEFAULTS} == DEFAULTS

        resp = await client.patch("/api/settings", headers=headers,
                                  json={"backup_enabled": False, "retention_time": "02:15"})
        assert resp.status_code == 200, resp.text
        saved = resp.json()
        assert saved["backup_enabled"] is False
        assert saved["backup_time"] == "03:30"  # absent = keep
        assert saved["retention_time"] == "02:15"
        # Untouched core fields stay as they were.
        assert saved["allow_registration"] == before["allow_registration"]

        jobs = {j["id"]: j for j in (await client.get("/api/settings/jobs", headers=headers)).json()["jobs"]}
        backup, retention = jobs["maintenance_backup"], jobs["maintenance_retention"]
        assert backup["paused"] is True and backup["next_run_time"] is None
        assert backup["schedule"] == "Daily at 03:30" and backup["time_hhmm"] == "03:30"
        assert retention["paused"] is False and retention["schedule"] == "Daily at 02:15"
        assert retention["interval_minutes"] == 1440

        async with AsyncSessionLocal() as db:
            logged = (await db.execute(
                select(EventLog).where(EventLog.event == "maintenance_settings").order_by(EventLog.id.desc())
            )).scalars().first()
        assert logged.category == "maintenance"
        assert "maint-admin" in logged.message
        assert "Backup disabled" in logged.message and "Retention time 04:00 → 02:15" in logged.message

        # A paused job can still be run by hand.
        resp = await client.post("/api/settings/jobs/maintenance_backup/run", headers=headers)
        assert resp.status_code == 202
        scheduler_mod.scheduler.remove_job("maintenance_backup" + scheduler_mod.RUN_NOW_SUFFIX)

        for bad in ({"backup_time": "24:00"}, {"backup_time": "3:30"}, {"retention_time": "x"},
                    {"backup_keep": -1}):
            assert (await client.patch("/api/settings", headers=headers, json=bad)).status_code == 422, bad

        user = await login(client, "maint-user", admin=False)
        assert (await client.patch("/api/settings", headers=user, json={"backup_enabled": False})).status_code == 403
    finally:
        await client.patch("/api/settings", headers=headers, json=RESET)


@pytest.mark.asyncio(loop_scope="session")
async def test_keep_knobs_override_env_and_reset(client, monkeypatch):
    headers = await login(client, "maint-knob-admin", admin=True)
    monkeypatch.setattr(config_settings, "backup_keep", 7)
    apply_maintenance_schedule(config_from_row(None))
    try:
        body = (await client.get("/api/settings", headers=headers)).json()
        assert body["backup_keep"] is None and body["backup_keep_env"] == 7

        resp = await client.patch("/api/settings", headers=headers, json={"backup_keep": 0})
        assert resp.json()["backup_keep"] == 0
        assert (await load_maintenance_config()).backup_keep == 0
        jobs = {j["id"]: j for j in (await client.get("/api/settings/jobs", headers=headers)).json()["jobs"]}
        assert jobs["maintenance_backup"]["noop_reason"] == "Backups to keep is 0"

        import app.backup as backup
        assert await backup.run_backup() is None  # keep = 0 from the DB, despite env 7

        # Explicit null resets to the env value; other null fields are ignored.
        resp = await client.patch("/api/settings", headers=headers,
                                  json={"backup_keep": None, "allow_registration": None})
        assert resp.status_code == 200
        assert resp.json()["backup_keep"] is None
        assert resp.json()["allow_registration"] == body["allow_registration"]
        assert (await load_maintenance_config()).backup_keep == 7
    finally:
        await client.patch("/api/settings", headers=headers, json=RESET)
        _remove_maintenance_jobs()


def test_import_drops_invalid_maintenance_values():
    from app.routers.settings import _importable_settings

    data = _importable_settings({
        "backup_time": "25:00", "retention_time": "01:00", "backup_enabled": "yes",
        "retention_enabled": False, "backup_keep": -3, "event_log_retention_days": 10,
        "db_host": "legacy",
    })
    assert data == {"retention_time": "01:00", "retention_enabled": False, "event_log_retention_days": 10}


@pytest.mark.asyncio(loop_scope="session")
async def test_bad_stored_time_does_not_break_startup(client, no_maintenance_jobs):
    async with AsyncSessionLocal() as db:
        await db.execute(update(AppSettings).where(AppSettings.id == 1).values(backup_time="99:99"))
        await db.commit()
    try:
        await load_maintenance_schedule()
        assert _hhmm(_job("maintenance_backup")) == "03:30"
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(update(AppSettings).where(AppSettings.id == 1).values(backup_time="03:30"))
            await db.commit()
