"""APScheduler integration — one job per active product."""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from urllib.parse import urlparse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.sql import func

from app.browser import ensure_browser
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Alert, PriceHistory, Product, User
from app.notifier import notify, send_alert

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Log a scrape at INFO once it takes this long — a queue backing up shows here
# first.
_SLOW_SCRAPE_SECONDS = 30.0

# Scheduled jobs, "Check now", and "Check all" can target the same product at
# the same time; without a lock both would read the same previous price and
# insert duplicate rows / double-fire alerts.
_product_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)

# job_id -> check time (HH:mm) of every scheduled product, so the jitter window
# can be sized against how many products share that time.
_job_check_times: dict[str, str] = {}

# ── Scraper health ───────────────────────────────────────────────────────────
# Failures are not independent: a dead browser, a network outage or a thrashing
# host makes every product fail at once. Tracking failures globally lets the
# per-product "selector broken" mail be replaced by one "scraping is down"
# message per user — the difference between one true alert and 34 misleading
# ones. Any successful scrape proves the infrastructure works and clears it.
_last_success_at: datetime | None = None
_failing_products: set[int] = set()
_storm_notified_users: set[int] = set()

# One "Check all" pass at a time (see run_check_all).
_check_all_running = False


def last_successful_scrape_at() -> datetime | None:
    return _last_success_at


def scraping_looks_broken() -> bool:
    """True when enough distinct products have failed with no success between."""
    minimum = settings.scrape_storm_min_products
    return bool(minimum) and len(_failing_products) >= minimum


def _record_scrape_failure(product_id: int) -> None:
    _failing_products.add(product_id)


def _record_scrape_success(product_id: int) -> None:
    global _last_success_at
    _last_success_at = datetime.now(UTC)
    _failing_products.clear()


def reset_scrape_health() -> None:
    """Drop all scraper-health state (used by tests)."""
    global _last_success_at
    _last_success_at = None
    _failing_products.clear()
    _storm_notified_users.clear()


def product_scrape_lock(product_id: int) -> asyncio.Lock:
    return _product_locks[product_id]


def evaluate_alert(
    condition: str,
    threshold_price: Decimal | None,
    price: Decimal,
    prev_price: Decimal | None,
    threshold_percent: Decimal | None = None,
) -> bool:
    """Decide whether an alert fires for the newly observed price."""
    if condition == "below" and threshold_price is not None:
        # Fire only when crossing the threshold, not on every check while the
        # price stays below it (would spam once combined with frequent checks).
        crossed = prev_price is None or prev_price > threshold_price
        return price <= threshold_price and crossed
    if condition == "lowered":
        return prev_price is not None and price < prev_price
    if condition == "lowered_percent" and threshold_percent is not None:
        if prev_price is None or prev_price <= 0:
            return False
        drop_percent = (prev_price - price) / prev_price * Decimal(100)
        return drop_percent >= threshold_percent
    if condition in ("changed", "any_change"):
        return prev_price is not None and price != prev_price
    return False


def _urls_same_resource(url1: str, url2: str) -> bool:
    """Return True if two URLs point to the same resource (same host + path, ignoring query/fragment)."""
    try:
        p1 = urlparse(url1)
        p2 = urlparse(url2)
        return (
            p1.netloc.lower() == p2.netloc.lower()
            and p1.path.rstrip("/").lower() == p2.path.rstrip("/").lower()
        )
    except (ValueError, TypeError):
        # Unparseable URL — fall back to exact comparison rather than silently
        # suppressing redirect detection.
        return url1 == url2


async def _notify_product_owner(product: Product, db, subject: str, body: str) -> None:
    """Send a product-level notification to the owner's default channels."""
    user = await db.get(User, product.user_id)
    if user is None:
        return
    await notify(
        email=user.default_email,
        telegram_chat_id=user.default_telegram_chat_id,
        subject=subject,
        body=body,
    )


