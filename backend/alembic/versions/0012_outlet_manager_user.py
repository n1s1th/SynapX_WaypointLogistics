"""Link outlet manager assignments to user accounts.

Revision ID: 0012_outlet_manager_user
Revises: 0011_email_outbox
"""

from alembic import op
import sqlalchemy as sa

revision = "0012_outlet_manager_user"
down_revision = "0011_email_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("outlet_settings", sa.Column("store_manager_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_outlet_settings_store_manager_user_id", "outlet_settings", "users",
        ["store_manager_user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_outlet_settings_store_manager_user_id", "outlet_settings", ["store_manager_user_id"])


def downgrade() -> None:
    op.drop_index("ix_outlet_settings_store_manager_user_id", table_name="outlet_settings")
    op.drop_constraint("fk_outlet_settings_store_manager_user_id", "outlet_settings", type_="foreignkey")
    op.drop_column("outlet_settings", "store_manager_user_id")
