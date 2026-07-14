"""Add products.price_format — per-product number-format hint for parsing.

'auto' keeps the heuristic; 'eu' forces comma-decimal (1.234,56);
'us' forces dot-decimal (1,234.56). Resolves ambiguous strings like "1,234".

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("price_format", sa.String(8), nullable=False, server_default="auto"),
    )


def downgrade() -> None:
    op.drop_column("products", "price_format")
