"""Prices router."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PriceHistory, Product, User
from app.routers.auth import require_user
from app.schemas import PriceHistoryCreate, PriceHistoryOut, PriceHistoryUpdate

router = APIRouter(tags=["prices"])


async def _get_owned_price(
    product_id: int, price_id: int, user: User, db: AsyncSession
) -> PriceHistory:
    """Fetch a price row, ensuring it belongs to a product owned by the user."""
    result = await db.execute(
        select(PriceHistory)
        .join(Product, Product.id == PriceHistory.product_id)
        .where(
            PriceHistory.id == price_id,
            PriceHistory.product_id == product_id,
            Product.user_id == user.id,
        )
    )
    price = result.scalar_one_or_none()
    if price is None:
        raise HTTPException(status_code=404, detail="Price entry not found")
    return price


@router.get("/products/{product_id}/prices", response_model=list[PriceHistoryOut])
async def get_prices(
    product_id: int,
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[PriceHistoryOut]:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    query = select(PriceHistory).where(PriceHistory.product_id == product_id)
    if from_dt:
        query = query.where(PriceHistory.scraped_at >= from_dt)
    if to_dt:
        query = query.where(PriceHistory.scraped_at <= to_dt)
    query = query.order_by(PriceHistory.scraped_at.asc())

    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/products/{product_id}/prices",
    response_model=PriceHistoryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_price(
    product_id: int,
    body: PriceHistoryCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> PriceHistoryOut:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    currency = body.currency
    if not currency:
        # Inherit the currency of the most recent existing entry, defaulting to EUR.
        latest = await db.execute(
            select(PriceHistory.currency)
            .where(PriceHistory.product_id == product_id)
            .order_by(PriceHistory.scraped_at.desc())
            .limit(1)
        )
        currency = latest.scalar_one_or_none() or "EUR"

    price = PriceHistory(
        product_id=product_id,
        price=Decimal(body.price).quantize(Decimal("0.01")),
        currency=currency,
        scraped_at=body.scraped_at,
    )
    db.add(price)
    await db.flush()
    await db.refresh(price)
    return price


@router.get("/products/{product_id}/prices/latest", response_model=PriceHistoryOut | None)
async def get_latest_price(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> PriceHistoryOut | None:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    result = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.product_id == product_id)
        .order_by(PriceHistory.scraped_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.patch("/products/{product_id}/prices/{price_id}", response_model=PriceHistoryOut)
async def update_price(
    product_id: int,
    price_id: int,
    body: PriceHistoryUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> PriceHistoryOut:
    price = await _get_owned_price(product_id, price_id, user, db)
    price.price = Decimal(body.price).quantize(Decimal("0.01"))
    await db.flush()
    await db.refresh(price)
    return price


@router.delete(
    "/products/{product_id}/prices/{price_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_price(
    product_id: int,
    price_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    price = await _get_owned_price(product_id, price_id, user, db)
    await db.delete(price)
