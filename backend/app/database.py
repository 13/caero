import logging

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.schema import CreateColumn

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    # SQLite-specific: check_same_thread not applicable for async
    connect_args={"check_same_thread": False} if settings.db_type == "sqlite" else {},
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
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def create_tables() -> None:
    """Create tables and backfill missing legacy columns when possible."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns_for_existing_tables)


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
