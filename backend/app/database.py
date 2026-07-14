import asyncio
import logging
from pathlib import Path

from sqlalchemy import func, inspect, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

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
    """Request-scoped session.

    Transaction pattern: endpoints mutate and (at most) flush; this dependency
    commits once on success and rolls back on any exception. Endpoints should
    not call session.commit() themselves.
    """
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


# ── Schema management ──────────────────────────────────────────────────────────
# Alembic is the single source of truth for the schema. At startup we bring the
# DB to head. DBs created by pre-0.9 versions (Base.metadata.create_all, no
# alembic_version table) are stamped to head first: their schema already matches
# because the old startup code also backfilled columns.

_BACKEND_DIR = Path(__file__).parent.parent


def _alembic_config():
    from alembic.config import Config

    config = Config(str(_BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return config


def _run_migrations_sync(has_alembic_version: bool, has_tables: bool) -> None:
    # Alembic's async env.py calls asyncio.run(), so this must run in a thread
    # without a running event loop (see run_migrations below).
    from alembic import command

    config = _alembic_config()
    if has_tables and not has_alembic_version:
        logger.info("Existing schema without alembic_version — stamping to head")
        command.stamp(config, "head")
    else:
        command.upgrade(config, "head")


def _inspect_schema_state(connection) -> tuple[bool, bool]:
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    return "alembic_version" in tables, "users" in tables


async def run_migrations() -> None:
    """Bring the database schema to the latest Alembic revision and seed defaults."""
    async with engine.connect() as conn:
        has_alembic_version, has_tables = await conn.run_sync(_inspect_schema_state)

    await asyncio.to_thread(_run_migrations_sync, has_alembic_version, has_tables)

    async with engine.begin() as conn:
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
