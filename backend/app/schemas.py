from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Users ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=5)


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    default_email: str | None = None
    default_telegram_chat_id: str | None = None
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
    category: str | None = Field(default=None, max_length=128)
    memo: str | None = None
    tags: list[str] = Field(default_factory=list)
    image_url: str | None = None
    url: str = Field(min_length=1)
    selector: str = Field(min_length=1, max_length=256)
    check_interval_minutes: int = Field(default=30, ge=1)
    active: bool = True

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        if isinstance(value, list):
            return [str(tag).strip() for tag in value if str(tag).strip()]
        raise ValueError("tags must be a list or comma-separated string")


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    category: str | None = Field(default=None, max_length=128)
    memo: str | None = None
    tags: list[str] | None = None
    image_url: str | None = None
    url: str | None = None
    selector: str | None = Field(default=None, min_length=1, max_length=256)
    check_interval_minutes: int | None = Field(default=None, ge=1)
    active: bool | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        if isinstance(value, str):
            return [tag.strip() for tag in value.split(",") if tag.strip()]
        if isinstance(value, list):
            return [str(tag).strip() for tag in value if str(tag).strip()]
        raise ValueError("tags must be a list or comma-separated string")


class ProductOut(BaseModel):
    id: int
    user_id: int
    name: str
    category: str | None = None
    memo: str | None = None
    tags: list[str] = Field(default_factory=list)
    image_url: str | None = None
    url: str
    selector: str
    check_interval_minutes: int
    active: bool
    created_at: datetime
    latest_price: Decimal | None = None
    previous_price: Decimal | None = None
    last_price_change_percent: Decimal | None = None
    last_price_change_at: datetime | None = None
    next_run_at: datetime | None = None

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

AlertCondition = Literal["below", "changed", "any_change", "lowered"]


class AlertCreate(BaseModel):
    condition: AlertCondition
    threshold_price: Decimal | None = None
    email: str | None = None
    telegram_chat_id: str | None = None
    active: bool = True

    @model_validator(mode="after")
    def validate_recipient(self) -> "AlertCreate":
        if not (self.email and self.email.strip()) and not (
            self.telegram_chat_id and self.telegram_chat_id.strip()
        ):
            raise ValueError("at least one recipient is required: email or telegram_chat_id")
        return self


class AlertOut(BaseModel):
    id: int
    product_id: int
    condition: str
    threshold_price: Decimal | None
    email: str | None
    telegram_chat_id: str | None
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
    allow_registration: bool = True
    date_format: Literal["DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] = "DD.MM.YYYY"


class AppSettingsOut(BaseModel):
    db_type: str
    sqlite_path: str
    pg_host: str
    pg_port: int
    pg_database: str
    pg_user: str
    pg_password: str
    allow_registration: bool
    date_format: str
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


class TestEmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=256)


class TestTelegramRequest(BaseModel):
    chat_id: str = Field(min_length=1, max_length=64)


class TestNotificationResponse(BaseModel):
    status: Literal["sent", "error"]
    message: str


class CheckResult(BaseModel):
    product_id: int
    price: Decimal | None
    error: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=6)
    new_password: str = Field(min_length=6)


class NotificationDefaultsUpdate(BaseModel):
    default_email: str | None = None
    default_telegram_chat_id: str | None = None


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)
    is_admin: bool = False


class AdminUserPasswordUpdate(BaseModel):
    new_password: str = Field(min_length=6)


class ProductStatisticsOut(BaseModel):
    average_price: Decimal | None = None
    lowest_price: Decimal | None = None
    lowest_price_at: datetime | None = None
    highest_price: Decimal | None = None
    highest_price_at: datetime | None = None
    current_price: Decimal | None = None
    total_change_percent: Decimal | None = None
    last_change_percent: Decimal | None = None
    last_change_at: datetime | None = None
    data_points: int = 0


class DataExportPayload(BaseModel):
    app_settings: dict[str, Any]
    users: list[dict[str, Any]]
    products: list[dict[str, Any]]
    price_history: list[dict[str, Any]]
    alerts: list[dict[str, Any]]


class UserDataExportPayload(BaseModel):
    products: list[dict[str, Any]]
    price_history: list[dict[str, Any]]
    alerts: list[dict[str, Any]]

class SystemInfoOut(BaseModel):
    version: str
    db_type: str
    db_version: str

class JobOut(BaseModel):
    id: str
    next_run_time: datetime | None

    model_config = {"from_attributes": True}
