"""Add products.record_all_prices, alerts.last_triggered_at, users.token_version.

- record_all_prices: per-product toggle to store every check instead of only
  price changes.
- last_triggered_at: when an alert last fired (spam diagnosis / UI).
- token_version: JWT invalidation counter — bumping it logs out all sessions.

Revision ID: 0016
Revises: 0015
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("record_all_prices", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("alerts", sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
    op.drop_column("alerts", "last_triggered_at")
    op.drop_column("products", "record_all_prices")
