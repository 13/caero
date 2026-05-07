"""add_time_format_to_app_settings

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-07 10:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'app_settings',
        sa.Column('time_format', sa.String(length=8), nullable=False, server_default='24h'),
    )


def downgrade() -> None:
    op.drop_column('app_settings', 'time_format')

