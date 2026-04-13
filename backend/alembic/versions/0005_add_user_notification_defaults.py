"""Add notification defaults to user.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-13 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("default_email", sa.String(256), nullable=True))
        batch_op.add_column(sa.Column("default_telegram_chat_id", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("default_telegram_chat_id")
        batch_op.drop_column("default_email")

