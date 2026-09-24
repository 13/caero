"""Enriched scheduler job list and the admin "Run now" action."""
import pytest
from sqlalchemy import update

import app.scheduler as scheduler_mod
from app.database import AsyncSessionLocal
from app.events import record_event
from app.models import Product, User
from app.schedule_utils import describe_schedule


async def login(client, username: str, *, admin: bool) -> dict[str, str]:
    await client.post("/api/auth/register", json={"username": username, "password": "secret1"})
    if admin:
        async with AsyncSessionLocal() as db:
            await db.execute(update(User).where(User.username == username).values(is_admin=True))
            await db.commit()
    resp = await client.post("/api/auth/login", data={"username": username, "password": "secret1"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def scheduled_product(owner: str, name: str) -> int:
    async with AsyncSessionLocal() as db:
        user = User(username=owner, hashed_password="x")
        db.add(user)
        await db.flush()
        product = Product(user_id=user.id, name=name, url="https://shop.example/j", selector=".p",
                          check_interval_minutes=60, check_time_hhmm="08:00")
        db.add(product)
        await db.commit()
        scheduler_mod.add_product_job(product)
        return product.id


def test_describe_schedule():
    assert describe_schedule(60, "08:00") == "Every 1 h from 08:00"
    assert describe_schedule(30, "10:00") == "Every 30 min from 10:00"
    assert describe_schedule(1440, "09:30") == "Daily at 09:30"
    assert describe_schedule(2880, "09:30") == "Every 2 d at 09:30"
    assert describe_schedule(90, "07:00") == "Every 90 min from 07:00"


@pytest.mark.asyncio(loop_scope="session")
async def test_jobs_are_enriched_and_failing_first(client):
    headers = await login(client, "jobs-admin", admin=True)
    ok_pid = await scheduled_product("jobs-owner-ok", "Healthy widget")
    bad_pid = await scheduled_product("jobs-owner-bad", "Broken widget")
    try:
        async with AsyncSessionLocal() as db:
            ok, bad = await db.get(Product, ok_pid), await db.get(Product, bad_pid)
        await record_event(level="info", category="scrape", event="scrape_ok", message="fine", product=ok,
                           duration_ms=1200)
        await record_event(level="warning", category="scrape", event="scrape_failed", message="No price found",
                           product=bad, duration_ms=800)

        resp = await client.get("/api/settings/jobs", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["check_all_running"] is False
        jobs = {j["id"]: j for j in body["jobs"]}

        healthy = jobs[f"product_{ok_pid}"]
        assert healthy["kind"] == "product"
        assert healthy["name"] == "Healthy widget"
        assert healthy["owner"] == "jobs-owner-ok"
        assert healthy["schedule"] == "Every 1 h from 08:00"
        assert healthy["last_status"] == "ok"
        assert healthy["last_duration_ms"] == 1200
        assert healthy["running"] is False

        broken = jobs[f"product_{bad_pid}"]
        assert broken["last_status"] == "failed"
        assert broken["last_message"] == "No price found"

        ids = [j["id"] for j in body["jobs"]]
        assert ids.index(f"product_{bad_pid}") < ids.index(f"product_{ok_pid}")
    finally:
        scheduler_mod.remove_product_job(ok_pid)
        scheduler_mod.remove_product_job(bad_pid)


@pytest.mark.asyncio(loop_scope="session")
async def test_run_now_queues_one_off_and_keeps_schedule(client):
    headers = await login(client, "jobs-admin-run", admin=True)
    pid = await scheduled_product("jobs-owner-run", "Run widget")
    job_id = f"product_{pid}"
    try:
        before = scheduler_mod.scheduler.get_job(job_id).next_run_time

        resp = await client.post(f"/api/settings/jobs/{job_id}/run", headers=headers)
        assert resp.status_code == 202
        assert resp.json() == {"queued": True}

        one_off = scheduler_mod.scheduler.get_job(job_id + scheduler_mod.RUN_NOW_SUFFIX)
        assert one_off is not None
        assert one_off.args == (pid,)
        # The regular schedule is untouched — no drift away from the check time.
        assert scheduler_mod.scheduler.get_job(job_id).next_run_time == before

        # Hidden from the listing.
        listed = [j["id"] for j in (await client.get("/api/settings/jobs", headers=headers)).json()["jobs"]]
        assert job_id + scheduler_mod.RUN_NOW_SUFFIX not in listed
    finally:
        scheduler_mod.remove_product_job(pid)
    assert scheduler_mod.scheduler.get_job(job_id + scheduler_mod.RUN_NOW_SUFFIX) is None


@pytest.mark.asyncio(loop_scope="session")
async def test_run_now_errors_and_access(client):
    admin = await login(client, "jobs-admin-404", admin=True)
    user = await login(client, "jobs-user", admin=False)
    assert (await client.post("/api/settings/jobs/nope/run", headers=admin)).status_code == 404
    assert (await client.post("/api/settings/jobs/nope/run", headers=user)).status_code == 403
    assert (await client.get("/api/settings/jobs", headers=user)).status_code == 403
