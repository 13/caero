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

async def _get_latest_price_changes(db: AsyncSession, product_ids: list[int]) -> dict[int, dict]:
    if not product_ids:
        return {}

    latest_rn = func.row_number().over(
        partition_by=PriceHistory.product_id,
        order_by=PriceHistory.scraped_at.desc()
    ).label("rn")
    latest_subq = (
        select(PriceHistory.product_id, PriceHistory.price, PriceHistory.scraped_at)
        .where(PriceHistory.product_id.in_(product_ids))
        .add_columns(latest_rn)
    ).subquery()

    latest_stmt = select(latest_subq).where(latest_subq.c.rn == 1)
    latest_rows = (await db.execute(latest_stmt)).all()

    latest_prices = {row.product_id: (row.price, row.scraped_at) for row in latest_rows}

    diff_rn = func.row_number().over(
        partition_by=PriceHistory.product_id,
        order_by=PriceHistory.scraped_at.desc()
    ).label("rn")

    diff_subq = (
        select(PriceHistory.product_id, PriceHistory.price, PriceHistory.scraped_at)
        .join(
            latest_subq,
            (PriceHistory.product_id == latest_subq.c.product_id) & (latest_subq.c.rn == 1)
        )
        .where(PriceHistory.price != latest_subq.c.price)
        .add_columns(diff_rn)
    ).subquery()

    diff_stmt = select(diff_subq).where(diff_subq.c.rn == 1)
    diff_rows = (await db.execute(diff_stmt)).all()

    prev_different_prices = {row.product_id: (row.price, row.scraped_at) for row in diff_rows}

    out = {}
    from sqlalchemy import or_
    or_conditions = []
    for pid, prev in prev_different_prices.items():
        or_conditions.append(
            (PriceHistory.product_id == pid) & (PriceHistory.scraped_at > prev[1])
        )

    first_seen_map = {}
    if or_conditions:
        first_seen_stmt = select(PriceHistory.product_id, func.min(PriceHistory.scraped_at)).where(or_(*or_conditions)).group_by(PriceHistory.product_id)
        first_seen_rows = (await db.execute(first_seen_stmt)).all()
        first_seen_map = {row[0]: row[1] for row in first_seen_rows}

    for pid in product_ids:
        latest = latest_prices.get(pid)
        if not latest:
            out[pid] = {
                "latest_price": None,
                "previous_price": None,
                "last_change_at": None,
                "last_change_percent": None,
                "last_checked_at": None
            }
            continue

        latest_price, latest_scraped_at = latest
        prev = prev_different_prices.get(pid)
        if not prev:
            out[pid] = {
                "latest_price": latest_price,
                "previous_price": latest_price,
                "last_change_at": latest_scraped_at,
                "last_change_percent": Decimal("0.00"),
                "last_checked_at": latest_scraped_at
            }
            continue

        prev_price, _ = prev
        last_change_at = first_seen_map.get(pid)
        last_change_percent = Decimal("0.00")
        if prev_price != Decimal(0):
            last_change_percent = ((latest_price - prev_price) / prev_price) * Decimal(100)
            last_change_percent = last_change_percent.quantize(Decimal("0.01"))

        out[pid] = {
            "latest_price": latest_price,
            "previous_price": prev_price,
            "last_change_at": last_change_at,
            "last_change_percent": last_change_percent,
            "last_checked_at": latest_scraped_at
        }

    # Now get extremes (lowest and highest prices and their dates)
    extreme_rn_min = func.row_number().over(
        partition_by=PriceHistory.product_id,
        order_by=[PriceHistory.price.asc(), PriceHistory.scraped_at.desc()]
    ).label("rn_min")

    extreme_rn_max = func.row_number().over(
        partition_by=PriceHistory.product_id,
        order_by=[PriceHistory.price.desc(), PriceHistory.scraped_at.desc()]
    ).label("rn_max")

    base_subq_extreme = select(PriceHistory.product_id, PriceHistory.price, PriceHistory.scraped_at).where(PriceHistory.product_id.in_(product_ids))

    min_subq = base_subq_extreme.add_columns(extreme_rn_min).subquery()
    max_subq = base_subq_extreme.add_columns(extreme_rn_max).subquery()

    min_stmt = select(min_subq).where(min_subq.c.rn_min == 1)
    max_stmt = select(max_subq).where(max_subq.c.rn_max == 1)

    min_rows = (await db.execute(min_stmt)).all()
    max_rows = (await db.execute(max_stmt)).all()

    min_map = {row.product_id: (row.price, row.scraped_at) for row in min_rows}
    max_map = {row.product_id: (row.price, row.scraped_at) for row in max_rows}

    for pid in product_ids:
        if pid in out:
            min_val = min_map.get(pid)
            max_val = max_map.get(pid)
            out[pid]["lowest_price"] = min_val[0] if min_val else None
            out[pid]["lowest_price_at"] = min_val[1] if min_val else None
            out[pid]["highest_price"] = max_val[0] if max_val else None
            out[pid]["highest_price_at"] = max_val[1] if max_val else None

    return out

