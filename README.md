# <img src="assets/caero.svg" width="30" height="30" /> caero

<br>
<center><strong>Caero (zero), a self-hosted price tracker to help you catch the best deals.</strong></center>
<br>
<br>

<p align="center">
  <img src="assets/screenshot.gif" width="640" alt="caero dashboard" />
</p>

## Features

- **Track Anything** – Works on any website using URL + CSS selectors, with built-in fallbacks (ld+json, itemprop, data-price) and per-site default selectors.
- **Smart Insights** – Historical price charts, all-time lows/highs, time-weighted averages, and per-product currency detection.
- **Flexible Recording** – By default a price is stored only when it changes; flip **"Record every check"** per product to store every data point. Old history can be auto-thinned to daily min/max.
- **Instant Alerts** – Get notified via **Telegram**, **Email**, **ntfy**, **Gotify**, or **Discord** when a price drops below a threshold, drops by a percentage, or changes at all. Plus notifications for broken selectors (and their recovery), URL redirects, and currency changes.
- **Multi-User** – Admin-managed accounts, per-user products and notification defaults, optional open registration.
- **Self-Maintaining** – Daily JSON backups with rotation, health endpoint for container monitoring, Alembic migrations run automatically on startup.

---

## Quick Start (Docker)

The fastest way to get started is with Docker.

1.  **Set up your settings:**
    ```bash
    cp .env.example .env
    ```
    At minimum set a random `SECRET_KEY` and your `TZ`. If `SECRET_KEY` stays at the default, Caero generates a random one per start — secure, but logins won't survive restarts.
2.  **Launch the app:**
    ```bash
    docker compose up -d
    ```
3.  **Start tracking:**
    Open [http://localhost:8000](http://localhost:8000) in your browser. The first account you register becomes the admin.

_Pull the latest image directly:_ `docker pull ghcr.io/13/caero:latest`

---

## How to Track a Product

Don't let "CSS Selectors" scare you—it's just a way to point **caero** to the price.

1.  **Find the Price:** Go to your product page (e.g., Amazon, BestBuy).
2.  **Copy the Path:** Right-click the price on the page → **Inspect**. In the window that opens, right-click the highlighted code → **Copy** → **Copy selector**.
3.  **Paste & Save:** Paste that into **caero** along with the URL. For well-known shops a default selector is filled in automatically.

## Configuration

Everything is configured through `.env` — see [`.env.example`](.env.example) for the full annotated list. Highlights:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | JWT signing key — set a long random string |
| `TZ` | Timezone for the daily check times (`10:00` means *your* 10:00) |
| `TELEGRAM_BOT_TOKEN` / `SMTP_*` | Per-alert notification channels (Telegram token can also be set in the admin UI) |
| `NTFY_URL` / `GOTIFY_*` / `DISCORD_WEBHOOK_URL` | Broadcast webhooks — every notification from **all** users goes to each configured channel (household-style setups) |
| `BACKUP_KEEP` | Daily JSON backups to keep in `/data/backups` (0 = off) |
| `PRICE_HISTORY_THIN_AFTER_DAYS` | Auto-thin old price rows to daily min/max (0 = keep everything) |
| `SINGLE_USER_MODE` | Skip login entirely for single-person setups |

## Backups & Health

- A JSON backup of all data is written daily to `/data/backups` and can be restored via **Settings → Admin → Import all data**.
- `GET /api/health` answers without authentication; the Docker image ships a matching `HEALTHCHECK`.

## Development

Backend (FastAPI + SQLAlchemy, Python 3.13+, [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
uv sync
uv run fastapi dev app/main.py   # http://localhost:8000
uv run pytest                    # tests
uv run ruff check app tests      # lint
```

Frontend (React + Vite + Tailwind):

```bash
cd frontend
npm install
npm run dev    # dev server, proxies /api to :8000
npm test       # unit tests (vitest)
npm run lint   # eslint
```

CI runs lint, unit tests, a production build, and a Playwright end-to-end suite on every push.

## Status

- caero: docker image pushed to gitea.muh/ben/caero via workflow_dispatch on main (run #2, id 259); release-by-tag not yet exercised
