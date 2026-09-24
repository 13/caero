# Settings tabs: About, Schedulers, Logs — design

Date: 2026-09-24

## Goal

Reorganise Settings into purpose-specific tabs and give admins an operational
view of the instance:

1. **About** moves out of the Account tab into its own tab (all users).
2. **Schedulers** — a new admin tab that hosts the scheduler job list, enriched
   with product info, last result and a "Run now" action.
3. **Logs** — a new admin tab showing a persistent, filterable event log:
   scrape successes/failures, price changes, alerts, notification failures,
   browser relaunches, missed jobs, maintenance runs.

Success: an admin can answer "is scraping healthy, what failed, why, and when
does product X run next" from the UI without reading container logs.

## Decisions

| Question | Decision |
|---|---|
| Who sees Logs | Admin only; all users' products plus system events |
| Storage | New DB table `event_log`, pruned by age (`EVENT_LOG_RETENTION_DAYS`, default 30) |
| Schedulers tab | Move + enrich + per-job "Run now" |
| Capture mechanism | Explicit structured `log_event()` calls — not a `logging.Handler` bridge |
| Existing `logger.*` calls | Kept unchanged; the event log is a separate structured record |
| Backup/export | Event log is **excluded** (operational data, not user data) |

## 1. Tabs (`frontend/src/pages/Setup.tsx`)

- Tab order: **Account · Schedulers · Logs · Admin · About**.
- Schedulers, Logs, Admin: rendered only for `me.is_admin`. Account and About:
  everyone. The tab bar is now always shown (non-admins see Account + About).
- Active tab is stored in the URL query (`?tab=schedulers|logs|admin|about`,
  default `account`) via `useSearchParams`, so refresh and links keep it. An
  unknown or non-permitted tab value falls back to `account`.
- The tab bar must not overflow at phone width: horizontally scrollable
  (`overflow-x-auto`) with labels kept; no page-level horizontal scroll.
- New components:
  - `components/setup/SchedulersTab.tsx` (replaces `SchedulerJobsSection`,
    which is removed from `AdminSections.tsx`).
  - `components/setup/LogsTab.tsx`.
  - `AboutSection` is reused as-is (drop its `mt-8` spacing, which only made
    sense at the bottom of Account).

## 2. Data model

New model `EventLog` in `models.py`, migration
`alembic/versions/0023_add_event_log.py`:

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | autoincrement; also the pagination cursor |
| `created_at` | timestamptz, not null, server default now | indexed |
| `level` | varchar(10), not null | `info` \| `warning` \| `error` |
| `category` | varchar(20), not null | `scrape` \| `alert` \| `notification` \| `system` \| `maintenance` |
| `event` | varchar(40), not null | event code, see §3 |
| `product_id` | int FK → `products.id`, nullable, `ON DELETE SET NULL` | |
| `product_name` | varchar, nullable | snapshot so rows stay readable after product deletion |
| `message` | text, not null | human-readable one-liner |
| `duration_ms` | int, nullable | scrape duration |
| `details` | JSON, nullable | structured extras (prices, error code, source, channel…) |

Indexes: `ix_event_log_created_at (created_at)`,
`ix_event_log_product_created (product_id, created_at)`.

Levels/categories/event codes are validated in Python (string constants in
`app/events.py`), not DB enums — adding a code must not need a migration.

## 3. Event writer (`backend/app/events.py`)

```python
def log_event(db, *, level, category, event, message,
              product=None, product_id=None, product_name=None,
              duration_ms=None, details=None) -> None
```
Adds an `EventLog` row to the caller's session; no flush/commit. Used inside
the scrape path so the event commits atomically with the product/price writes.

```python
async def record_event(**same_kwargs) -> None
```
For callers without a session (notifier, browser, APScheduler listener,
maintenance jobs). Opens a short `AsyncSessionLocal` session, commits, and
**never raises** — any exception is caught and `logger.exception`-ed. Event
logging must never break a scrape or a notification.

`message` is truncated to 1000 chars; any text derived from exceptions or
notification errors passes through `notifier._redact` first.

### Event catalogue