async def _notify_scraping_down(product: Product, db) -> None:
    """One outage notice per affected user, in place of per-product mail."""
    if product.user_id in _storm_notified_users:
        return
    _storm_notified_users.add(product.user_id)
    await _notify_product_owner(
        product,
        db,
        subject="[Caero] Scraping is failing for all tracked products",
        body=(
            f"Caero could not scrape {len(_failing_products)} products in a row, starting with "
            f"'{product.name}'.\n"
            f"Failures this widespread are usually not broken selectors — check that the "
            f"container has enough memory, that the browser started, and that the host has "
            f"network access.\n\n"
            f"Per-product notifications are suppressed until scraping recovers.\n"
        ),
    )


async def _notify_scraping_recovered(product: Product, db) -> None:
    _storm_notified_users.discard(product.user_id)
    await _notify_product_owner(
        product,
        db,
        subject="[Caero] Scraping recovered",
        body=(
            f"Caero is scraping successfully again (first success: '{product.name}').\n"
            f"Per-product notifications are active again.\n"
        ),
    )


async def check_url_redirect(product: Product, final_url: str | None, db) -> None:
    """Compare the scraped final URL to the stored URL and update url_redirected accordingly."""
    if not final_url:
        return
    if not _urls_same_resource(product.url, final_url):
        logger.debug("product %d URL redirected: %s -> %s", product.id, product.url, final_url)
        if not product.url_redirected:
            product.url_redirected = True
            await _notify_product_owner(
                product,
                db,
                subject=f"[Caero] URL Redirected: '{product.name}' now points to a different product",
                body=(
                    f"Caero detected that the URL for '{product.name}' is redirecting to a different page.\n\n"
                    f"Original URL: {product.url}\n"
                    f"Redirected to: {final_url}\n\n"
                    f"The product may no longer be available and has been replaced by a different item. "
                    f"Please update the product URL in Caero."
                ),
            )
    elif product.url_redirected:
        product.url_redirected = False


async def scrape_and_record(product_id: int) -> None:
    """Scrape the current price for a product and persist it."""
    browser = await ensure_browser()
    if browser is None:
        logger.warning("Browser not available, skipping job for product %d", product_id)
        return

    async with product_scrape_lock(product_id):
        await _scrape_and_record_locked(product_id, browser)


def check_all_in_progress() -> bool:
    return _check_all_running


async def run_check_all(product_ids: list[int]) -> None:
    """Scrape every given product once, one full pass at a time.

    Guarded because repeated "Check all" clicks otherwise stack full passes:
    the per-product lock serializes them instead of dropping them, so the
    scraper stays saturated long after the user stopped clicking.
    """
    global _check_all_running
    if _check_all_running:
        logger.info("Check-all already running — ignoring duplicate request")
        return

    _check_all_running = True
    try:
        for product_id in product_ids:
            try:
                await scrape_and_record(product_id)
            except Exception:
                # One bad product must not abort the rest of the pass.
                logger.exception("Check-all failed for product %d", product_id)
    finally:
        _check_all_running = False


