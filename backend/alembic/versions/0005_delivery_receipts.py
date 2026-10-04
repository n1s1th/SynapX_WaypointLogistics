"""delivery receipts and order items extension

Revision ID: 0005_delivery_receipts
Revises: 0004_store_manager
Create Date: 2026-09-30 19:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0005_delivery_receipts'
down_revision: Union[str, Sequence[str], None] = '0004_store_manager'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK_DELIVERY_RECEIPTS_ORDER = "fk_delivery_receipts_order_id_orders"
FK_DELIVERY_RECEIPTS_OUTLET = "fk_delivery_receipts_outlet_id_outlets"


def upgrade() -> None:
    # 1. Add order_items columns (docs/reference/store-manager-contract.md §2)
    op.add_column('order_items', sa.Column('quantity_sent', sa.Integer(), nullable=True))
    op.add_column('order_items', sa.Column('dispatcher_note', sa.Text(), nullable=True))

    # 2. Create delivery_receipts table with integer IDs and plain DateTime
    op.create_table(
        'delivery_receipts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('outlet_id', sa.Integer(), nullable=False),
        sa.Column('units_received', sa.Integer(), nullable=True),
        sa.Column('weight_received_kg', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('has_issues', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('issue_type', sa.String(length=30), nullable=True),
        sa.Column('issue_description', sa.Text(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('synced_from_offline', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=FK_DELIVERY_RECEIPTS_ORDER),
        sa.ForeignKeyConstraint(['outlet_id'], ['outlets.id'], name=FK_DELIVERY_RECEIPTS_OUTLET),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_delivery_receipts_id'), 'delivery_receipts', ['id'], unique=False)
    op.create_index(op.f('ix_delivery_receipts_order_id'), 'delivery_receipts', ['order_id'], unique=True)

    # 3. Create outlet_settings table
    op.create_table(
        'outlet_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('outlet_id', sa.Integer(), nullable=False),
        # Outlet-specific contact details: nullable with no default, so an outlet that hasn't
        # set them shows a UI placeholder instead of the same made-up person for every outlet.
        sa.Column('store_manager', sa.String(length=255), nullable=True),
        sa.Column('contact_phone', sa.String(length=50), nullable=True),
        sa.Column('emergency_contact', sa.String(length=255), nullable=True),
        sa.Column('parking', sa.String(length=100), nullable=False, server_default='No restrictions'),
        sa.Column('driver_check_in_call', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('share_dock_gate_code', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('email_alerts_issues', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('sms_alerts_priority', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('last_synced_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['outlet_id'], ['outlets.id'], name='fk_outlet_settings_outlet_id_outlets'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_outlet_settings_id'), 'outlet_settings', ['id'], unique=False)
    op.create_index(op.f('ix_outlet_settings_outlet_id'), 'outlet_settings', ['outlet_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_outlet_settings_outlet_id'), table_name='outlet_settings')
    op.drop_index(op.f('ix_outlet_settings_id'), table_name='outlet_settings')
    op.drop_table('outlet_settings')

    op.drop_index(op.f('ix_delivery_receipts_order_id'), table_name='delivery_receipts')
    op.drop_index(op.f('ix_delivery_receipts_id'), table_name='delivery_receipts')
    op.drop_table('delivery_receipts')

    op.drop_column('order_items', 'dispatcher_note')
    op.drop_column('order_items', 'quantity_sent')

