"""
Apply the driver offline-sync schema (migration 0006_driver_offline_sync) to a
database WITHOUT touching alembic_version.

Why: the shared Neon database is stamped with another branch's 0006 revision
(0006_delivery_issues), so `alembic upgrade` from this branch cannot run until
the team merges migration heads. This script adds only what is missing:

  - table  driver_sync_events
  - column delivery_stops.outcome_reason
  - column proof_of_delivery.delivered_items
  - column proof_of_delivery.captured_at

Additive and idempotent: safe to run more than once; existing data untouched.
The 0006_driver_offline_sync migration skips anything that already exists, so
running `alembic upgrade` after the heads are merged is also safe.

Run from backend/:
    python scripts/apply_driver_offline_sync.py --dry-run
    python scripts/apply_driver_offline_sync.py
"""
import argparse
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import JSON, Column, DateTime, String, inspect, text  # noqa: E402
from sqlalchemy.exc import ProgrammingError  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.models.driver import DriverSyncEvent  # noqa: E402

NEW_COLUMNS = [
    ("delivery_stops", Column("outcome_reason", String(255), nullable=True)),
    ("proof_of_delivery", Column("delivered_items", JSON, nullable=True)),
    ("proof_of_delivery", Column("captured_at", DateTime, nullable=True)),
]


def main(dry_run: bool) -> None:
    insp = inspect(engine)
    planned = []

    if not insp.has_table(DriverSyncEvent.__tablename__):
        planned.append(("create table", DriverSyncEvent.__tablename__))
    for table, column in NEW_COLUMNS:
        existing = {c["name"] for c in insp.get_columns(table)}
        if column.name not in existing:
            planned.append(("add column", f"{table}.{column.name}", table, column))

    if not planned:
        print("Nothing to do — the driver offline-sync schema is already in place.")
        return
    for step in planned:
        print(f"{'[dry run] ' if dry_run else ''}{step[0]}: {step[1]}")
    if dry_run:
        return

    try:
        _apply(planned)
    except ProgrammingError as err:
        if "InsufficientPrivilege" in type(err.orig).__name__ or "must be owner" in str(err.orig):
            print()
            print("Nothing was changed: this database user does not own these tables.")
            print("Run scripts/sql/0006_driver_offline_sync.sql as the table owner instead")
            print("(on Neon: paste it into the console SQL Editor, which runs as neondb_owner).")
            sys.exit(1)
        raise
    print("Done. alembic_version was not changed.")


def _apply(planned) -> None:
    with engine.begin() as conn:
        for step in planned:
            if step[0] == "create table":
                DriverSyncEvent.__table__.create(bind=conn, checkfirst=True)
            else:
                _, _, table, column = step
                col_type = column.type.compile(dialect=conn.dialect)
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column.name} {col_type}'))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Only print what would change")
    main(parser.parse_args().dry_run)
