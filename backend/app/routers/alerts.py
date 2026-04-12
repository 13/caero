"""Alerts router."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Alert, Product, User
from app.routers.auth import require_user
from app.schemas import AlertCreate, AlertOut

router = APIRouter(tags=["alerts"])


@router.get("/products/{product_id}/alerts", response_model=list[AlertOut])
async def list_alerts(
    product_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[AlertOut]:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    result = await db.execute(select(Alert).where(Alert.product_id == product_id))
    return result.scalars().all()


@router.post(
    "/products/{product_id}/alerts",
    response_model=AlertOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_alert(
    product_id: int,
    body: AlertCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> AlertOut:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found")

    if body.condition == "below" and body.threshold_price is None:
        raise HTTPException(
            status_code=422, detail="threshold_price required for 'below' condition"
        )

    alert = Alert(**body.model_dump(), product_id=product_id)
    db.add(alert)
    await db.flush()
    await db.refresh(alert)
    return alert


@router.delete("/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(Alert)
        .join(Product, Alert.product_id == Product.id)
        .where(Alert.id == alert_id, Product.user_id == user.id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(alert)


@router.patch("/alerts/{alert_id}", response_model=AlertOut)
async def update_alert(
    alert_id: int,
    body: AlertCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> AlertOut:
    result = await db.execute(
        select(Alert)
        .join(Product, Alert.product_id == Product.id)
        .where(Alert.id == alert_id, Product.user_id == user.id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if body.condition == "below" and body.threshold_price is None:
        raise HTTPException(
            status_code=422, detail="threshold_price required for 'below' condition"
        )

    for key, value in body.model_dump().items():
        setattr(alert, key, value)

    await db.flush()
    await db.refresh(alert)
    return alert
