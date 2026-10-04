"""Store catalogue tables.

Revision ID: 0008_store_catalogue
Revises: 0007_merge_heads
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_store_catalogue"
down_revision: Union[str, Sequence[str], None] = "0007_merge_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ["fresh_items", "style_items", "tech_items"]


def upgrade() -> None:
    for table in TABLES:
        op.create_table(
            table,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("sku", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("unit_weight_kg", sa.Float(), nullable=False),
            sa.Column("unit_volume_m3", sa.Float(), nullable=False),
            sa.Column("temperature_zone", sa.String(length=20), nullable=False),
            sa.Column("depot_name", sa.String(length=100), nullable=True),
            sa.Column("spec_updated_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f(f"ix_{table}_id"), table, ["id"], unique=False)
        op.create_index(op.f(f"ix_{table}_sku"), table, ["sku"], unique=True)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_index(op.f(f"ix_{table}_sku"), table_name=table)
        op.drop_index(op.f(f"ix_{table}_id"), table_name=table)
        op.drop_table(table)
