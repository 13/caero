"""APScheduler integration — one job per active product."""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from urllib.parse import urlparse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.sql import func

from app.browser import get_browser
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Alert, PriceHistory, Product, User
from app.notifier import notify, send_alert

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Scheduled jobs, "Check now", and "Check all" can target the same product at
# the same time; without a lock both would read the same previous price and
# insert duplicate rows / double-fire alerts.
_product_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


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
    browser = get_browser()
    if browser is None:
        logger.warning("Browser not available, skipping job for product %d", product_id)
        return

    async with product_scrape_lock(product_id):
        await _scrape_and_record_locked(product_id, browser)


async def _scrape_and_record_locked(product_id: int, browser) -> None:
    # Short read-only session: the scrape itself can take up to a minute, so
    # never hold a transaction across it (SQLite locks, PG idle-in-transaction).
    async with AsyncSessionLocal() as db:
        product = await db.get(Product, product_id)
        if product is None or not product.active:
            return
        url, selector, price_format = product.url, product.selector, product.price_format

    from app.scraper import scrape_price

    result = await scrape_price(browser, url, selector, price_format)

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
            await db.commit()

            # Exactly-once notification when the threshold is first reached.
            if product.consecutive_scrape_failures == failure_threshold:
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

        # If success, reset consecutive failures; if the user was told the
        # selector broke, tell them it recovered.
        if product.consecutive_scrape_failures >= failure_threshold:
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


def add_product_job(product: Product, run_immediately: bool = False) -> None:
    import random
    from datetime import timedelta

    from app.schedule_utils import get_next_run_time

    job_id = f"product_{product.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    if not product.active or product.check_interval_minutes <= 0:
        logger.debug("Skipping job %s (inactive or disabled interval)", job_id)
        return

    if run_immediately:
        next_run = datetime.now(UTC)
    else:
        # Spread products sharing a check time over a jitter window so they
        # don't hammer shops (and the scrape semaphore) in one burst.
        jitter = timedelta(seconds=random.uniform(0, settings.schedule_jitter_seconds))
        next_run = get_next_run_time(product.check_time_hhmm) + jitter

    scheduler.add_job(
        scrape_and_record,
        "interval",
        minutes=product.check_interval_minutes,
        id=job_id,
        args=[product.id],
        replace_existing=True,
        next_run_time=next_run,
    )
    logger.debug("Scheduled job %s every %d min, next run %s", job_id, product.check_interval_minutes, next_run)


def remove_product_job(product_id: int) -> None:
    job_id = f"product_{product_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.debug("Removed job %s", job_id)


async def load_all_jobs() -> None:
    """Load all active products and schedule their jobs at startup."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Product).where(Product.active == True))  # noqa: E712
        products = result.scalars().all()
        for product in products:
            if product.check_interval_minutes > 0:
                add_product_job(product)
    logger.info("Loaded %d product jobs into scheduler", len(products))
