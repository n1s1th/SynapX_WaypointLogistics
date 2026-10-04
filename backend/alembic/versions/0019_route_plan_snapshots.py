"""Persist confirmed and published route calculations.

Revision ID: 0019_route_plan_snapshots
Revises: 0018_allocation_planning_inputs
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_route_plan_snapshots"
down_revision = "0018_allocation_planning_inputs"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("allocations", sa.Column("route_plan", sa.JSON(), nullable=True))
    op.add_column("dispatch_trips", sa.Column("route_plan", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("dispatch_trips", "route_plan")
    op.drop_column("allocations", "route_plan")
