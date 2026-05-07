"""add_check_time_hhmm_to_products

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-07 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'products',
        sa.Column('check_time_hhmm', sa.String(length=5), nullable=False, server_default='10:00'),
    )
    op.execute(sa.text("UPDATE products SET check_time_hhmm = '10:00' WHERE check_time_hhmm IS NULL"))


def downgrade() -> None:
    op.drop_column('products', 'check_time_hhmm')

