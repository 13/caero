"""add_selector_defaults

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


# Built-in defaults seeded for fresh installs. Amazon uses the buy-box-scoped
# selector so that an unavailable product (no buy box) yields no price instead
# of picking up an unrelated price from elsewhere on the page.
_SEED = [
    ("amazon.", "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen"),
    ("reichelt.", ".productPrice"),
    ("zalando.", '[data-testid="pdp-price-container"] span'),
]


def upgrade() -> None:
    selector_defaults = op.create_table(
        'selector_defaults',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('domain', sa.String(length=256), nullable=False),
        sa.Column('selector', sa.String(length=512), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('domain'),
    )
    op.create_index('ix_selector_defaults_domain', 'selector_defaults', ['domain'], unique=True)

    op.bulk_insert(
        selector_defaults,
        [{"domain": domain, "selector": selector} for domain, selector in _SEED],
    )


def downgrade() -> None:
    op.drop_index('ix_selector_defaults_domain', table_name='selector_defaults')
    op.drop_table('selector_defaults')
