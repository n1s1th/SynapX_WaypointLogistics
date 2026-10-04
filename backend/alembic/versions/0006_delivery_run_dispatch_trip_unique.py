"""delivery_runs.dispatch_trip_id unique

One loader run per dispatch trip (docs/reference/loader/INTEGRATION_DESIGN.md, slice 1).
Additive only: a unique index on the loader's own existing nullable column.
NULLs may repeat, so runs not built from a trip (the demo seeds) are unaffected.

Revision ID: 0006_run_dispatch_trip_unique
Revises: 0005_delivery_receipts
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0006_run_dispatch_trip_unique'
down_revision: Union[str, Sequence[str], None] = '0005_delivery_receipts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "uq_delivery_runs_dispatch_trip_id"


def upgrade() -> None:
    op.create_index(INDEX, "delivery_runs", ["dispatch_trip_id"], unique=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name="delivery_runs")
