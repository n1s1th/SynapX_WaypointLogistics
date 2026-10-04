"""Store the designated dispatcher for each depot.

Revision ID: 0010_depot_assignments
Revises: 0009_order_depot_scope
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010_depot_assignments"
down_revision = "0009_order_depot_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The shared ``depot`` enum is created by the outlet migrations. Reuse it
    # rather than attempting to create it again with this table.
    depot_enum = postgresql.ENUM("PELIYAGODA", "KANDY", name="depot", create_type=False)
    op.create_table(
        "depot_dispatcher_assignments",
        sa.Column("depot", depot_enum, primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("assigned_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_depot_dispatcher_assignments_user_id", "depot_dispatcher_assignments", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_depot_dispatcher_assignments_user_id", table_name="depot_dispatcher_assignments")
    op.drop_table("depot_dispatcher_assignments")
