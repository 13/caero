"""add_telegram_bot_token_to_app_settings

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'app_settings',
        sa.Column('telegram_bot_token', sa.String(length=256), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('app_settings', 'telegram_bot_token')
