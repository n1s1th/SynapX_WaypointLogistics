"""Drivers' "I'm ready for tomorrow".

Revision ID: 0013_driver_availability
Revises: 0012_store_manager_assignments

Before the 4 PM cutoff a driver confirms they can take a run on the next working day, so the dispatcher can
plan around who is available. One row per driver per day; confirming again changes nothing.
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_driver_availability"
down_revision = "0012_store_manager_assignments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "driver_availability",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("driver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("for_date", sa.Date(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("driver_id", "for_date", name="uq_driver_availability_driver_day"),
    )
    op.create_index("ix_driver_availability_driver_id", "driver_availability", ["driver_id"])
    op.create_index("ix_driver_availability_for_date", "driver_availability", ["for_date"])


def downgrade() -> None:
    op.drop_index("ix_driver_availability_for_date", table_name="driver_availability")
    op.drop_index("ix_driver_availability_driver_id", table_name="driver_availability")
    op.drop_table("driver_availability")
