"""Add tracking columns that previously only existed via create_all.

products.consecutive_scrape_failures, products.last_checked_at and
alerts.last_checked_at were added to the models without migrations; the old
startup backfill created them ad hoc. Guarded with an inspector check so DBs
that already have them (from that backfill) pass through cleanly.

Revision ID: 0015
Revises: 0014
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def _existing_columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    product_cols = _existing_columns("products")
    if "consecutive_scrape_failures" not in product_cols:
        op.add_column(
            "products",
            sa.Column("consecutive_scrape_failures", sa.Integer(), nullable=True, server_default="0"),
        )
    if "last_checked_at" not in product_cols:
        op.add_column("products", sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True))

    alert_cols = _existing_columns("alerts")
    if "last_checked_at" not in alert_cols:
        op.add_column("alerts", sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("alerts", "last_checked_at")
    op.drop_column("products", "last_checked_at")
    op.drop_column("products", "consecutive_scrape_failures")
