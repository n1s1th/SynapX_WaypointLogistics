"""Add dedicated outlet directory, contacts and receiving windows.

Revision ID: c82d14e09f6a
Revises: 0006_run_dispatch_trip_unique
"""
from alembic import op
import sqlalchemy as sa

revision = "c82d14e09f6a"
down_revision = "0006_run_dispatch_trip_unique"
branch_labels = None
depends_on = None


def upgrade():
    # Loader foundation already owns outlets and its seeded reference fields.
    op.add_column("outlets", sa.Column("address", sa.String(500), nullable=True))
    op.add_column("outlets", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("outlets", sa.Column("delivery_restrictions", sa.Text(), nullable=True))
    op.add_column("outlets", sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.add_column("outlets", sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.create_table(
        "outlet_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("role", sa.String(100)),
        sa.Column("phone", sa.String(40)),
        sa.Column("email", sa.String(255)),
    )
    op.create_index("ix_outlet_contacts_outlet_id", "outlet_contacts", ["outlet_id"])
    op.create_table(
        "outlet_receiving_windows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("opens_at", sa.Time(), nullable=False),
        sa.Column("closes_at", sa.Time(), nullable=False),
        sa.UniqueConstraint("outlet_id", "weekday", "opens_at", "closes_at", name="uq_outlet_window"),
    )
    op.create_index("ix_outlet_receiving_windows_outlet_id", "outlet_receiving_windows", ["outlet_id"])


def downgrade():
    op.drop_index("ix_outlet_receiving_windows_outlet_id", table_name="outlet_receiving_windows")
    op.drop_table("outlet_receiving_windows")
    op.drop_index("ix_outlet_contacts_outlet_id", table_name="outlet_contacts")
    op.drop_table("outlet_contacts")
    op.drop_column("outlets", "updated_at")
    op.drop_column("outlets", "created_at")
    op.drop_column("outlets", "delivery_restrictions")
    op.drop_column("outlets", "active")
    op.drop_column("outlets", "address")
