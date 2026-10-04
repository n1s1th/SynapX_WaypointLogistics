"""delivery issues table for exceptions and discrepancies.

Revision ID: 0006_delivery_issues
Revises: 0005_delivery_receipts
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_delivery_issues"
down_revision: Union[str, Sequence[str], None] = "0005_delivery_receipts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "delivery_issues",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("order_number", sa.String(length=50), nullable=True),
        sa.Column("outlet_id", sa.Integer(), nullable=True),
        sa.Column("issue_type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("affected_item", sa.String(length=255), nullable=True),
        sa.Column("sku", sa.String(length=100), nullable=True),
        sa.Column("expected_units", sa.Integer(), nullable=True),
        sa.Column("received_units", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("photo_url", sa.Text(), nullable=True),
        sa.Column("photo_name", sa.String(length=255), nullable=True),
        sa.Column("photo_size", sa.String(length=100), nullable=True),
        sa.Column("reported_by", sa.String(length=255), nullable=False, server_default="Sarah Jenkins (Store Manager)"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="open"),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("claimed_amount", sa.String(length=50), nullable=True),
        sa.Column("driver_name", sa.String(length=255), nullable=True),
        sa.Column("vehicle_id", sa.String(length=50), nullable=True),
        sa.Column("reported_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_delivery_issues_order_id_orders"),
        sa.ForeignKeyConstraint(["outlet_id"], ["outlets.id"], name="fk_delivery_issues_outlet_id_outlets"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_delivery_issues_id"), "delivery_issues", ["id"], unique=False)
    op.create_index(op.f("ix_delivery_issues_order_id"), "delivery_issues", ["order_id"], unique=False)
    op.create_index(op.f("ix_delivery_issues_order_number"), "delivery_issues", ["order_number"], unique=False)
    op.create_index(op.f("ix_delivery_issues_outlet_id"), "delivery_issues", ["outlet_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_delivery_issues_outlet_id"), table_name="delivery_issues")
    op.drop_index(op.f("ix_delivery_issues_order_number"), table_name="delivery_issues")
    op.drop_index(op.f("ix_delivery_issues_order_id"), table_name="delivery_issues")
    op.drop_index(op.f("ix_delivery_issues_id"), table_name="delivery_issues")
    op.drop_table("delivery_issues")