async def _scrape_and_record_locked(product_id: int, browser) -> None:
    # Short read-only session: the scrape itself can take up to a minute, so
    # never hold a transaction across it (SQLite locks, PG idle-in-transaction).
    async with AsyncSessionLocal() as db:
        product = await db.get(Product, product_id)
        if product is None or not product.active:
            return
        url, selector, price_format = product.url, product.selector, product.price_format

    from app.scraper import scrape_price

    started = time.monotonic()
    result = await scrape_price(browser, url, selector, price_format)
    elapsed = time.monotonic() - started
    # Rising scrape durations are the early warning for a queue backing up, so
    # slow ones are visible without turning on debug logging.
    if elapsed >= _SLOW_SCRAPE_SECONDS:
        logger.info("Slow scrape: product %d took %.1fs", product_id, elapsed)
    else:
        logger.debug("Scraped product %d in %.1fs", product_id, elapsed)

    async with AsyncSessionLocal() as db:
        # Re-fetch: the product may have been edited or deleted during the scrape.
        product = await db.get(Product, product_id)
        if product is None or not product.active:
            return

        # Always update last_checked_at
        product.last_checked_at = func.now()

        await check_url_redirect(product, result.final_url, db)

        if product.url_redirected:
            logger.debug("Skipping price record for product %d — URL redirected", product_id)
            await db.commit()
            return

        failure_threshold = settings.scraper_failure_alert_threshold

        if result.price is None:
            logger.warning("Could not scrape price for product %d (%s)", product_id, product.url)
            product.consecutive_scrape_failures += 1
            _record_scrape_failure(product_id)
            await db.commit()

            # Exactly-once notification when the threshold is first reached.
            if product.consecutive_scrape_failures == failure_threshold:
                if scraping_looks_broken():
                    # Everything is failing — one outage notice per user beats a
                    # selector warning per product. The first product or two to
                    # cross the threshold may still get the per-product mail:
                    # a storm is only recognisable once several products fail.
                    await _notify_scraping_down(product, db)
                else:
                    await _notify_product_owner(
                        product,
                        db,
                        subject=f"[Caero] Action Required: Selector broken for '{product.name}'",
                        body=(
                            f"Caero has failed to find a valid price using your CSS selector "
                            f"{failure_threshold} times in a row for '{product.name}'.\n"
                            f"The webpage layout likely changed, or the item is no longer available.\n\n"
                            f"Product URL: {product.url}\n"
                        ),
                    )
            return

        _record_scrape_success(product_id)

        # If success, reset consecutive failures; if the user was told the
        # selector broke, tell them it recovered.
        if product.user_id in _storm_notified_users:
            # They were told scraping was down, not that this selector broke —
            # answer the message they actually got, once.
            await _notify_scraping_recovered(product, db)
        elif product.consecutive_scrape_failures >= failure_threshold:
            await _notify_product_owner(
                product,
                db,
                subject=f"[Caero] Recovered: '{product.name}' is being tracked again",
                body=(
                    f"Caero found a valid price for '{product.name}' again after "
                    f"{product.consecutive_scrape_failures} failed check(s). No action needed.\n\n"
                    f"Product URL: {product.url}\n"
                ),
            )
        if product.consecutive_scrape_failures > 0:
            product.consecutive_scrape_failures = 0

        price = Decimal(str(result.price)).quantize(Decimal("0.01"))

        # Get previous price for change detection BEFORE adding the new one
        prev_result = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.product_id == product_id)
            .order_by(PriceHistory.scraped_at.desc())
            .limit(1)
        )
        prev = prev_result.scalar_one_or_none()
        prev_price = prev.price if prev else None

        now = datetime.now(UTC)
        changed = prev is None or prev.price != price

        if changed or product.record_all_prices:
            # Keep the previous currency when detection fails.
            currency = result.currency or (prev.currency if prev else None) or "EUR"
            db.add(PriceHistory(product_id=product_id, price=price, currency=currency))

            # A currency flip means the history now mixes units (site redirect,
            # selector change, …). Fires once: the next check compares against
            # the row just written.
            if prev is not None and prev.currency and currency != prev.currency:
                logger.warning(
                    "product %d currency changed %s -> %s", product_id, prev.currency, currency
                )
                await _notify_product_owner(
                    product,
                    db,
                    subject=f"[Caero] Currency changed for '{product.name}'",
                    body=(
                        f"The scraped price for '{product.name}' switched from "
                        f"{prev.currency} to {currency}.\n"
                        f"Price history and statistics now mix currencies — check the "
                        f"product URL and selector.\n\n"
                        f"Product URL: {product.url}\n"
                    ),
                )

        # Evaluate alerts on every successful check; the conditions themselves
        # (crossing/lowered/changed vs prev_price) keep unchanged prices quiet.
        alerts_result = await db.execute(
            select(Alert).where(Alert.product_id == product_id, Alert.active == True)  # noqa: E712
        )
        alerts = alerts_result.scalars().all()

        for alert in alerts:
            alert.last_checked_at = now
            triggered = evaluate_alert(
                alert.condition,
                alert.threshold_price,
                price,
                prev_price,
                alert.threshold_percent,
            )

            if triggered:
                alert.last_triggered_at = now
                await send_alert(
                    to_email=alert.email,
                    telegram_chat_id=alert.telegram_chat_id,
                    product_name=product.name,
                    product_url=product.url,
                    condition=alert.condition,
                    current_price=price,
                    threshold_price=alert.threshold_price,
                    threshold_percent=alert.threshold_percent,
                    previous_price=prev_price,
                )

        await db.commit()
        if changed or product.record_all_prices:
            logger.info("Recorded price %.2f for product %d", price, product_id)
        else:
            logger.debug("Price for product %d unchanged (%.2f) — no record", product_id, price)


