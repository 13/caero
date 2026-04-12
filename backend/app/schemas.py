from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


# ── Users ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: int
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str


# ── Products ─────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    url: str = Field(min_length=1)
    selector: str = Field(min_length=1, max_length=256)
    check_interval_minutes: int = Field(default=30, ge=1)
    active: bool = True


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    url: str | None = None
    selector: str | None = Field(default=None, min_length=1, max_length=256)
    check_interval_minutes: int | None = Field(default=None, ge=1)
    active: bool | None = None


class ProductOut(BaseModel):
    id: int
    user_id: int
    name: str
    url: str
    selector: str
    check_interval_minutes: int
    active: bool
    created_at: datetime
    latest_price: Decimal | None = None

    model_config = {"from_attributes": True}


# ── Prices ────────────────────────────────────────────────────────────────────

class PriceHistoryOut(BaseModel):
    id: int
    product_id: int
    price: Decimal
    currency: str
    scraped_at: datetime

    model_config = {"from_attributes": True}


# ── Alerts ────────────────────────────────────────────────────────────────────

AlertCondition = Literal["below", "changed", "any_change"]


class AlertCreate(BaseModel):
    condition: AlertCondition
    threshold_price: Decimal | None = None
    email: str
    active: bool = True


class AlertOut(BaseModel):
    id: int
    product_id: int
    condition: str
    threshold_price: Decimal | None
    email: str
    active: bool

    model_config = {"from_attributes": True}


# ── App Settings ──────────────────────────────────────────────────────────────

class AppSettingsIn(BaseModel):
    db_type: Literal["sqlite", "postgresql"] = "sqlite"
    sqlite_path: str = "/data/caero.db"
    pg_host: str = ""
    pg_port: int = 5432
    pg_database: str = ""
    pg_user: str = ""
    pg_password: str = ""


class AppSettingsOut(BaseModel):
    db_type: str
    sqlite_path: str
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class TestDbRequest(BaseModel):
    db_type: Literal["sqlite", "postgresql"]
    sqlite_path: str = "/data/caero.db"
    pg_host: str = ""
    pg_port: int = 5432
    pg_database: str = ""
    pg_user: str = ""
    pg_password: str = ""


class TestDbResponse(BaseModel):
    status: Literal["connected", "error"]
    message: str


class CheckResult(BaseModel):
    product_id: int
    price: Decimal | None
    error: str | None = None
