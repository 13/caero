"""add_cached_image_url_to_products

Revision ID: 0006
Revises: 4dfbb7c1d575
Create Date: 2026-05-04 17:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '4dfbb7c1d575'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('products', sa.Column('cached_image_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('products', 'cached_image_url')
