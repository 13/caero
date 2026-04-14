"""Products router."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.models import PriceHistory, Product, User
from app.routers.auth import require_user
from app.scheduler import add_product_job, remove_product_job, scrape_and_record
from app.schemas import (
    CheckResult,
    ProductCreate,
    ProductOut,
    ProductStatisticsOut,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])


async def _get_product(product_id: int, user: User, db: AsyncSession) -> Product:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


async def _latest_two_prices(product_id: int, db: AsyncSession) -> list[PriceHistory]:
    result = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.product_id == product_id)
        .order_by(PriceHistory.scraped_at.desc())
        .limit(2)
    )
    return result.scalars().all()


def _tags_to_list(raw_tags: str | None) -> list[str]:
    if not raw_tags:
        return []
    return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]


def _tags_to_string(tags: list[str] | None) -> str:
    if not tags:
        return ""
    unique_tags: list[str] = []
    for tag in tags:
        cleaned = tag.strip()
        if cleaned and cleaned not in unique_tags:
            unique_tags.append(cleaned)
    return ",".join(unique_tags)


async def _to_product_out(product: Product, db: AsyncSession) -> ProductOut:
    from app.scheduler import scheduler

    latest_two = await _latest_two_prices(product.id, db)
    latest_price = latest_two[0].price if latest_two else None
    previous_price = latest_two[1].price if len(latest_two) > 1 else None
    last_change_percent = None
    last_change_at = latest_two[0].scraped_at if len(latest_two) > 1 else None
    if latest_price is not None and previous_price is not None and previous_price != Decimal(0):
        last_change_percent = ((latest_price - previous_price) / previous_price) * Decimal(100)
        last_change_percent = last_change_percent.quantize(Decimal("0.01"))

    job = scheduler.get_job(f"product_{product.id}")
    next_run_at = job.next_run_time if job else None

    return ProductOut.model_validate(
        {
            **product.__dict__,
            "tags": _tags_to_list(product.tags),
            "latest_price": latest_price,
            "previous_price": previous_price,
            "last_price_change_percent": last_change_percent,
            "last_price_change_at": last_change_at,
            "next_run_at": next_run_at,
        }
    )


@router.get("", response_model=list[ProductOut])
async def list_products(
    user: User = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[ProductOut]:
    from app.scheduler import scheduler

    result = await db.execute(select(Product).where(Product.user_id == user.id))
    products = result.scalars().all()
    if not products:
        return []

    product_ids = [p.id for p in products]

    rn = func.row_number().over(
        partition_by=PriceHistory.product_id,
        order_by=PriceHistory.scraped_at.desc()
    ).label("rn")

    stmt = (
        select(PriceHistory)
        .add_columns(rn)
        .where(PriceHistory.product_id.in_(product_ids))
    )

    subq = stmt.subquery()
    aliased_ph = aliased(PriceHistory, subq)

    prices_stmt = select(aliased_ph).where(subq.c.rn <= 2).order_by(aliased_ph.product_id, aliased_ph.scraped_at.desc())
    prices_result = await db.execute(prices_stmt)
    prices = prices_result.scalars().all()

    from collections import defaultdict
    prices_by_product = defaultdict(list)
    for p in prices:
        prices_by_product[p.product_id].append(p)

    out = []
    for product in products:
        latest_two = prices_by_product.get(product.id, [])
        latest_price = latest_two[0].price if latest_two else None
        previous_price = latest_two[1].price if len(latest_two) > 1 else None
        last_change_percent = None
        last_change_at = latest_two[0].scraped_at if len(latest_two) > 1 else None
        if latest_price is not None and previous_price is not None and previous_price != Decimal(0):
            last_change_percent = ((latest_price - previous_price) / previous_price) * Decimal(100)
            last_change_percent = last_change_percent.quantize(Decimal("0.01"))

        job = scheduler.get_job(f"product_{product.id}")
        next_run_at = job.next_run_time if job else None

        out.append(ProductOut.model_validate(
            {
                **product.__dict__,
                "tags": _tags_to_list(product.tags),
                "latest_price": latest_price,
                "previous_price": previous_price,
                "last_price_change_percent": last_change_percent,
                "last_price_change_at": last_change_at,
                "next_run_at": next_run_at,
            }
        ))
    return out


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    payload = body.model_dump()
    payload["tags"] = _tags_to_string(payload.get("tags"))
    product = Product(**payload, user_id=user.id)
    db.add(product)
    await db.flush()
    await db.refresh(product)
    if product.active:
        add_product_job(product)
    return await _to_product_out(product, db)


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await _get_product(product_id, user, db)
    return await _to_product_out(product, db)


@router.patch("/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await _get_product(product_id, user, db)
    old_interval = product.check_interval_minutes
    old_active = product.active

    updates = body.model_dump(exclude_unset=True)
    if "tags" in updates:
        updates["tags"] = _tags_to_string(updates["tags"])

    for key, value in updates.items():
        setattr(product, key, value)

    await db.flush()
    await db.refresh(product)

    # Reschedule if interval or active state changed
    interval_changed = "check_interval_minutes" in updates and product.check_interval_minutes != old_interval
    active_changed = "active" in updates and product.active != old_active

    if product.active and (interval_changed or active_changed):
        add_product_job(product)
    elif not product.active and active_changed:
        remove_product_job(product_id)

    return await _to_product_out(product, db)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    product = await _get_product(product_id, user, db)
    remove_product_job(product_id)
    await db.delete(product)


@router.post("/{product_id}/check", response_model=CheckResult)
async def check_product_now(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> CheckResult:
    product = await _get_product(product_id, user, db)
    from app.main import app

    browser = getattr(app.state, "browser", None)
    if browser is None:
        return CheckResult(product_id=product_id, price=None, error="Browser not available")

    from app.scraper import scrape_price

    price_float = await scrape_price(browser, product.url, product.selector)
    if price_float is None:
        return CheckResult(product_id=product_id, price=None, error="Could not scrape price")

    price = Decimal(str(price_float)).quantize(Decimal("0.01"))
    record = PriceHistory(product_id=product_id, price=price)
    db.add(record)
    await db.flush()

    return CheckResult(product_id=product_id, price=price)


@router.post("/check-all", status_code=status.HTTP_202_ACCEPTED)
async def check_all_products_now(
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    from app.scheduler import scrape_and_record

    result = await db.execute(
        select(Product.id).where(Product.user_id == user.id, Product.active == True)
    )
    product_ids = result.scalars().all()

    for pid in product_ids:
        background_tasks.add_task(scrape_and_record, pid)

    return {
        "status": "ok",
        "message": f"Checking {len(product_ids)} active products in the background.",
    }


@router.get("/{product_id}/stats", response_model=ProductStatisticsOut)
async def get_product_statistics(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductStatisticsOut:
    await _get_product(product_id, user, db)

    # Run aggregations in DB
    stats_stmt = select(
        func.count(PriceHistory.id),
        func.min(PriceHistory.price),
        func.max(PriceHistory.price),
        func.avg(PriceHistory.price)
    ).where(PriceHistory.product_id == product_id)

    stats_result = await db.execute(stats_stmt)
    data_points, lowest_val, highest_val, avg_val = stats_result.one()

    if not data_points:
        return ProductStatisticsOut()

    average_price = Decimal(str(avg_val)).quantize(Decimal("0.01")) if avg_val else Decimal(0)

    # Min/Max queries
    # Lowest price at
    lowest_stmt = select(PriceHistory).where(
        PriceHistory.product_id == product_id,
        PriceHistory.price == lowest_val
    ).order_by(PriceHistory.scraped_at.asc()).limit(1)
    lowest_res = await db.execute(lowest_stmt)
    lowest = lowest_res.scalar_one()

    # Highest price at
    highest_stmt = select(PriceHistory).where(
        PriceHistory.product_id == product_id,
        PriceHistory.price == highest_val
    ).order_by(PriceHistory.scraped_at.asc()).limit(1)
    highest_res = await db.execute(highest_stmt)
    highest = highest_res.scalar_one()

    # First and Last two points
    first_stmt = select(PriceHistory).where(PriceHistory.product_id == product_id).order_by(PriceHistory.scraped_at.asc()).limit(1)
    first_res = await db.execute(first_stmt)
    first = first_res.scalar_one()

    last_two_stmt = select(PriceHistory).where(PriceHistory.product_id == product_id).order_by(PriceHistory.scraped_at.desc()).limit(2)
    last_two_res = await db.execute(last_two_stmt)
    last_two = last_two_res.scalars().all()
    current = last_two[0]
    previous = last_two[1] if len(last_two) > 1 else None

    total_change_percent = None
    if first.price != Decimal(0):
        total_change_percent = (((current.price - first.price) / first.price) * Decimal(100)).quantize(
            Decimal("0.01")
        )

    last_change_percent = None
    last_change_at = None
    if previous and previous.price != Decimal(0):
        last_change_percent = (((current.price - previous.price) / previous.price) * Decimal(100)).quantize(
            Decimal("0.01")
        )
        last_change_at = current.scraped_at

    return ProductStatisticsOut(
        average_price=average_price,
        lowest_price=lowest.price,
        lowest_price_at=lowest.scraped_at,
        highest_price=highest.price,
        highest_price_at=highest.scraped_at,
        current_price=current.price,
        total_change_percent=total_change_percent,
        last_change_percent=last_change_percent,
        last_change_at=last_change_at,
        data_points=data_points,
    )
