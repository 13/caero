"""Products router."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PriceHistory, Product, User
from app.routers.auth import require_user
from app.scheduler import add_product_job, remove_product_job, scrape_and_record
from app.schemas import CheckResult, ProductCreate, ProductOut, ProductUpdate

router = APIRouter(prefix="/products", tags=["products"])


async def _get_product(product_id: int, user: User, db: AsyncSession) -> Product:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


async def _latest_price(product_id: int, db: AsyncSession) -> Decimal | None:
    result = await db.execute(
        select(PriceHistory.price)
        .where(PriceHistory.product_id == product_id)
        .order_by(PriceHistory.scraped_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    return row


@router.get("", response_model=list[ProductOut])
async def list_products(
    user: User = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[ProductOut]:
    result = await db.execute(select(Product).where(Product.user_id == user.id))
    products = result.scalars().all()
    out = []
    for p in products:
        latest = await _latest_price(p.id, db)
        out.append(ProductOut.model_validate({**p.__dict__, "latest_price": latest}))
    return out


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = Product(**body.model_dump(), user_id=user.id)
    db.add(product)
    await db.flush()
    await db.refresh(product)
    if product.active:
        add_product_job(product)
    return ProductOut.model_validate({**product.__dict__, "latest_price": None})


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> ProductOut:
    product = await _get_product(product_id, user, db)
    latest = await _latest_price(product_id, db)
    return ProductOut.model_validate({**product.__dict__, "latest_price": latest})


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

    latest = await _latest_price(product_id, db)
    return ProductOut.model_validate({**product.__dict__, "latest_price": latest})


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
