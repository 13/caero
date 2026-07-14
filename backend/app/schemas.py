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
    starred_product_ids: list[int] = []
    created_at: datetime

    @field_validator("starred_product_ids", mode="before")
    @classmethod
    def parse_starred_ids(cls, value: Any) -> list[int]:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [int(i) for i in value.split(",") if i.strip().isdigit()]
        return list(value)

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
    check_interval_minutes: int = Field(default=1440, ge=0)
    check_time_hhmm: str | None = None
    record_all_prices: bool = False
    price_format: Literal["auto", "eu", "us"] = "auto"
    inverse_price: bool = False
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
    check_interval_minutes: int | None = Field(default=None, ge=0)
    check_time_hhmm: str | None = None
    record_all_prices: bool | None = None
    price_format: Literal["auto", "eu", "us"] | None = None
    inverse_price: bool | None = None
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
    cached_image_url: str | None = None
    url: str
    selector: str
    check_interval_minutes: int
    check_time_hhmm: str = "10:00"
    record_all_prices: bool = False
    price_format: str = "auto"
    inverse_price: bool = False
    consecutive_scrape_failures: int = 0
    url_redirected: bool = False
    active: bool
    created_at: datetime
    currency: str = "EUR"
    latest_price: Decimal | None = None
    previous_price: Decimal | None = None
    last_price_change_percent: Decimal | None = None
    last_price_change_at: datetime | None = None
    next_run_at: datetime | None = None
    last_checked_at: datetime | None = None
    lowest_price: Decimal | None = None
    lowest_price_at: datetime | None = None
    highest_price: Decimal | None = None
    highest_price_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Prices ────────────────────────────────────────────────────────────────────

class PriceHistoryCreate(BaseModel):
    price: Decimal = Field(gt=0)
    scraped_at: datetime
    currency: str | None = Field(default=None, max_length=8)


class PriceHistoryUpdate(BaseModel):
    price: Decimal = Field(gt=0)


class SparklinePoint(BaseModel):
    t: datetime
    p: Decimal


class PriceHistoryOut(BaseModel):
    id: int
    product_id: int
    price: Decimal
    currency: str
    scraped_at: datetime

    model_config = {"from_attributes": True}


# ── Alerts ────────────────────────────────────────────────────────────────────

AlertCondition = Literal["below", "changed", "any_change", "lowered", "lowered_percent"]


class AlertCreate(BaseModel):
    condition: AlertCondition
    threshold_price: Decimal | None = None
    threshold_percent: Decimal | None = Field(default=None, gt=0, le=100)
    email: str | None = None
    telegram_chat_id: str | None = None
    active: bool = True

    @model_validator(mode="after")
    def validate_recipient(self) -> "AlertCreate":
        if not (self.email and self.email.strip()) and not (
            self.telegram_chat_id and self.telegram_chat_id.strip()
        ):
            raise ValueError("at least one recipient is required: email or telegram_chat_id")
        if self.condition == "lowered_percent" and self.threshold_percent is None:
            raise ValueError("threshold_percent required for 'lowered_percent' condition")
        return self


class AlertOut(BaseModel):
    id: int
    product_id: int
    condition: str
    threshold_price: Decimal | None
    threshold_percent: Decimal | None = None
    email: str | None
    telegram_chat_id: str | None
    active: bool
    last_checked_at: datetime | None = None
    last_triggered_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── App Settings ──────────────────────────────────────────────────────────────

DateFormat = Literal["DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]
TimeFormat = Literal["12h", "24h"]


class AppSettingsIn(BaseModel):
    allow_registration: bool = True
    date_format: DateFormat = "DD.MM.YYYY"
    time_format: TimeFormat = "24h"
    # None = keep the stored token, "" = clear it. The token is never echoed
    # back by the API, so the client can't round-trip it.
    telegram_bot_token: str | None = None


class AppSettingsOut(BaseModel):
    allow_registration: bool
    date_format: str
    time_format: str
    telegram_bot_token_set: bool = False
    updated_at: datetime | None = None


class UiSettingsOut(BaseModel):
    date_format: str
    time_format: str
    show_sparklines: bool = True


class UiSettingsIn(BaseModel):
    date_format: DateFormat
    time_format: TimeFormat
    # None = keep current value (older clients don't send it)
    show_sparklines: bool | None = None


class SelectorDefaultIn(BaseModel):
    domain: str = Field(min_length=1, max_length=256)
    selector: str = Field(min_length=1, max_length=512)

    @field_validator("domain")
    @classmethod
    def normalize_domain(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("selector")
    @classmethod
    def strip_selector(cls, value: str) -> str:
        return value.strip()


class SelectorDefaultOut(BaseModel):
    id: int
    domain: str
    selector: str

    model_config = {"from_attributes": True}


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
    current_password: str = Field(min_length=5)
    new_password: str = Field(min_length=5)


class NotificationDefaultsUpdate(BaseModel):
    default_email: str | None = None
    default_telegram_chat_id: str | None = None


class StarredProductsUpdate(BaseModel):
    starred_product_ids: list[int] = Field(default_factory=list)


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=5)
    is_admin: bool = False


class AdminUserPasswordUpdate(BaseModel):
    new_password: str = Field(min_length=5)


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
    scraper_backend: str = "unknown"
    scraper_headless: bool = True

class JobOut(BaseModel):
    id: str
    next_run_time: datetime | None

    model_config = {"from_attributes": True}
