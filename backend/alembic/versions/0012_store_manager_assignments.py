"""Link store managers to the outlet they run.

Revision ID: 0012_store_manager_assignments
Revises: 0011_store_stock

Until now the admin's "assign manager" only saved the manager's name on outlet_settings. This adds a real
user -> outlet link, and backfills it where that saved name matches exactly one store manager account.
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_store_manager_assignments"
down_revision = "0011_store_stock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "store_manager_assignments",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_store_manager_assignments_outlet_id", "store_manager_assignments", ["outlet_id"])

    # Backfill from the names the admin screen saved. Only exact (case-insensitive) matches to a single
    # store manager account, and only when that account matches one outlet, so nothing is guessed.
    # role is compared as text: on a fresh database the STORE_MANAGER enum value only arrives in 0014.
    op.execute(
        """
        INSERT INTO store_manager_assignments (user_id, outlet_id)
        SELECT u.id, MIN(s.outlet_id)
        FROM outlet_settings s
        JOIN users u ON lower(trim(u.full_name)) = lower(trim(s.store_manager))
        WHERE u.role::text IN ('STORE_MANAGER', 'WAREHOUSE_MANAGER')
          AND (SELECT count(*) FROM users u2 WHERE lower(trim(u2.full_name)) = lower(trim(s.store_manager))) = 1
        GROUP BY u.id
        HAVING count(DISTINCT s.outlet_id) = 1
        """
    )


def downgrade() -> None:
    op.drop_index("ix_store_manager_assignments_outlet_id", table_name="store_manager_assignments")
    op.drop_table("store_manager_assignments")
