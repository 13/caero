"""backfill_amazon_selector

Migrate products still using the legacy unscoped Amazon selector to the
buy-box-scoped selector, so unavailable products no longer pick up an
unrelated price from elsewhere on the page.

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


_LEGACY = ".a-offscreen, .a-price-whole, .a-price-fraction"
_SCOPED = "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen"


def upgrade() -> None:
    op.execute(
        sa.text("UPDATE products SET selector = :scoped WHERE selector = :legacy").bindparams(
            scoped=_SCOPED, legacy=_LEGACY
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("UPDATE products SET selector = :legacy WHERE selector = :scoped").bindparams(
            legacy=_LEGACY, scoped=_SCOPED
        )
    )
