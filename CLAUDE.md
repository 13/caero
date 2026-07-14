# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Caero — self-hosted price tracker. Users add a product URL + CSS selector; a scheduler scrapes prices periodically and sends Telegram/email alerts on price changes. Single Docker container serves both API and built frontend on port 8000.

## Commands

### Backend (`backend/`, Python 3.13+, managed with uv)

```bash
cd backend
uv sync                                  # install deps (incl. dev group: pytest, ruff)
uv run fastapi dev app/main.py           # dev server on :8000
uv run pytest                            # run tests (tests/)
uv run pytest tests/test_parsing.py -k euro   # single test
uv run ruff check app tests              # lint
uv run alembic upgrade head              # apply migrations
uv run alembic revision -m "msg"         # new migration (hand-written, see alembic/versions/ for numbering: 00NN_description.py)
```

### Frontend (`frontend/`, React 19 + Vite + Tailwind 4 + TypeScript)

```bash
cd frontend
npm install
npm run dev      # Vite dev server, proxies /api → http://localhost:8000
npm run build    # tsc -b && vite build → outputs to ../backend/app/static/
npm run lint     # eslint (flat config, eslint.config.js)
npm test         # vitest (src/**/*.test.ts)
```

CI (`.github/workflows/ci.yml`) runs ruff + pytest (on SQLite *and* a PostgreSQL service container — conftest reads `DB_TYPE` from the environment), eslint + vitest + build, and a Playwright e2e job (spec in `frontend/e2e/`, config assumes the backend serves the built frontend on :8000). `release.yml` pushes the Docker image to GHCR on `v*` tags. Playwright specs must survive a non-fresh DB (CI retries reuse it). `tests/test_migrations.py` fails when a model change lacks a migration; `tests/test_scrape_flow.py` covers the scrape loop with a faked `scrape_price`.

For full-stack dev, run both: backend on :8000, frontend dev server proxies API calls to it. In production the backend serves the built frontend from `app/static/` with an SPA fallback route.

### Docker

```bash
cp .env.example .env
docker compose up -d --build   # multi-stage build: frontend → static, then Python image
```

## Architecture

**Backend** (`backend/app/`) — FastAPI + async SQLAlchemy (SQLite via aiosqlite by default, PostgreSQL via asyncpg; selected by `DB_TYPE` env var).

- `main.py` — app entry; lifespan hook runs Alembic migrations, starts the Patchright (stealth Playwright) Chromium browser, loads the Telegram token from DB, and starts APScheduler. Also mounts static assets and the SPA fallback.
- `browser.py` — holds the shared browser handle (set by the lifespan). Import from here, never from `app.main` (circular import).
- `scheduler.py` — one APScheduler job per active product. Scrape job records price history (only when the price changed, unless the product's `record_all_prices` toggle is on), detects URL redirects, and triggers alerts (`evaluate_alert` is the pure condition logic; "below" fires only when *crossing* the threshold). The scrape itself runs between two short DB sessions — never hold a session across a scrape. Single-process only — never add uvicorn workers or jobs run multiple times.
- `scraper.py` — Patchright-based scraping; concurrency capped by a semaphore (`SCRAPER_CONCURRENCY`). Pure text parsing (price normalization for European/English formats with a per-product `price_format` override, currency detection) lives in `parsing.py` so it is importable without Patchright. Scheduled runs get 0–`SCHEDULE_JITTER_SECONDS` of random offset so shared check times don't burst. Notifications retry twice with backoff. Login rate limiting relies on `--proxy-headers` + `FORWARDED_ALLOW_IPS` behind a reverse proxy.
- `stats.py` — `time_weighted_average`; prices are stored on change only, so averages must weight by time-in-effect, not by row.
- `routers/` — API under `/api`: `auth`, `products`, `prices`, `alerts`, `settings`. Full app settings are admin-only and never return secrets (`telegram_bot_token_set` boolean instead; input `None` = keep, `""` = clear). `/api/settings/ui` exposes date/time format to all users.
- `models.py` — `User`, `Product`, `PriceHistory`, `Alert`, `SelectorDefault`, `AppSettings`. DB connection config comes from `.env` only, not `AppSettings`.
- `notifier.py` — Telegram + SMTP per-recipient, plus global webhook broadcast channels (ntfy/Gotify/Discord via `NTFY_URL`, `GOTIFY_URL`+`GOTIFY_TOKEN`, `DISCORD_WEBHOOK_URL` — every notification goes to each configured one). `notify()` is the single dispatch helper; `send_alert()` builds price-alert messages on top of it. Telegram bot token can come from env or from `AppSettings` in the DB (DB wins).
- `config.py` — pydantic-settings loaded from `.env`; `PROJECT_VERSION` is read from `pyproject.toml`. A default `SECRET_KEY` outside single-user mode is replaced with a random ephemeral key at import (logins then don't survive restarts).
- `auth.py` — JWT (python-jose) + bcrypt. Tokens carry a `ver` claim checked against `User.token_version`; logout bumps the version and revokes all sessions. `SINGLE_USER_MODE=true` bypasses login. Login has an in-memory per-IP+username failure throttle (routers/auth.py).
- `/api/health` — unauthenticated probe used by the Docker `HEALTHCHECK`.
- `backup.py` / `retention.py` — nightly cron jobs (registered in main.py lifespan): JSON backup with rotation (`BACKUP_KEEP`) and price-history thinning to daily min/max (`PRICE_HISTORY_THIN_AFTER_DAYS`, 0 = off). `build_export_payload` there is the single source for both the export API and backups — extend it when models change.
- Product check times (`check_time_hhmm`) use the container's local timezone — set `TZ` in `.env`.

**Transactions:** `get_db` commits once on success and rolls back on error. Endpoints mutate and at most `flush()`/`refresh()`; they do not call `commit()` (background jobs with their own sessions do).

**Schema changes:** Alembic (`alembic/versions/`) is the single source of truth; startup runs `upgrade head` (legacy pre-Alembic DBs get stamped). Add a migration for every `models.py` change — there is no `create_all` fallback, so a missing migration means the column never exists on fresh installs. Default CSS selectors are seeded post-migration in `database.py` (only when the table is empty so user edits survive restarts).

**Frontend** (`frontend/src/`) — pages in `pages/` (Dashboard, ProductDetail, AddProduct, Login, Setup), section components in `components/product-detail/` and `components/setup/`, API layer in `api/` (`client.ts` fetch wrapper with Bearer token from localStorage, `hooks.ts` TanStack Query hooks, `types.ts`). Display formats come from `useUiSettings` (all users); `useSettings`/`useSaveSettings` are admin-only. Charts via Recharts, routing via react-router-dom. Note: `npm run lint` is currently broken (no `eslint.config.js` flat config); `tsc -b` via `npm run build` is the working check.

## Conventions

- Version lives in `backend/pyproject.toml` (backend) and `frontend/package.json` (frontend); bump on release.
- Commit messages are short, lowercase, descriptive (see `git log`).
