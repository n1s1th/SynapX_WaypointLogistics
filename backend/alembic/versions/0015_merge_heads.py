"""Merge the store-manager and email-outbox migration branches.

Revision ID: 0015_merge_heads
Revises: 0014_schema_catchup, 0012_outlet_manager_user

Both 0011_store_stock and 0011_email_outbox were added on top of 0010_depot_assignments, so dev had two
heads. This joins them.

It also fills outlet_settings.store_manager_user_id (added by 0012_outlet_manager_user, used for emails)
from store_manager_assignments (used for login scoping), so managers assigned before that column existed
are linked in both places. Only outlets with exactly one assigned manager are filled; nothing is guessed.
"""

from alembic import op


revision = "0015_merge_heads"
down_revision = ("0014_schema_catchup", "0012_outlet_manager_user")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE outlet_settings s
        SET store_manager_user_id = a.user_id
        FROM (
            SELECT outlet_id, MIN(user_id) AS user_id
            FROM store_manager_assignments
            GROUP BY outlet_id
            HAVING COUNT(*) = 1
        ) a
        WHERE s.outlet_id = a.outlet_id AND s.store_manager_user_id IS NULL
        """
    )


def downgrade() -> None:
    pass
