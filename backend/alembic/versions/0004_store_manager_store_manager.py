"""store manager

SHARED MODEL CHANGE - `orders` is read by the dispatcher, driver and loader teams too.

Adds what the Store Manager needs on top of the loader's 0002/0003:
- the `notifications` table (docs/store-manager-contract.md §4)
- five Store Manager columns on `orders`
- three new `orderstatus` values: SUBMITTED, READY_FOR_DISPATCH, COMPLETED

`outlets`, `calendar_days` and orders.outlet_id / units / volume_m3 are NOT created
here. They come from the loader's 0002_loader_foundation and 0003_order_loader_fields.

Revision ID: 0004_store_manager
Revises: 0003_order_loader_fields
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004_store_manager'
down_revision: Union[str, Sequence[str], None] = '0003_order_loader_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named explicitly so downgrade() can drop them by name.
FK_ORDERS_PLACED_BY = "fk_orders_placed_by_users"

NOTIFICATION_TYPES = (
    'ORDER_SUBMITTED', 'ORDER_CONFIRMED', 'DISPATCHER_NOTE', 'SHORTFALL_WARNING', 'DEFERRED',
    'READY_FOR_DISPATCH', 'ETA_UPDATED', 'DELIVERED', 'ISSUE_LOGGED', 'ORDER_CLOSED',
)
NOTIFICATION_CATEGORIES = ('REQUEST', 'DELIVERY', 'ISSUE')
NEW_ORDER_STATUSES = ('SUBMITTED', 'READY_FOR_DISPATCH', 'COMPLETED')


def upgrade() -> None:
    """Upgrade schema."""
    # SQLAlchemy stores Enum members by name, so these are the uppercase names from OrderStatus.
    # IF NOT EXISTS makes a re-run safe. New values can't be used in this same transaction,
    # and nothing below uses them.
    for status in NEW_ORDER_STATUSES:
        op.execute(sa.text(f"ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS '{status}'"))

    op.add_column('orders', sa.Column('submitted_at', sa.DateTime(), nullable=True))
    op.add_column('orders', sa.Column('cutoff_at', sa.DateTime(), nullable=True))
    op.add_column('orders', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('orders', sa.Column('placed_by', sa.Integer(), nullable=True))
    # server_default fills existing rows; the model's Python default covers new ones.
    op.add_column('orders', sa.Column('deferral_count', sa.Integer(), server_default='0', nullable=False))
    op.create_foreign_key(FK_ORDERS_PLACED_BY, 'orders', 'users', ['placed_by'], ['id'])

    op.create_table('notifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('outlet_id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=True),
    sa.Column('type', sa.Enum(*NOTIFICATION_TYPES, name='notificationtype'), nullable=False),
    sa.Column('category', sa.Enum(*NOTIFICATION_CATEGORIES, name='notificationcategory'), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('is_read', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name='fk_notifications_order_id_orders'),
    sa.ForeignKeyConstraint(['outlet_id'], ['outlets.id'], name='fk_notifications_outlet_id_outlets'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_id'), 'notifications', ['id'], unique=False)
    op.create_index('ix_notifications_outlet_is_read', 'notifications', ['outlet_id', 'is_read'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_notifications_outlet_is_read', table_name='notifications')
    op.drop_index(op.f('ix_notifications_id'), table_name='notifications')
    op.drop_table('notifications')
    op.execute(sa.text("DROP TYPE IF EXISTS notificationcategory"))
    op.execute(sa.text("DROP TYPE IF EXISTS notificationtype"))

    op.drop_constraint(FK_ORDERS_PLACED_BY, 'orders', type_='foreignkey')
    op.drop_column('orders', 'deferral_count')
    op.drop_column('orders', 'placed_by')
    op.drop_column('orders', 'notes')
    op.drop_column('orders', 'cutoff_at')
    op.drop_column('orders', 'submitted_at')

    # Postgres can't remove values from an enum, so SUBMITTED, READY_FOR_DISPATCH and
    # COMPLETED stay in orderstatus. Harmless: nothing older than this revision uses them.
