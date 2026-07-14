"""Add products.inverse_price — invert the price-change color semantics.

Default False keeps the classic behavior (a price drop shows green). True is
for products where rising prices are good news (resale value, collectibles).

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("inverse_price", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("products", "inverse_price")
