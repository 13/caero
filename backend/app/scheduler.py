"""APScheduler integration — one job per active product."""
from __future__ import annotations

import logging
from decimal import Decimal
from urllib.parse import urlparse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Alert, PriceHistory, Product, User
from app.notifier import send_alert

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _urls_same_resource(url1: str, url2: str) -> bool:
    """Return True if two URLs point to the same resource (same host + path, ignoring query/fragment)."""
    try:
        p1 = urlparse(url1)
        p2 = urlparse(url2)
        return (
            p1.netloc.lower() == p2.netloc.lower()
            and p1.path.rstrip("/").lower() == p2.path.rstrip("/").lower()
        )
    except Exception:
        return True


async def check_url_redirect(product: Product, final_url: str | None, db) -> None:
    """Compare the scraped final URL to the stored URL and update url_redirected accordingly."""
    if not final_url:
        return
    if not _urls_same_resource(product.url, final_url):
        logger.debug("product %d URL redirected: %s -> %s", product.id, product.url, final_url)
        if not product.url_redirected:
            product.url_redirected = True
            user = await db.get(User, product.user_id)
            if user and (user.default_email or user.default_telegram_chat_id):
                subject = f"[Caero] URL Redirected: '{product.name}' now points to a different product"
                body = (
                    f"Caero detected that the URL for '{product.name}' is redirecting to a different page.\n\n"
                    f"Original URL: {product.url}\n"
                    f"Redirected to: {final_url}\n\n"
                    f"The product may no longer be available and has been replaced by a different item. "
                    f"Please update the product URL in Caero."
                )
                import asyncio
                from app.notifier import _build_message, _send_email_alert_sync, _send_telegram_alert, _build_notification

                if user.default_email:
                    from app.config import settings
                    if settings.smtp_host:
                        msg = _build_message(subject, body, user.default_email)
                        await asyncio.to_thread(_send_email_alert_sync, to_email=user.default_email, msg=msg, product_name=product.name)

                if user.default_telegram_chat_id:
                    await _send_telegram_alert(
                        chat_id=user.default_telegram_chat_id,
                        text=_build_notification(subject, body),
                    )
    elif product.url_redirected:
        product.url_redirected = False


async def scrape_and_record(product_id: int) -> None:
    """Scrape the current price for a product and persist it."""
    from app.main import app  # late import to avoid circular dep

    browser = getattr(app.state, "browser", None)
    if browser is None:
        logger.warning("Browser not available, skipping job for product %d", product_id)
        return

    async with AsyncSessionLocal() as db:
        product = await db.get(Product, product_id)
        if product is None or not product.active:
            return

        from app.scraper import scrape_price

        price_float, final_url = await scrape_price(browser, product.url, product.selector)

        # Always update last_checked_at
        from sqlalchemy.sql import func

        product.last_checked_at = func.now()

        await check_url_redirect(product, final_url, db)

        if price_float is None:
            logger.warning("Could not scrape price for product %d (%s)", product_id, product.url)
            product.consecutive_scrape_failures += 1
            await db.commit()

            if product.consecutive_scrape_failures == 3:
                user = await db.get(User, product.user_id)
                if user and (user.default_email or user.default_telegram_chat_id):
                    # We will send a generic alert by using "changed" and no current_price
                    subject = f"[Caero] Action Required: Selector broken for '{product.name}'"
                    body = (
                        f"Caero has failed to find a valid price using your CSS selector 3 times in a row for '{product.name}'.\n"
                        f"The webpage layout likely changed, or the item is no longer available.\n\n"
                        f"Product URL: {product.url}\n"
                    )
                    import asyncio
                    from app.notifier import _build_message, _send_email_alert_sync, _send_telegram_alert, _build_notification
                    
                    if user.default_email:
                        from app.config import settings
                        if settings.smtp_host:
                            msg = _build_message(subject, body, user.default_email)
                            await asyncio.to_thread(_send_email_alert_sync, to_email=user.default_email, msg=msg, product_name=product.name)
                            
                    if user.default_telegram_chat_id:
                        await _send_telegram_alert(
                            chat_id=user.default_telegram_chat_id,
                            text=_build_notification(subject, body),
                        )
            
            return

        # If success, reset consecutive failures
        if product.consecutive_scrape_failures > 0:
            product.consecutive_scrape_failures = 0

        price = Decimal(str(price_float)).quantize(Decimal("0.01"))

        # Get previous price for change detection BEFORE adding the new one
        prev_result = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.product_id == product_id)
            .order_by(PriceHistory.scraped_at.desc())
            .limit(1)
        )
        prev = prev_result.scalar_one_or_none()

        if prev is not None and prev.price == price:
            logger.debug("Price for product %d unchanged (%.2f) — skipping record", product_id, price)
            await db.commit()
            return

        # Persist price record
        record = PriceHistory(product_id=product_id, price=price)
        db.add(record)
        # Flush if necessary, but we don't strictly need to flush here anymore

        # Check alerts
        alerts_result = await db.execute(
            select(Alert).where(Alert.product_id == product_id, Alert.active == True)  # noqa: E712
        )
        alerts = alerts_result.scalars().all()

        for alert in alerts:
            triggered = False
            if alert.condition == "below" and alert.threshold_price is not None:
                triggered = price <= alert.threshold_price
            elif alert.condition == "lowered":
                triggered = prev is not None and price < prev.price
            elif alert.condition in ("changed", "any_change"):
                triggered = prev is not None and price != prev.price

            if triggered:
                await send_alert(
                    to_email=alert.email,
                    telegram_chat_id=alert.telegram_chat_id,
                    product_name=product.name,
                    product_url=product.url,
                    condition=alert.condition,
                    current_price=price,
                    threshold_price=alert.threshold_price,
                )

        await db.commit()
        logger.info("Recorded price %.2f for product %d", price, product_id)


def add_product_job(product: Product, run_immediately: bool = False) -> None:
    from datetime import datetime, timezone
    from app.schedule_utils import get_next_run_time

    job_id = f"product_{product.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    if not product.active or product.check_interval_minutes <= 0:
        logger.debug("Skipping job %s (inactive or disabled interval)", job_id)
        return

    next_run = (
        datetime.now(timezone.utc)
        if run_immediately
        else get_next_run_time(product.check_time_hhmm)
    )

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