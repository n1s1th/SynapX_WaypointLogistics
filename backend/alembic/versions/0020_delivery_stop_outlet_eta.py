"""delivery_stops: outlet_id and eta

Each driver stop names the store it delivers to (outlet names aren't unique),
and carries the time the truck is expected there, so every store sees its own
ETA and arrival time instead of the whole trip's.

Additive only: two nullable columns, an index and a foreign key. Stops copied
before this have no outlet_id; the driver service fills it in from the loader
run when the trip starts.

Was 0014_delivery_stop_outlet_eta (parent 0013_driver_availability), which made
a second head. Moved to the end of the chain. Every step is IF NOT EXISTS
because these columns were added to Neon by hand to unblock the driver screens,
so on Neon this upgrade is a no-op and no `alembic stamp` is needed.

Revision ID: 0020_delivery_stop_outlet_eta
Revises: 0019_route_plan_snapshots
Create Date: 2026-10-04

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0020_delivery_stop_outlet_eta"
down_revision: Union[str, Sequence[str], None] = "0019_route_plan_snapshots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK = "fk_delivery_stops_outlet_id_outlets"
INDEX = "ix_delivery_stops_outlet_id"


def upgrade() -> None:
    op.execute("ALTER TABLE delivery_stops ADD COLUMN IF NOT EXISTS outlet_id INTEGER")
    op.execute("ALTER TABLE delivery_stops ADD COLUMN IF NOT EXISTS eta TIMESTAMP WITHOUT TIME ZONE")
    # Postgres has no ADD CONSTRAINT IF NOT EXISTS.
    op.execute(
        f"""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{FK}') THEN
                ALTER TABLE delivery_stops
                    ADD CONSTRAINT {FK} FOREIGN KEY (outlet_id) REFERENCES outlets (id);
            END IF;
        END $$;
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS {INDEX} ON delivery_stops (outlet_id)")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX}")
    op.execute(f"ALTER TABLE delivery_stops DROP CONSTRAINT IF EXISTS {FK}")
    op.execute("ALTER TABLE delivery_stops DROP COLUMN IF EXISTS eta")
    op.execute("ALTER TABLE delivery_stops DROP COLUMN IF EXISTS outlet_id")
