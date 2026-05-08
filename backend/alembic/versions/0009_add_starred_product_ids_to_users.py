"""Add starred_product_ids to users.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("starred_product_ids", sa.Text, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("starred_product_ids")
