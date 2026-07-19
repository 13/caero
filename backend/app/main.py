"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings as _settings
from app.database import run_migrations
from app.routers import (
    alerts_router,
    auth_router,
    prices_router,
    products_router,
    settings_router,
)
from app.scheduler import load_all_jobs, scheduler

logging.basicConfig(
    level=getattr(logging, _settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

# Root-level static files that should bypass SPA index fallback.
ROOT_STATIC_FILES = {
    "apple-touch-icon.png",
    "caero-dark.png",
    "caero.png",
    "caero.svg",
    "favicon-96x96.png",
    "favicon.ico",
    "favicon.svg",
    "site.webmanifest",
    "web-app-manifest-192x192.png",
    "web-app-manifest-512x512.png",
}

# Backward-compatible aliases for older icon names.
LEGACY_STATIC_ALIASES = {
    "caero.png": "caero.png",
    "caero.svg": "caero.svg",
    "favicon.svg": "favicon.svg",
}

@asynccontextmanager
async def lifespan(application: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    # Bring the schema to the latest Alembic revision
    await run_migrations()

    # Check frontend build
    if not (STATIC_DIR / "index.html").exists():
        logger.warning("Frontend not built — run npm run build in /frontend")

    # Launch Patchright browser
    from app.browser import set_browser

    try:
        from app.config import settings

        try:
            import patchright.async_api
            pw_module = patchright.async_api.async_playwright
            logger.info("Using Patchright for scraping")
        except ImportError:
            logger.error("Patchright is not installed")
            raise

        pw = await pw_module().start()
        application.state.patchright = pw

        headless = settings.scraper_headless
        browser = await pw.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        )
        set_browser(browser, backend="patchright")
        logger.info("Patchright browser started in %s mode", "headless" if headless else "headed")
    except Exception as exc:
        logger.error("Could not start Patchright browser: %s", exc)
        application.state.patchright = None
        set_browser(None, backend="unavailable")

    # Load Telegram token from DB (overrides env var if set)
    try:
        from app.database import AsyncSessionLocal
        from app.models import AppSettings as AppSettingsModel
        from app.notifier import configure_telegram
        async with AsyncSessionLocal() as _db:
            _row = await _db.get(AppSettingsModel, 1)
            if _row and _row.telegram_bot_token:
                configure_telegram(_row.telegram_bot_token)
    except Exception as _exc:
        logger.warning("Could not load Telegram token from DB at startup: %s", _exc)

    # Start APScheduler and load product jobs
    scheduler.start()
    await load_all_jobs()

    # Nightly maintenance: JSON backup + price-history thinning (both no-op
    # when disabled via settings).
    from app.backup import run_backup
    from app.retention import thin_price_history

    scheduler.add_job(run_backup, "cron", hour=3, minute=30, id="maintenance_backup", replace_existing=True)
    scheduler.add_job(
        thin_price_history, "cron", hour=4, minute=0, id="maintenance_retention", replace_existing=True
    )

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    scheduler.shutdown(wait=False)

    from app.browser import get_browser

    browser = get_browser()
    if browser:
        await browser.close()
    set_browser(None, backend="unavailable")

    pw = getattr(application.state, "patchright", None)
    if pw:
        await pw.stop()

    logger.info("Caero shutdown complete")


from app.config import PROJECT_VERSION

app = FastAPI(
    title="Caero",
    description="zero price tracker",
    version=PROJECT_VERSION,
    lifespan=lifespan,
)

# ── Health (unauthenticated, for Docker/monitoring probes) ───────────────────
@app.get("/api/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ── API routers ───────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api")
app.include_router(products_router, prefix="/api")
app.include_router(prices_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(settings_router, prefix="/api")

# ── Dynamic Product Images ────────────────────────────────────────────────────
from app.images import get_images_dir

app.mount("/user_images", StaticFiles(directory=get_images_dir()), name="user_images")

# ── Static assets (JS, CSS, images from built frontend) ───────────────────────
assets_dir = STATIC_DIR / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


# ── SPA fallback ──────────────────────────────────────────────────────────────
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    static_filename = LEGACY_STATIC_ALIASES.get(full_path, full_path)

    if static_filename in ROOT_STATIC_FILES:
        candidate = STATIC_DIR / static_filename
        if candidate.is_file():
            return FileResponse(candidate)

    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse(
        {"error": "Frontend not built. Run `npm run build` inside /frontend."},
        status_code=503,
    )