def _cohort_size(hhmm: str) -> int:
    """How many scheduled products share this check time (self included)."""
    return sum(1 for value in _job_check_times.values() if value == hhmm) or 1


def add_product_job(product: Product, run_immediately: bool = False) -> None:
    import random
    from datetime import timedelta

    from app.schedule_utils import get_next_run_time, jitter_window_seconds, normalize_check_time_hhmm

    job_id = f"product_{product.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    if not product.active or product.check_interval_minutes <= 0:
        _job_check_times.pop(job_id, None)
        logger.debug("Skipping job %s (inactive or disabled interval)", job_id)
        return

    hhmm = normalize_check_time_hhmm(product.check_time_hhmm)
    _job_check_times[job_id] = hhmm

    if run_immediately:
        next_run = datetime.now(UTC)
    else:
        # Spread products sharing a check time over a jitter window so they
        # don't hammer shops (and the scrape semaphore) in one burst. The window
        # widens with the cohort, otherwise it is swamped once enough products
        # share a time and they all queue on the semaphore anyway.
        window = jitter_window_seconds(
            settings.schedule_jitter_seconds,
            _cohort_size(hhmm),
            settings.schedule_jitter_per_product_seconds,
            max_seconds=product.check_interval_minutes * 60,
        )
        next_run = get_next_run_time(hhmm) + timedelta(seconds=random.uniform(0, window))

    scheduler.add_job(
        scrape_and_record,
        "interval",
        minutes=product.check_interval_minutes,
        id=job_id,
        args=[product.id],
        replace_existing=True,
        next_run_time=next_run,
        # Under memory pressure a scrape can outlive its next slot. Without a
        # grace time APScheduler drops the run entirely, leaving a silent hole
        # in price history; with it the run is merely late. 0 = never drop.
        misfire_grace_time=settings.scrape_misfire_grace_seconds or None,
        # Several missed runs collapse into one — catching up serially would
        # just re-create the burst that caused the misfires.
        coalesce=True,
        max_instances=1,
    )
    logger.debug("Scheduled job %s every %d min, next run %s", job_id, product.check_interval_minutes, next_run)


def remove_product_job(product_id: int) -> None:
    job_id = f"product_{product_id}"
    _job_check_times.pop(job_id, None)
    _failing_products.discard(product_id)
    # Drop the product's lock too, but never while it is held — the holder would
    # keep the old object and a new caller would get an unlocked one.
    lock = _product_locks.get(product_id)
    if lock is not None and not lock.locked():
        _product_locks.pop(product_id, None)
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.debug("Removed job %s", job_id)


async def load_all_jobs() -> None:
    """Load all active products and schedule their jobs at startup."""
    from app.schedule_utils import normalize_check_time_hhmm

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Product).where(Product.active == True))  # noqa: E712
        products = result.scalars().all()
        schedulable = [p for p in products if p.check_interval_minutes > 0]
        # Seed the cohort registry before scheduling anything, so the first
        # product sized its window against the full cohort and not against the
        # handful of jobs that happened to be added before it.
        _job_check_times.clear()
        for product in schedulable:
            _job_check_times[f"product_{product.id}"] = normalize_check_time_hhmm(product.check_time_hhmm)
        for product in schedulable:
            add_product_job(product)
    logger.info("Loaded %d product jobs into scheduler", len(products))
