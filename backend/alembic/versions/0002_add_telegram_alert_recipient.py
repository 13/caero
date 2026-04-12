"""Add Telegram chat recipient support to alerts.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-12 21:20:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("alerts") as batch_op:
        batch_op.alter_column("email", existing_type=sa.String(length=256), nullable=True)
        batch_op.add_column(sa.Column("telegram_chat_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("alerts") as batch_op:
        batch_op.drop_column("telegram_chat_id")
        batch_op.alter_column("email", existing_type=sa.String(length=256), nullable=False)
