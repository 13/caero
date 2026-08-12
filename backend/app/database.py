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

if settings.db_type == "sqlite":
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        """WAL + a real busy timeout.

        Default journalling makes a writing scrape job block every reader, and
        the driver's short lock timeout raises "database is locked" instead of
        waiting — dropping price rows and failing API calls exactly when the
        scheduler is busiest. WAL lets readers run during writes; the timeout
        turns the remaining contention into a wait rather than an error.
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=10000")
        finally:
            cursor.close()


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
# DB to head. DBs created by pre-1.6 versions (Base.metadata.create_all, no
# alembic_version table) match the schema of revision 0013 — the old startup
# code created tables from the then-current models and backfilled columns — so
# they are stamped at 0013 and then upgraded from there.

_BACKEND_DIR = Path(__file__).parent.parent

# Last revision whose schema equals what the old create_all-based startup
# produced (any install that last ran v1.3–v1.5).
LEGACY_STAMP_REVISION = "0013"

# Column that exists only from revision 0016 onward; used to detect databases
# that v1.6.0/v1.6.1 wrongly stamped to head without applying 0014+.
_SENTINEL_TABLE = "products"
_SENTINEL_COLUMN = "record_all_prices"


def _alembic_config():
    from alembic.config import Config

    config = Config(str(_BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return config


def _run_migrations_sync(recorded_version: str | None, has_tables: bool, has_sentinel: bool) -> None:
    # Alembic's async env.py calls asyncio.run(), so this must run in a thread
    # without a running event loop (see run_migrations below).
    from alembic.script import ScriptDirectory

    from alembic import command

    config = _alembic_config()
    head = ScriptDirectory.from_config(config).get_current_head()

    if has_tables and recorded_version is None:
        logger.info(
            "Pre-Alembic schema detected — stamping to %s, then upgrading", LEGACY_STAMP_REVISION
        )
        command.stamp(config, LEGACY_STAMP_REVISION)
    elif has_tables and recorded_version == head and not has_sentinel:
        # v1.6.0/v1.6.1 stamped legacy DBs straight to head without applying
        # 0014+; the version row lies about the actual schema. Re-stamp to the
        # legacy revision so the missing migrations run.
        logger.warning(
            "alembic_version claims %s but %s.%s is missing — repairing a mis-stamped "
            "upgrade by re-stamping to %s",
            head, _SENTINEL_TABLE, _SENTINEL_COLUMN, LEGACY_STAMP_REVISION,
        )
        command.stamp(config, LEGACY_STAMP_REVISION, purge=True)

    command.upgrade(config, "head")


def _inspect_schema_state(connection) -> tuple[str | None, bool, bool]:
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())

    recorded_version = None
    if "alembic_version" in tables:
        recorded_version = connection.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalar()

    has_sentinel = False
    if _SENTINEL_TABLE in tables:
        has_sentinel = _SENTINEL_COLUMN in {
            col["name"] for col in inspector.get_columns(_SENTINEL_TABLE)
        }

    return recorded_version, "users" in tables, has_sentinel


async def run_migrations() -> None:
    """Bring the database schema to the latest Alembic revision and seed defaults."""
    async with engine.connect() as conn:
        recorded_version, has_tables, has_sentinel = await conn.run_sync(_inspect_schema_state)

    await asyncio.to_thread(_run_migrations_sync, recorded_version, has_tables, has_sentinel)

    # Alembic's fileConfig resets the root logger to WARN (alembic.ini); restore
    # the configured level so the app's INFO logs don't vanish after migrations.
    logging.getLogger().setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

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
