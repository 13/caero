from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    default_telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    starred_product_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Incremented on logout; JWTs carry the value at issue time, so a bump
    # invalidates every outstanding token for this user.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    products: Mapped[list["Product"]] = relationship("Product", back_populates="user")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str] = mapped_column(Text, default="", nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Local cached image (stored as /user_images/...) — keep original image_url as the source of truth
    cached_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    selector: Mapped[str] = mapped_column(String(256), nullable=False)
    check_interval_minutes: Mapped[int] = mapped_column(Integer, default=30)
    check_time_hhmm: Mapped[str] = mapped_column(String(5), server_default="10:00", default="10:00", nullable=False)
    # False (default): store a price row only when the price changed.
    # True: store a row on every successful check.
    record_all_prices: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # Number-format hint for parsing scraped prices: 'auto' | 'eu' | 'us'.
    price_format: Mapped[str] = mapped_column(String(8), default="auto", server_default="auto", nullable=False)
    consecutive_scrape_failures: Mapped[int] = mapped_column(Integer, default=0)
    url_redirected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="products")
    price_history: Mapped[list["PriceHistory"]] = relationship(
        "PriceHistory", back_populates="product", cascade="all, delete-orphan"
    )
    alerts: Mapped[list["Alert"]] = relationship(
        "Alert", back_populates="product", cascade="all, delete-orphan"
    )


class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = (
        Index("ix_price_history_product_id_scraped_at", "product_id", "scraped_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    product: Mapped["Product"] = relationship("Product", back_populates="price_history")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    condition: Mapped[str] = mapped_column(
        Enum("below", "changed", "any_change", "lowered", "lowered_percent", name="alert_condition"),
        nullable=False,
    )
    threshold_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # For "lowered_percent": fire when the price drops by at least this percent.
    threshold_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    product: Mapped["Product"] = relationship("Product", back_populates="alerts")


class SelectorDefault(Base):
    """Default CSS price selector applied to products from a given site.

    `domain` is matched as a substring of a product URL's hostname, so e.g.
    "amazon." matches amazon.it, amazon.de, etc. When several entries match,
    the longest (most specific) `domain` wins.
    """

    __tablename__ = "selector_defaults"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    domain: Mapped[str] = mapped_column(String(256), unique=True, nullable=False, index=True)
    selector: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AppSettings(Base):
    """Global app settings row (id=1). DB connection config lives in .env only."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    allow_registration: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_sparklines: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    date_format: Mapped[str] = mapped_column(String(32), default="DD.MM.YYYY", nullable=False)
    time_format: Mapped[str] = mapped_column(String(8), default="24h", nullable=False)
    telegram_bot_token: Mapped[str] = mapped_column(String(256), default="", nullable=False, server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
