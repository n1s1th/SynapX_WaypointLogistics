"""Recorded fuel balances and validated stop order for allocation planning.

Revision ID: 0018_allocation_planning_inputs
Revises: 0017_user_notifications
"""

from alembic import op
import sqlalchemy as sa

revision = "0018_allocation_planning_inputs"
down_revision = "0017_user_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("allocations", sa.Column("planned_stop_codes", sa.JSON(), nullable=True))
    op.create_table(
        "vehicle_fuel_weeks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("liters_used", sa.Float(), nullable=False),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("vehicle_id", "week_start", name="uq_vehicle_fuel_week"),
        sa.CheckConstraint("liters_used >= 0", name="ck_vehicle_fuel_week_nonnegative"),
    )
    op.create_index("ix_vehicle_fuel_weeks_week_start", "vehicle_fuel_weeks", ["week_start"])


def downgrade() -> None:
    op.drop_index("ix_vehicle_fuel_weeks_week_start", table_name="vehicle_fuel_weeks")
    op.drop_table("vehicle_fuel_weeks")
    with op.batch_alter_table("allocations") as batch:
        batch.drop_column("planned_stop_codes")
