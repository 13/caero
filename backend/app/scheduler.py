"""APScheduler integration — one job per active product."""
from __future__ import annotations

import logging
from decimal import Decimal

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Alert, PriceHistory, Product
from app.notifier import send_alert

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


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

        price_float = await scrape_price(browser, product.url, product.selector)
        if price_float is None:
            logger.warning("Could not scrape price for product %d (%s)", product_id, product.url)
            return

        price = Decimal(str(price_float)).quantize(Decimal("0.01"))

        # Persist price record
        record = PriceHistory(product_id=product_id, price=price)
        db.add(record)
        await db.flush()

        # Get previous price for change detection
        prev_result = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.product_id == product_id)
            .order_by(PriceHistory.scraped_at.desc())
            .offset(1)
            .limit(1)
        )
        prev = prev_result.scalar_one_or_none()

        # Check alerts
        alerts_result = await db.execute(
            select(Alert).where(Alert.product_id == product_id, Alert.active == True)  # noqa: E712
        )
        alerts = alerts_result.scalars().all()

        for alert in alerts:
            triggered = False
            if alert.condition == "below" and alert.threshold_price is not None:
                triggered = price <= alert.threshold_price
            elif alert.condition in ("changed", "any_change"):
                triggered = prev is not None and price != prev.price

            if triggered:
                send_alert(
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


def add_product_job(product: Product) -> None:
    job_id = f"product_{product.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        scrape_and_record,
        "interval",
        minutes=product.check_interval_minutes,
        id=job_id,
        args=[product.id],
        replace_existing=True,
    )
    logger.debug("Scheduled job %s every %d min", job_id, product.check_interval_minutes)


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
            add_product_job(product)
    logger.info("Loaded %d product jobs into scheduler", len(products))
