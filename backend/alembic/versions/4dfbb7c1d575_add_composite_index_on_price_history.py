"""add_composite_index_on_price_history

Revision ID: 4dfbb7c1d575
Revises: 0005
Create Date: 2026-04-13 16:40:57.516179
"""
from alembic import op
import sqlalchemy as sa


revision = '4dfbb7c1d575'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        'ix_price_history_product_id_scraped_at',
        'price_history',
        ['product_id', 'scraped_at'],
        unique=False
    )
    op.create_index('ix_price_history_product_id', 'price_history', ['product_id'], unique=False)
    op.create_index('ix_price_history_scraped_at', 'price_history', ['scraped_at'], unique=False)
    op.create_index('ix_products_user_id', 'products', ['user_id'], unique=False)
    op.create_index('ix_alerts_product_id', 'alerts', ['product_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_alerts_product_id', table_name='alerts')
    op.drop_index('ix_products_user_id', table_name='products')
    op.drop_index('ix_price_history_scraped_at', table_name='price_history')
    op.drop_index('ix_price_history_product_id', table_name='price_history')
    op.drop_index('ix_price_history_product_id_scraped_at', table_name='price_history')