| Code | Level | Category | Where | Details |
|---|---|---|---|---|
| `scrape_ok` | info | scrape | `_scrape_and_record_locked`, price recorded & changed | `price`, `prev_price`, `currency`, `source` |
| `scrape_unchanged` | info | scrape | same, price unchanged | `price`, `currency`, `source` |
| `scrape_failed` | warning | scrape | same, `result.price is None` | `error`, `consecutive_failures`, `url` |
| `scrape_skipped` | warning | scrape | `scrape_and_record` when browser unavailable | — |
| `url_redirected` | warning | scrape | `check_url_redirect` when newly redirected | `from`, `to` |
| `currency_changed` | warning | scrape | currency flip branch | `was`, `now` |
| `selector_broken` | error | alert | failure threshold reached (per-product notice) | `failures` |
| `scraping_down` | error | system | storm notice sent | — |
| `scrape_recovered` | info | alert | recovered notice sent | `failures_before` |
| `alert_triggered` | info | alert | each triggered alert | `condition`, `price`, `threshold` |
| `notify_failed` | error | notification | notifier channel delivery fails after retries | `channel` (redacted error) |
| `browser_relaunched` | warning | system | `browser.ensure_browser` relaunch path | `reason` |
| `browser_launch_failed` | error | system | launch failure | `error` |
| `job_missed` | warning | system | APScheduler `EVENT_JOB_MISSED` listener | `job_id`, `scheduled_run_time` |
| `job_error` | error | system | APScheduler `EVENT_JOB_ERROR` listener | `job_id`, `exception` |
| `check_all` | info | system | end of `run_check_all` | `total`, `ok`, `failed` |
| `backup` | info / error | maintenance | end of `run_backup` | `file`, `kept` / `error` |
| `retention` | info | maintenance | end of nightly retention | `price_rows_deleted`, `events_deleted` |

`scrape_ok` vs `scrape_unchanged`: `scrape_ok` means a new price row was
recorded because the price changed (first record included); a
`record_all_prices` write of an unchanged price is still `scrape_unchanged`.

The APScheduler listener is registered once in the `main.py` lifespan, after
`scheduler.start()`. It is sync (APScheduler calls listeners synchronously), so
it schedules `record_event` on the running loop with
`asyncio.get_running_loop().create_task(...)`, holding a reference in a module
set until done.

## 4. Scrape failure reasons (`scraper.py`)

`ScrapeResult` gains two fields (defaults keep existing constructors valid):

- `error: str | None` — one of `timeout`, `navigation` (exception during
  goto/context; message kept in logs, not the code), `unavailable`,
  `no_match` (page loaded, no price from selector or fallbacks).
- `source: str | None` — `selector`, `ld_json`, `itemprop`, `data_price` —
  which strategy produced the price. Surfaces products that only work thanks
  to a fallback (selector silently broken).

Pure additive change; `scheduler.py` consumes both for events. Existing
tests constructing `ScrapeResult(price, currency, final_url)` keep working.

## 5. Retention

- New setting in `config.py`: `event_log_retention_days: int = 30`
  (`EVENT_LOG_RETENTION_DAYS`; `0` = keep forever). Add to `.env.example`.
- `retention.py` gains `prune_event_log() -> int`: deletes
  `created_at < now - N days` in id-chunks of 500 (bounded parameter lists on
  both backends), returns the count.
- A new `run_nightly_retention()` in `retention.py` calls both
  `thin_price_history()` and `prune_event_log()`, then records one
  `retention` event. The `maintenance_retention` cron job in `main.py` points
  to it.

## 6. API (`routers/settings.py`, admin-only via `require_admin`)

### `GET /api/settings/logs`

Query params: `level` (repeatable), `category` (repeatable), `product_id`,
`q` (case-insensitive substring on `message` and `product_name`),
`before_id` (cursor), `limit` (default 100, 1–500).

Ordered by `id DESC`. Keyset pagination: `WHERE id < before_id`. Stable while
new rows arrive; no OFFSET scans.

Response:
```json
{ "items": [EventLogOut, ...], "next_before_id": 12345 | null }
```
`next_before_id` is the last item's id when `len(items) == limit`, else null.

### `GET /api/settings/jobs` (enriched)

`JobOut` becomes:

| Field | Notes |
|---|---|
| `id` | APScheduler job id |
| `kind` | `product` \| `maintenance` |
| `name` | product name, or "Nightly backup" / "Nightly retention" |
| `product_id`, `owner` | product jobs only (`owner` = username) |
| `interval_minutes`, `check_time` | product jobs; cron description for maintenance |
| `next_run_time` | as today |
| `last_run_at`, `last_status`, `last_duration_ms` | from newest `scrape_*` event per product (one grouped query: `max(id)` per `product_id` within scrape category, joined back) ; maintenance from newest `backup`/`retention` event |
| `consecutive_failures` | from `Product.consecutive_scrape_failures` |
| `running` | whether the per-product lock is currently held |

Sorted: failing first, then by `next_run_time`.

