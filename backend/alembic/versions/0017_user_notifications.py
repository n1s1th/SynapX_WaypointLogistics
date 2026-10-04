"""Private in-app inbox for every authenticated user role.

Revision ID: 0017_user_notifications
Revises: 0016_sos_photo
"""

from alembic import op
import sqlalchemy as sa

revision = "0017_user_notifications"
down_revision = "0016_sos_photo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("recipient_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_key", sa.String(200), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("target_url", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("recipient_user_id", "event_key", name="uq_user_notifications_recipient_event"),
    )
    op.create_index("ix_user_notifications_recipient_created", "user_notifications", ["recipient_user_id", "created_at"])
    op.create_index("ix_user_notifications_recipient_read", "user_notifications", ["recipient_user_id", "read_at"])


def downgrade() -> None:
    op.drop_index("ix_user_notifications_recipient_read", table_name="user_notifications")
    op.drop_index("ix_user_notifications_recipient_created", table_name="user_notifications")
    op.drop_table("user_notifications")
