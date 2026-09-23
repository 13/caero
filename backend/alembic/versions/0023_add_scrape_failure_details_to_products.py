"""Add products.last_scrape_error and products.scrape_failing_since.

Why the latest check found no price and when the failure streak began, so
the UI can say more than "N checks failed". Both NULL while checks succeed.

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("last_scrape_error", sa.String(32), nullable=True))
    op.add_column(
        "products",
        sa.Column("scrape_failing_since", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("products", "scrape_failing_since")
    op.drop_column("products", "last_scrape_error")
