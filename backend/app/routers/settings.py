"""Settings router."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSettings
from app.routers.auth import require_user
from app.schemas import AppSettingsIn, AppSettingsOut, TestDbRequest, TestDbResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = AppSettings(id=1)
        db.add(settings_row)
        await db.flush()
    return settings_row


@router.get("", response_model=AppSettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    return AppSettingsOut.model_validate(row)


@router.post("", response_model=AppSettingsOut)
async def save_settings(
    body: AppSettingsIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user),
) -> AppSettingsOut:
    row = await _get_or_create_settings(db)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(row)
    return AppSettingsOut.model_validate(row)


@router.post("/test-db", response_model=TestDbResponse)
async def test_db_connection(
    body: TestDbRequest,
    _user=Depends(require_user),
) -> TestDbResponse:
    if body.db_type == "sqlite":
        try:
            import aiosqlite

            async with aiosqlite.connect(body.sqlite_path) as conn:
                await conn.execute("SELECT 1")
            return TestDbResponse(status="connected", message="SQLite connection successful")
        except Exception as exc:
            return TestDbResponse(status="error", message=str(exc))

    elif body.db_type == "postgresql":
        try:
            import asyncpg

            conn = await asyncpg.connect(
                host=body.pg_host,
                port=body.pg_port,
                database=body.pg_database,
                user=body.pg_user,
                password=body.pg_password,
                timeout=5,
            )
            await conn.fetchval("SELECT 1")
            await conn.close()
            return TestDbResponse(status="connected", message="PostgreSQL connection successful")
        except Exception as exc:
            return TestDbResponse(status="error", message=str(exc))

    raise HTTPException(status_code=422, detail="Unknown db_type")
