"""Add app_settings.public_url — base URL for "Open in Caero" links.

Empty means "use the PUBLIC_URL env var".

Revision ID: 0021
Revises: 0020
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("public_url", sa.String(512), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "public_url")
