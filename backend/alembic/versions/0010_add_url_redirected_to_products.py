"""add_url_redirected_to_products

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('products', sa.Column('url_redirected', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('products', 'url_redirected')
