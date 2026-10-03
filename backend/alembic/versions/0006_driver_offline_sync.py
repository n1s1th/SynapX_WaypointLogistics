"""driver offline sync: event ledger, outcome reason, POD quantities

Additive only: one new table and nullable columns, no data rewritten.
Idempotent: skips anything already present, because the shared database may
have received this schema from scripts/apply_driver_offline_sync.py while the
team's 0006 migration heads were still unmerged.

Revision ID: 0006_driver_offline_sync
Revises: 0005_delivery_receipts
Create Date: 2026-10-02 21:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0006_driver_offline_sync'
down_revision: Union[str, Sequence[str], None] = '0005_delivery_receipts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(insp, table: str, column: str) -> bool:
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    # 1. Ledger of offline writes; client_action_id is the idempotency key
    if insp.has_table('driver_sync_events'):
        _add_columns(insp)
        return
    op.create_table(
        'driver_sync_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_action_id', sa.String(length=64), nullable=False),
        sa.Column('driver_id', sa.Integer(), nullable=False),
        sa.Column('action_type', sa.String(length=32), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=True),
        sa.Column('stop_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('code', sa.String(length=64), nullable=True),
        sa.Column('message', sa.String(length=500), nullable=True),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('payload_summary', sa.JSON(), nullable=True),
        sa.Column('client_timestamp', sa.DateTime(), nullable=True),
        sa.Column('received_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_by_id', sa.Integer(), nullable=True),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['driver_id'], ['users.id'], name='fk_driver_sync_events_driver_id_users'),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id'], name='fk_driver_sync_events_reviewed_by_id_users'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_driver_sync_events_id', 'driver_sync_events', ['id'])
    op.create_index('ix_driver_sync_events_client_action_id', 'driver_sync_events', ['client_action_id'], unique=True)
    op.create_index('ix_driver_sync_events_driver_id', 'driver_sync_events', ['driver_id'])
    op.create_index('ix_driver_sync_events_trip_id', 'driver_sync_events', ['trip_id'])

    _add_columns(insp)


def _add_columns(insp) -> None:
    # 2. Why a stop failed ("Refused by outlet" is a failed stop with this reason)
    if not _has_column(insp, 'delivery_stops', 'outcome_reason'):
        op.add_column('delivery_stops', sa.Column('outcome_reason', sa.String(length=255), nullable=True))

    # 3. Units actually handed over, and when the driver captured the proof
    if not _has_column(insp, 'proof_of_delivery', 'delivered_items'):
        op.add_column('proof_of_delivery', sa.Column('delivered_items', sa.JSON(), nullable=True))
    if not _has_column(insp, 'proof_of_delivery', 'captured_at'):
        op.add_column('proof_of_delivery', sa.Column('captured_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('proof_of_delivery', 'captured_at')
    op.drop_column('proof_of_delivery', 'delivered_items')
    op.drop_column('delivery_stops', 'outcome_reason')
    op.drop_index('ix_driver_sync_events_trip_id', table_name='driver_sync_events')
    op.drop_index('ix_driver_sync_events_driver_id', table_name='driver_sync_events')
    op.drop_index('ix_driver_sync_events_client_action_id', table_name='driver_sync_events')
    op.drop_index('ix_driver_sync_events_id', table_name='driver_sync_events')
    op.drop_table('driver_sync_events')
