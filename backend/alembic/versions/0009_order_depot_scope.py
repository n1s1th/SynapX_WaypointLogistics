"""Add an explicit dispatch depot to orders.

Existing orders inherit the depot of their outlet when available. Older rows
without an outlet remain in the Peliyagoda operational scope.

Revision ID: 0009_order_depot_scope
Revises: 0008_store_catalogue
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_order_depot_scope"
down_revision = "0008_store_catalogue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("depot", sa.Enum("PELIYAGODA", "KANDY", name="depot"), nullable=True))
    op.execute("""
        UPDATE orders
        SET depot = outlets.depot
        FROM outlets
        WHERE orders.outlet_id = outlets.id
    """)
    op.execute("UPDATE orders SET depot = 'PELIYAGODA' WHERE depot IS NULL")
    op.alter_column("orders", "depot", nullable=False)
    op.create_index("ix_orders_depot", "orders", ["depot"])


def downgrade() -> None:
    op.drop_index("ix_orders_depot", table_name="orders")
    op.drop_column("orders", "depot")
