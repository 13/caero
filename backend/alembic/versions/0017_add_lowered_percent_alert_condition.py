"""Add lowered_percent alert condition and alerts.threshold_percent.

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

OLD_CONDITION_ENUM = sa.Enum("below", "changed", "any_change", "lowered", name="alert_condition")
NEW_CONDITION_ENUM = sa.Enum(
    "below", "changed", "any_change", "lowered", "lowered_percent", name="alert_condition"
)


def upgrade() -> None:
    op.add_column("alerts", sa.Column("threshold_percent", sa.Numeric(5, 2), nullable=True))

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE alert_condition ADD VALUE IF NOT EXISTS 'lowered_percent'")
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
        op.execute("UPDATE alerts SET condition = 'lowered' WHERE condition = 'lowered_percent'")
        op.execute("ALTER TYPE alert_condition RENAME TO alert_condition_old")
        op.execute("CREATE TYPE alert_condition AS ENUM ('below', 'changed', 'any_change', 'lowered')")
        op.execute(
            "ALTER TABLE alerts ALTER COLUMN condition TYPE alert_condition USING condition::text::alert_condition"
        )
        op.execute("DROP TYPE alert_condition_old")
    else:
        with op.batch_alter_table("alerts", recreate="always") as batch_op:
            batch_op.alter_column(
                "condition",
                existing_type=NEW_CONDITION_ENUM,
                type_=OLD_CONDITION_ENUM,
                existing_nullable=False,
            )

    op.drop_column("alerts", "threshold_percent")
