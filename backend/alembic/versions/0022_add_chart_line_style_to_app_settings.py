"""Add app_settings.chart_line_style — shape of the price chart line.

One of curved | straight | stepped; existing rows get the new default.

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("chart_line_style", sa.String(16), nullable=False, server_default="curved"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "chart_line_style")
