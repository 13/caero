"""Add event_log — operational events for the admin Logs tab.

Revision ID: 0023
Revises: 0022
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_name", sa.String(256), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
    )
    op.create_index("ix_event_log_created_at", "event_log", ["created_at"])
    op.create_index("ix_event_log_product_created", "event_log", ["product_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_event_log_product_created", table_name="event_log")
    op.drop_index("ix_event_log_created_at", table_name="event_log")
    op.drop_table("event_log")
