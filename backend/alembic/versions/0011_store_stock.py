"""store stock

Revision ID: 0011_store_stock
Revises: 0010_depot_assignments
Create Date: 2026-10-03 21:00:00.000000

store_stock: each outlet's on-hand quantities from the Store Manager's CSV import. Only creates a new table.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0011_store_stock'
down_revision: Union[str, Sequence[str], None] = '0010_depot_assignments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'store_stock',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('outlet_id', sa.Integer(), nullable=False),
        sa.Column('sku', sa.String(length=50), nullable=False),
        sa.Column('quantity_on_hand', sa.Integer(), nullable=False),
        sa.Column('imported_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['outlet_id'], ['outlets.id'], name='fk_store_stock_outlet_id_outlets', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('outlet_id', 'sku', name='uq_store_stock_outlet_sku'),
    )
    op.create_index(op.f('ix_store_stock_id'), 'store_stock', ['id'], unique=False)
    op.create_index(op.f('ix_store_stock_outlet_id'), 'store_stock', ['outlet_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_store_stock_outlet_id'), table_name='store_stock')
    op.drop_index(op.f('ix_store_stock_id'), table_name='store_stock')
    op.drop_table('store_stock')
