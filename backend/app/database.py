import logging

from sqlalchemy import func, inspect, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.schema import CreateColumn

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    # SQLite-specific: check_same_thread not applicable for async
    connect_args={"check_same_thread": False} if settings.db_type == "sqlite" else {
        "command_timeout": 120,
        "server_settings": {
            "idle_in_transaction_session_timeout": "120000",
            "tcp_keepalives_idle": "30",
        }
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            try:
                await session.commit()
            except SQLAlchemyError:
                await session.rollback()
                raise
        except BaseException:
            try:
                await session.rollback()
            except BaseException:
                pass
            raise


async def create_tables() -> None:
    """Create tables and backfill missing legacy columns when possible."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns_for_existing_tables)
        await conn.run_sync(_seed_selector_defaults)
        await conn.run_sync(_backfill_amazon_selectors)


# Built-in per-site default price selectors, seeded only when the table is empty
# (so user edits/deletions are never overwritten on restart).
_AMAZON_SELECTOR = "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen"
_DEFAULT_SELECTORS = [
    ("amazon.", _AMAZON_SELECTOR),
    ("reichelt.", ".productPrice"),
    ("zalando.", '[data-testid="pdp-price-container"] span'),
]

# The unscoped Amazon selector previously auto-filled for new products. It leaks
# prices from unrelated blocks (related items, other sellers) on unavailable
# pages, so migrate any product still using it to the buy-box-scoped selector.
_LEGACY_AMAZON_SELECTOR = ".a-offscreen, .a-price-whole, .a-price-fraction"


def _seed_selector_defaults(connection) -> None:
    from app.models import SelectorDefault

    inspector = inspect(connection)
    if SelectorDefault.__tablename__ not in set(inspector.get_table_names()):
        return

    table = SelectorDefault.__table__
    existing = connection.execute(select(func.count()).select_from(table)).scalar()
    if existing:
        return

    connection.execute(
        table.insert(),
        [{"domain": domain, "selector": selector} for domain, selector in _DEFAULT_SELECTORS],
    )
    logger.info("Seeded %d default selectors", len(_DEFAULT_SELECTORS))


def _backfill_amazon_selectors(connection) -> None:
    """One-shot, idempotent: upgrade products still on the legacy Amazon selector.

    Matches the exact old default string only, so it touches nothing once
    migrated and never overrides a hand-customised selector.
    """
    from app.models import Product

    inspector = inspect(connection)
    if Product.__tablename__ not in set(inspector.get_table_names()):
        return

    table = Product.__table__
    result = connection.execute(
        table.update()
        .where(table.c.selector == _LEGACY_AMAZON_SELECTOR)
        .values(selector=_AMAZON_SELECTOR)
    )
    if result.rowcount:
        logger.info("Migrated %d product(s) to the scoped Amazon selector", result.rowcount)


def _add_missing_columns_for_existing_tables(connection) -> None:
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    preparer = connection.dialect.identifier_preparer

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue

        existing_columns = {col["name"] for col in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in existing_columns:
                continue
            if column.primary_key or column.foreign_keys:
                logger.warning(
                    "Skipping automatic schema backfill for %s.%s (unsafe column type)",
                    table.name,
                    column.name,
                )
                continue

            if not column.nullable and column.server_default is None and column.default is None:
                logger.warning(
                    "Skipping automatic schema backfill for %s.%s (NOT NULL without default)",
                    table.name,
                    column.name,
                )
                continue

            column_sql = str(CreateColumn(column).compile(dialect=connection.dialect))
            table_sql = preparer.quote(table.name)
            try:
                connection.exec_driver_sql(f"ALTER TABLE {table_sql} ADD COLUMN {column_sql}")
                logger.info("Added missing column %s.%s", table.name, column.name)
            except SQLAlchemyError as exc:
                logger.warning(
                    "Could not backfill missing column %s.%s: %s",
                    table.name,
                    column.name,
                    exc,
                )
