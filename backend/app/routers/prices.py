"""Prices router."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PriceHistory, Product, User
from app.routers.auth import require_user
from app.schemas import PriceHistoryOut

router = APIRouter(tags=["prices"])


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
