"""driver availability for the next operating day

Revision ID: 0006_driver_availability
Revises: 0005_delivery_receipts
Create Date: 2026-10-01 21:00:00.000000

The driver's "Ready for tomorrow" confirmation. One row per driver per day.
Not applied to the shared Neon database yet: per docs/database-migrations.md
only the DB lead runs `alembic upgrade head` there.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0006_driver_availability'
down_revision: Union[str, Sequence[str], None] = '0005_delivery_receipts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'driver_availability',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('driver_id', sa.Integer(), nullable=False),
        sa.Column('for_date', sa.Date(), nullable=False),
        sa.Column('confirmed_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['driver_id'], ['users.id'], name='fk_driver_availability_driver_id_users'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('driver_id', 'for_date', name='uq_driver_availability_day'),
    )
    op.create_index(op.f('ix_driver_availability_id'), 'driver_availability', ['id'], unique=False)
    op.create_index(op.f('ix_driver_availability_driver_id'), 'driver_availability', ['driver_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_driver_availability_driver_id'), table_name='driver_availability')
    op.drop_index(op.f('ix_driver_availability_id'), table_name='driver_availability')
    op.drop_table('driver_availability')
