"""Add app_settings nightly maintenance settings.

On/off toggles and run times for the backup and retention jobs; existing rows
keep today's schedule (both enabled, backup 03:30, retention 04:00). Plus
nullable overrides of BACKUP_KEEP / PRICE_HISTORY_THIN_AFTER_DAYS /
EVENT_LOG_RETENTION_DAYS — NULL keeps using the env var.

Revision ID: 0025
Revises: 0024
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

OVERRIDES = ("backup_keep", "price_history_thin_after_days", "event_log_retention_days")


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("backup_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("app_settings", sa.Column("backup_time", sa.String(5), nullable=False, server_default="03:30"))
    op.add_column(
        "app_settings", sa.Column("retention_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
    )
    op.add_column("app_settings", sa.Column("retention_time", sa.String(5), nullable=False, server_default="04:00"))
    for column in OVERRIDES:
        op.add_column("app_settings", sa.Column(column, sa.Integer(), nullable=True))


def downgrade() -> None:
    for column in (*OVERRIDES, "retention_time", "retention_enabled", "backup_time", "backup_enabled"):
        op.drop_column("app_settings", column)
