"""Drop unused database-config columns from app_settings.

The engine connection has always come from environment variables (.env);
these columns were written by the settings UI but never read at runtime.

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

_DROPPED = ("db_type", "sqlite_path", "pg_host", "pg_port", "pg_database", "pg_user", "pg_password")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {col["name"] for col in inspector.get_columns("app_settings")}

    with op.batch_alter_table("app_settings") as batch_op:
        for name in _DROPPED:
            if name in existing:
                batch_op.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("db_type", sa.String(16), server_default="sqlite"))
        batch_op.add_column(sa.Column("sqlite_path", sa.String(256), server_default="/data/caero.db"))
        batch_op.add_column(sa.Column("pg_host", sa.String(256), server_default=""))
        batch_op.add_column(sa.Column("pg_port", sa.Integer(), server_default="5432"))
        batch_op.add_column(sa.Column("pg_database", sa.String(256), server_default=""))
        batch_op.add_column(sa.Column("pg_user", sa.String(256), server_default=""))
        batch_op.add_column(sa.Column("pg_password", sa.String(256), server_default=""))
