"""Catch migrations up with schema changes that were made on Neon by hand.

Revision ID: 0014_schema_catchup
Revises: 0013_driver_availability

Neon already has all of this (added directly, without a migration), so a fresh `alembic upgrade head` failed
or produced a database the models can't use. Every step is idempotent: on Neon it only tightens what the
models already require; on a fresh database it creates the missing pieces.

- userrole enum: STORE_MANAGER and LOADER
- users.keycloak_id (unique), users.hashed_password nullable (Keycloak users have no local password)
- vehicles.fuel_type / km_per_l / weekly_fuel_quota_l, NOT NULL with defaults
- outlets.parking_constraint (NOT NULL, 'normal') and outlets.mall_window
- inventory_items cargo specs: chain, unit_weight_kg, unit_volume_m3, temp_requirement, depot_name
- allocations.driver_id nullable (an allocation can exist before a driver is assigned)
- unique indexes named as the models expect, instead of the hand-made unique constraints
"""

from alembic import op


revision = "0014_schema_catchup"
down_revision = "0013_driver_availability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New enum values. Safe inside the migration transaction because nothing below uses them.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'LOADER'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'STORE_MANAGER'")

    # users
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS keycloak_id VARCHAR(64)")
    op.execute("ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_keycloak_id ON users (keycloak_id)")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_keycloak_id_key")

    # vehicles: fuel planning columns
    op.execute("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(50) DEFAULT 'diesel'")
    op.execute("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS km_per_l DOUBLE PRECISION DEFAULT 6.0")
    op.execute("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS weekly_fuel_quota_l DOUBLE PRECISION DEFAULT 500.0")
    op.execute("UPDATE vehicles SET fuel_type = 'diesel' WHERE fuel_type IS NULL")
    op.execute("UPDATE vehicles SET km_per_l = 6.0 WHERE km_per_l IS NULL")
    op.execute("UPDATE vehicles SET weekly_fuel_quota_l = 500.0 WHERE weekly_fuel_quota_l IS NULL")
    for column in ("fuel_type", "km_per_l", "weekly_fuel_quota_l"):
        op.execute(f"ALTER TABLE vehicles ALTER COLUMN {column} SET NOT NULL")

    # outlets
    op.execute("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS parking_constraint VARCHAR(50) DEFAULT 'normal'")
    op.execute("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS mall_window VARCHAR(50)")
    op.execute(
        "UPDATE outlets SET parking_constraint = CASE WHEN van_only THEN 'van_only' ELSE 'normal' END "
        "WHERE parking_constraint IS NULL"
    )
    op.execute("ALTER TABLE outlets ALTER COLUMN parking_constraint SET NOT NULL")

    # inventory_items: cargo specs (Dispatcher inventory)
    op.execute("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS chain VARCHAR(50)")
    op.execute("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_weight_kg DOUBLE PRECISION DEFAULT 0.0")
    op.execute("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_volume_m3 DOUBLE PRECISION DEFAULT 0.0")
    op.execute("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS temp_requirement VARCHAR(50) DEFAULT 'Ambient'")
    op.execute("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS depot_name VARCHAR(100)")

    # allocations: a driver is assigned after the allocation is created
    op.execute("ALTER TABLE allocations ALTER COLUMN driver_id DROP NOT NULL")

    # depot_dispatcher_assignments: one unique index, as the model declares (unique=True, index=True)
    op.execute("DROP INDEX IF EXISTS ix_depot_dispatcher_assignments_user_id")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_depot_dispatcher_assignments_user_id "
        "ON depot_dispatcher_assignments (user_id)"
    )
    op.execute(
        "ALTER TABLE depot_dispatcher_assignments DROP CONSTRAINT IF EXISTS depot_dispatcher_assignments_user_id_key"
    )


def downgrade() -> None:
    # Only the tightening is reversed; the columns stay (Neon had them before this migration), and Postgres
    # can't drop enum values.
    op.execute(
        "ALTER TABLE depot_dispatcher_assignments ADD CONSTRAINT depot_dispatcher_assignments_user_id_key UNIQUE (user_id)"
    )
    op.execute("DROP INDEX IF EXISTS ix_depot_dispatcher_assignments_user_id")
    op.execute("CREATE INDEX ix_depot_dispatcher_assignments_user_id ON depot_dispatcher_assignments (user_id)")
    op.execute("ALTER TABLE outlets ALTER COLUMN parking_constraint DROP NOT NULL")
    for column in ("fuel_type", "km_per_l", "weekly_fuel_quota_l"):
        op.execute(f"ALTER TABLE vehicles ALTER COLUMN {column} DROP NOT NULL")
    op.execute("ALTER TABLE users ADD CONSTRAINT users_keycloak_id_key UNIQUE (keycloak_id)")
    op.execute("DROP INDEX IF EXISTS ix_users_keycloak_id")
