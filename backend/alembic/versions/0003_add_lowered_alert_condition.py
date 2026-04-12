"""Add lowered alert condition.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-12 21:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

OLD_CONDITION_ENUM = sa.Enum("below", "changed", "any_change", name="alert_condition")
NEW_CONDITION_ENUM = sa.Enum("below", "changed", "any_change", "lowered", name="alert_condition")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE alert_condition ADD VALUE IF NOT EXISTS 'lowered'")
        return

    with op.batch_alter_table("alerts", recreate="always") as batch_op:
        batch_op.alter_column(
            "condition",
            existing_type=OLD_CONDITION_ENUM,
            type_=NEW_CONDITION_ENUM,
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("UPDATE alerts SET condition = 'changed' WHERE condition = 'lowered'")
        op.execute("ALTER TYPE alert_condition RENAME TO alert_condition_old")
        op.execute("CREATE TYPE alert_condition AS ENUM ('below', 'changed', 'any_change')")
        op.execute(
            "ALTER TABLE alerts ALTER COLUMN condition TYPE alert_condition USING condition::text::alert_condition"
        )
        op.execute("DROP TYPE alert_condition_old")
        return

    with op.batch_alter_table("alerts", recreate="always") as batch_op:
        batch_op.alter_column(
            "condition",
            existing_type=NEW_CONDITION_ENUM,
            type_=OLD_CONDITION_ENUM,
            existing_nullable=False,
        )