async def _to_product_out(product: Product, db: AsyncSession) -> ProductOut:
    from app.scheduler import scheduler

    latest_prices = await _get_latest_price_changes(db, [product.id])
    latest_price_info = latest_prices.get(product.id, {})
    latest_price = latest_price_info.get("latest_price")
    previous_price = latest_price_info.get("previous_price")
    last_change_at = latest_price_info.get("last_change_at")
    last_change_percent = latest_price_info.get("last_change_percent")
    last_checked_at = latest_price_info.get("last_checked_at")
    lowest_price = latest_price_info.get("lowest_price")
    lowest_price_at = latest_price_info.get("lowest_price_at")
    highest_price = latest_price_info.get("highest_price")
    highest_price_at = latest_price_info.get("highest_price_at")

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
            "last_checked_at": last_checked_at,
            "lowest_price": lowest_price,
            "lowest_price_at": lowest_price_at,
            "highest_price": highest_price,
            "highest_price_at": highest_price_at,
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

    latest_prices = await _get_latest_price_changes(db, product_ids)

    out = []
    for product in products:
        latest_price_info = latest_prices.get(product.id, {})
        latest_price = latest_price_info.get("latest_price")
        previous_price = latest_price_info.get("previous_price")
        last_change_at = latest_price_info.get("last_change_at")
        last_change_percent = latest_price_info.get("last_change_percent")
        last_checked_at = latest_price_info.get("last_checked_at")
        lowest_price = latest_price_info.get("lowest_price")
        lowest_price_at = latest_price_info.get("lowest_price_at")
        highest_price = latest_price_info.get("highest_price")
        highest_price_at = latest_price_info.get("highest_price_at")

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
                "last_checked_at": last_checked_at,
                "lowest_price": lowest_price,
                "lowest_price_at": lowest_price_at,
                "highest_price": highest_price,
                "highest_price_at": highest_price_at,
                "next_run_at": next_run_at,
            }
        ))
    return out


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    payload = body.model_dump()
    payload["tags"] = _tags_to_string(payload.get("tags"))
    product = Product(**payload, user_id=user.id)
    db.add(product)
    await db.flush()
    await db.refresh(product)
    await db.commit()

    from app.images import schedule_image_download
    if product.image_url:
        schedule_image_download(background_tasks, product.id, product.image_url)

    if product.active and product.check_interval_minutes > 0:
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
    background_tasks: BackgroundTasks,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await _get_product(product_id, user, db)
    old_interval = product.check_interval_minutes
    old_active = product.active
    old_image_url = product.image_url
    old_check_time_hhmm = getattr(product, "check_time_hhmm", None)

    updates = body.model_dump(exclude_unset=True)
    if "tags" in updates:
        updates["tags"] = _tags_to_string(updates["tags"])

    image_changed = "image_url" in updates and updates.get("image_url") != old_image_url
    if image_changed:
        from app.images import delete_local_image

        delete_local_image(product.cached_image_url)
        product.cached_image_url = None

    for key, value in updates.items():
        setattr(product, key, value)

    await db.flush()
    await db.refresh(product)
    await db.commit()

    if image_changed:
        from app.images import schedule_image_download
        if product.image_url:
            schedule_image_download(background_tasks, product.id, product.image_url)

    # Reschedule if interval or active state changed
    interval_changed = "check_interval_minutes" in updates and product.check_interval_minutes != old_interval
    active_changed = "active" in updates and product.active != old_active
    time_changed = "check_time_hhmm" in updates and getattr(product, "check_time_hhmm", None) != old_check_time_hhmm

    if product.active and product.check_interval_minutes > 0 and (interval_changed or active_changed or time_changed):
        add_product_job(product)
    elif (not product.active or product.check_interval_minutes <= 0) and (interval_changed or active_changed or time_changed):
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
    from app.images import delete_local_image
    delete_local_image(product.cached_image_url)
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
    ).order_by(PriceHistory.scraped_at.desc()).limit(1)
    lowest_res = await db.execute(lowest_stmt)
    lowest = lowest_res.scalar_one()

    # Highest price at
    highest_stmt = select(PriceHistory).where(
        PriceHistory.product_id == product_id,
        PriceHistory.price == highest_val
    ).order_by(PriceHistory.scraped_at.desc()).limit(1)
    highest_res = await db.execute(highest_stmt)
    highest = highest_res.scalar_one()

    # First and Last two points
    first_stmt = select(PriceHistory).where(PriceHistory.product_id == product_id).order_by(PriceHistory.scraped_at.asc()).limit(1)
    first_res = await db.execute(first_stmt)
    first = first_res.scalar_one()

    # Get latest price and change percent
    latest_prices = await _get_latest_price_changes(db, [product_id])
    latest_price_info = latest_prices.get(product_id, {})
    current_price = latest_price_info.get("latest_price", Decimal(0))
    last_change_at = latest_price_info.get("last_change_at")
    last_change_percent = latest_price_info.get("last_change_percent")

    total_change_percent = None
    if first.price != Decimal(0):
        total_change_percent = (((current_price - first.price) / first.price) * Decimal(100)).quantize(
            Decimal("0.01")
        )

    return ProductStatisticsOut(
        average_price=average_price,
        lowest_price=lowest.price,
        lowest_price_at=lowest.scraped_at,
        highest_price=highest.price,
        highest_price_at=highest.scraped_at,
        current_price=current_price,
        total_change_percent=total_change_percent,
        last_change_percent=last_change_percent,
        last_change_at=last_change_at,
        data_points=data_points,
    )
