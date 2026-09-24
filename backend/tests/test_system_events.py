"""Events from outside the scrape path: browser, notifier, APScheduler, maintenance."""
import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED, JobExecutionEvent
from sqlalchemy import select

import app.browser as browser_mod
import app.events as events
import app.notifier as notifier
import app.retention as retention
import app.scheduler as scheduler_mod
from app.database import AsyncSessionLocal, run_migrations
from app.events import drain_pending_events
from app.models import EventLog


async def latest(event: str) -> EventLog | None:
    async with AsyncSessionLocal() as db:
        return (await db.execute(
            select(EventLog).where(EventLog.event == event).order_by(EventLog.id.desc()).limit(1)
        )).scalar_one_or_none()


@pytest.fixture(autouse=True)
async def migrated():
    await run_migrations()


@pytest.mark.asyncio(loop_scope="session")
async def test_browser_launch_failure_and_relaunch(monkeypatch):
    before = await latest("browser_launch_failed")

    async def failing_launch():
        raise RuntimeError("chromium missing")

    browser_mod.set_browser(None, backend="unavailable")
    monkeypatch.setattr(browser_mod, "_launch", failing_launch)
    assert await browser_mod.ensure_browser() is None
    row = await latest("browser_launch_failed")
    assert row is not None and row.id != (before.id if before else None)
    assert "chromium missing" in row.message

    async def ok_launch():
        browser_mod.set_browser(object(), backend="fake")  # type: ignore[arg-type]

    monkeypatch.setattr(browser_mod, "_launch", ok_launch)
    try:
        assert await browser_mod.ensure_browser() is not None
        row = await latest("browser_relaunched")
        assert row.details == {"reason": "not_running"}
    finally:
        browser_mod.set_browser(None, backend="unavailable")


@pytest.mark.asyncio(loop_scope="session")
async def test_delivery_failure_event():
    notifier.reset_channel_status()
    try:
        notifier._record_delivery("ntfy", RuntimeError("connection refused"))
        await drain_pending_events()
        row = await latest("notify_failed")
        assert row.category == "notification" and row.level == "error"
        assert row.details["channel"] == "ntfy"
        assert "connection refused" in row.message
    finally:
        notifier.reset_channel_status()


@pytest.mark.asyncio(loop_scope="session")
async def test_delivery_failure_event_from_worker_thread():
    """Email delivery bookkeeping runs inside asyncio.to_thread(...), where there
    is no running loop of its own — spawn_event must still reach the log via the
    loop bound at startup rather than silently dropping the event."""
    notifier.reset_channel_status()
    try:
        events.bind_event_loop(asyncio.get_running_loop())
        await asyncio.to_thread(notifier._record_delivery, "Email", RuntimeError("smtp refused"))
        await drain_pending_events()
        row = await latest("notify_failed")
        assert row.details["channel"] == "Email"
        assert "smtp refused" in row.message
    finally:
        notifier.reset_channel_status()


def test_product_id_from_job():
    assert scheduler_mod.product_id_from_job("product_42") == 42
    assert scheduler_mod.product_id_from_job("product_42__run_now") == 42
    assert scheduler_mod.product_id_from_job("maintenance_backup") is None
    assert scheduler_mod.product_id_from_job("product_x") is None


@pytest.mark.asyncio(loop_scope="session")
async def test_job_listener_records_missed_and_error():
    when = datetime.now(UTC)
    scheduler_mod._on_job_event(JobExecutionEvent(EVENT_JOB_MISSED, "maintenance_backup", "default", when))
    scheduler_mod._on_job_event(
        JobExecutionEvent(EVENT_JOB_ERROR, "maintenance_retention", "default", when, exception=ValueError("bad"))
    )
    await drain_pending_events()

    missed = await latest("job_missed")
    assert missed.details["job_id"] == "maintenance_backup"
    error = await latest("job_error")
    assert error.level == "error"
    assert "ValueError" in error.message


@pytest.mark.asyncio(loop_scope="session")
async def test_prune_event_log_respects_cutoff(monkeypatch):
    marker = "prune-marker-7f3a"
    async with AsyncSessionLocal() as db:
        db.add(EventLog(created_at=datetime.now(UTC) - timedelta(days=40), level="info",
                        category="system", event="old", message=marker))
        db.add(EventLog(created_at=datetime.now(UTC) - timedelta(days=1), level="info",
                        category="system", event="new", message=marker))
        await db.commit()

    monkeypatch.setattr(retention.settings, "event_log_retention_days", 0)
    assert await retention.prune_event_log() == 0

    monkeypatch.setattr(retention.settings, "event_log_retention_days", 30)
    assert await retention.prune_event_log() >= 1
    async with AsyncSessionLocal() as db:
        left = (await db.execute(select(EventLog.event).where(EventLog.message == marker))).scalars().all()
    assert left == ["new"]


@pytest.mark.asyncio(loop_scope="session")
async def test_nightly_retention_records_event(monkeypatch):
    monkeypatch.setattr(retention.settings, "price_history_thin_after_days", 0)
    await retention.run_nightly_retention()
    row = await latest("retention")
    assert row.category == "maintenance"
    assert set(row.details) == {"price_rows_deleted", "events_deleted"}


@pytest.mark.asyncio(loop_scope="session")
async def test_backup_records_success_and_failure(monkeypatch, tmp_path):
    import app.backup as backup

    monkeypatch.setattr(backup.settings, "backup_keep", 2)
    monkeypatch.setattr(backup, "get_backups_dir", lambda: tmp_path)
    assert await backup.run_backup() is not None
    row = await latest("backup")
    assert row.level == "info" and row.details["file"].startswith("caero-backup-")

    async def boom(_db):
        raise RuntimeError("disk full")

    monkeypatch.setattr(backup, "build_export_payload", boom)
    assert await backup.run_backup() is None
    row = await latest("backup")
    assert row.level == "error" and "disk full" in row.message
