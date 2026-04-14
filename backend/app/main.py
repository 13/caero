"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.database import create_tables
from app.routers import (
    alerts_router,
    auth_router,
    prices_router,
    products_router,
    settings_router,
)
from app.scheduler import load_all_jobs, scheduler

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
@asynccontextmanager
async def lifespan(application: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    # Ensure tables exist
    await create_tables()

    # Check frontend build
    if not (STATIC_DIR / "index.html").exists():
        logger.warning("Frontend not built — run npm run build in /frontend")

    # Launch Playwright/Patchright browser
    try:
        from app.config import settings

        pw_module = None
        if settings.scraper_backend.lower() in ("auto", "patchright"):
            try:
                import patchright.async_api
                pw_module = patchright.async_api.async_playwright
                logger.info("Using Patchright for scraping")
            except ImportError:
                if settings.scraper_backend.lower() == "patchright":
                    logger.error("Patchright is configured but not installed")
                    raise
                logger.info("Patchright not found, falling back to Playwright")

        if pw_module is None:
            from playwright.async_api import async_playwright
            pw_module = async_playwright
            logger.info("Using Playwright for scraping")
            application.state.scraper_backend = "playwright"
        else:
            application.state.scraper_backend = "patchright"

        pw = await pw_module().start()
        application.state.playwright = pw

        headless = settings.scraper_headless
        application.state.browser = await pw.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"] if not headless else None
        )
        logger.info("Playwright browser started in %s mode", "headless" if headless else "headed")
    except Exception as exc:
        logger.error("Could not start Playwright browser: %s", exc)
        application.state.playwright = None
        application.state.browser = None

    # Start APScheduler and load product jobs
    scheduler.start()
    await load_all_jobs()

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    scheduler.shutdown(wait=False)

    browser = getattr(application.state, "browser", None)
    if browser:
        await browser.close()

    pw = getattr(application.state, "playwright", None)
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

# ── API routers ───────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api")
app.include_router(products_router, prefix="/api")
app.include_router(prices_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(settings_router, prefix="/api")

# ── Static assets (JS, CSS, images from built frontend) ───────────────────────
assets_dir = STATIC_DIR / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


# ── SPA fallback ──────────────────────────────────────────────────────────────
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    static_filename: str | None
    match full_path:
        case "apple-touch-icon.png":
            static_filename = "apple-touch-icon.png"
        case "caero.png":
            static_filename = "caero.png"
        case "caero.svg":
            static_filename = "caero.svg"
        case "favicon-96x96.png":
            static_filename = "favicon-96x96.png"
        case "favicon.ico":
            static_filename = "favicon.ico"
        case "favicon.svg":
            static_filename = "favicon.svg"
        case "site.webmanifest":
            static_filename = "site.webmanifest"
        case "web-app-manifest-192x192.png":
            static_filename = "web-app-manifest-192x192.png"
        case "web-app-manifest-512x512.png":
            static_filename = "web-app-manifest-512x512.png"
        case _:
            static_filename = None

    if static_filename:
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