The response also carries `check_all_running: bool` — the endpoint returns
`{ "jobs": [...], "check_all_running": bool }`. (Breaking shape change is fine:
the only consumer is the component being replaced.)

### `POST /api/settings/jobs/{job_id}/run`

`scheduler.modify_job(job_id, next_run_time=now)` — the run still goes through
`max_instances=1`, the per-product lock and the scrape semaphore, so it cannot
double-run. `404` for unknown job ids. Returns `202 {"queued": true}`.
The interval schedule is preserved: after the run, APScheduler computes the
next fire time from the interval as usual.

## 7. Frontend

### API layer
- `types.ts`: `EventLogEntry`, `EventLogPage`, `JobInfo`, `JobsResponse`.
- `hooks.ts`:
  - `useJobs()` — `refetchInterval: 30_000`.
  - `useRunJob()` — mutation; invalidates `jobs` and `logs` on success.
  - `useEventLog(filters)` — `useInfiniteQuery` keyed on filters,
    `getNextPageParam: p => p.next_before_id ?? undefined`,
    `refetchInterval: 15_000` when auto-refresh is on.

### Schedulers tab
- Summary row: total jobs, failing count, check-all running indicator.
- Table (cards below `sm`): status dot (green = last scrape ok/unchanged,
  red = failed, grey = never run), product name linking to
  `/products/:id`, owner, schedule ("every 60 min from 08:00"), next run
  (relative, absolute in `title`), last run (relative + duration), consecutive
  failures badge when > 0, **Run now** button (disabled + spinner while the
  job's `running` is true or the mutation is pending).
- Maintenance jobs listed in a separate small group below.

### Logs tab
- Filter bar: level chips (info/warning/error, multi-select), category
  select, product select (from existing products query), search input
  (debounced 300 ms). Filters live in the URL query alongside `tab`.
- List rows: timestamp (UI date/time format from `useUiSettings`), level
  badge, category, product link (or struck-out snapshot name if the product
  was deleted), message. Rows with `details`/`duration_ms` expand to show a
  key/value list.
- "Load more" button for the next page; auto-refresh toggle (default on,
  pauses while any row is expanded or the user has loaded past page 1).
- Empty state: "No events match these filters."
- Accessible: level conveyed by text, not colour alone; expandable rows are
  `<button aria-expanded>`.

## 8. Error handling

- `record_event` swallows and logs its own failures.
- `log_event` inside the scrape session: if the commit fails, the event is
  lost together with the scrape writes it describes — consistent, acceptable.
- Logs endpoint validates `limit` range and enum-like params (unknown values
  → 422).
- Run-now on a job that disappeared between listing and click → 404 →
  toast "Job no longer exists", jobs list refetched.

## 9. Testing

Backend (pytest, SQLite and Postgres in CI):
- `tests/test_events.py`: `log_event` adds to session; `record_event`
  persists; `record_event` swallows a DB failure; message truncation and
  redaction.
- `tests/test_scrape_flow.py`: each outcome (changed, unchanged,
  record_all_prices, failure with each `error` code, redirect, alert trigger,
  selector-broken threshold) emits the expected event code/level/details.
- `tests/test_scraper_result.py` (or extend existing): `error`/`source`
  populated — timeout path via faked timeout, `no_match`, fallback `source`.
- `tests/test_event_log_api.py`: admin-only (403 for regular user), filters
  (level/category/product/q), keyset pagination correctness across pages,
  `limit` bounds.
- `tests/test_jobs_api.py`: enriched fields, failing-first ordering,
  run-now modifies `next_run_time`, 404 for unknown id, admin-only.
- `tests/test_retention.py`: `prune_event_log` respects the cutoff and `0`.
- `tests/test_migrations.py` covers the model/migration pairing.

Frontend:
- vitest for pure helpers (schedule description, relative-time/duration
  formatting, URL ⇄ filter state parsing).
- Playwright (`frontend/e2e/`): admin opens Schedulers, clicks Run now on a
  product, then sees a new scrape event in Logs; `?tab=about` renders About;
  non-admin sees only Account + About. Must tolerate a non-fresh DB (assert
  "at least one new row", not exact counts).

## 10. Docs

- `CLAUDE.md`: add `events.py` to the architecture list; note the event log
  is excluded from backups; mention `EVENT_LOG_RETENTION_DAYS`.
- `.env.example`: `EVENT_LOG_RETENTION_DAYS=30`.

## Out of scope

- Per-user log visibility for non-admins.
- Log export/download, manual "clear logs" action.
- Live streaming (SSE/WebSocket); polling is sufficient.
- Editing schedules from the Schedulers tab (done on the product page).
