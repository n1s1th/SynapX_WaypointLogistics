"""Seed outlets and the operating calendar from the brief's CSVs (outlets.csv, calendar.csv).

The CSVs are shared privately and gitignored; put them in docs/ (the default) or pass their paths.

Only ADDS rows that are missing (matched by outlet code / calendar date). It never updates or deletes,
so it's safe to re-run and won't touch rows other teams created.

    python scripts/seed_reference_data.py                 # dry run: shows what would be added
    python scripts/seed_reference_data.py --yes           # add the missing rows

Writing to a non-local database (e.g. the shared Neon database) needs the DB lead's OK —
the script prints the target host before doing anything.
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every model)
from app.core.config import settings
from app.models.reference import Brand, CalendarDay, Depot, DockType, Outlet

REPO_ROOT = Path(__file__).resolve().parents[2]


def parse_time(value: str) -> time | None:
    if not value:
        return None
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def outlet_from_row(row: dict) -> Outlet:
    brand = row["brand"].strip()
    district = row["district"].strip()
    return Outlet(
        code=row["outlet_id"].strip(),
        # The CSV has no outlet names; "Fresh Colombo" matches the Store Manager header (Figma).
        name=f"{brand} {district}",
        brand=Brand(brand.lower()),
        district=district,
        dock_type=DockType(row["dock_type"].strip()),
        van_only=row["parking_constraint"].strip() == "van_only",
        window_start=parse_time(row["window_open_time"].strip()),
        window_end=parse_time(row["window_close_time"].strip()),
        depot=Depot(row["depot"].strip().lower()),
    )


def calendar_day_from_row(row: dict) -> CalendarDay:
    festival = row["festival"].strip()
    is_holiday = row["is_holiday"] == "1"
    return CalendarDay(
        date=date.fromisoformat(row["date"]),
        # is_operating is the truth: some festivals are holidays but the depot still runs.
        is_operating=row["is_operating"] == "1",
        festival_ramp=float(row["festival_ramp"] or 0),
        monsoon=row["monsoon"] == "1",
        holiday_name=festival.replace("_", " ").title() if festival else ("Public holiday" if is_holiday else None),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--outlets", type=Path, default=REPO_ROOT / "docs" / "reference" / "outlets.csv")
    parser.add_argument("--calendar", type=Path, default=REPO_ROOT / "docs" / "reference" / "calendar.csv")
    parser.add_argument("--yes", action="store_true", help="actually write (default is a dry run)")
    args = parser.parse_args()

    url = settings.DATABASE_URL_UNPOOLED or settings.DATABASE_URL
    host = make_url(url).host or "local file"
    print(f"Target database host: {host}")

    outlets = [outlet_from_row(row) for row in csv.DictReader(args.outlets.open())]
    days = [calendar_day_from_row(row) for row in csv.DictReader(args.calendar.open())]

    engine = create_engine(url)
    with Session(engine) as db:
        existing_codes = set(db.scalars(select(Outlet.code)))
        existing_dates = set(db.scalars(select(CalendarDay.date)))
        new_outlets = [o for o in outlets if o.code not in existing_codes]
        new_days = [d for d in days if d.date not in existing_dates]
        print(f"Outlets:  {len(outlets)} in CSV, {len(existing_codes)} in database, {len(new_outlets)} to add")
        print(f"Calendar: {len(days)} in CSV, {len(existing_dates)} in database, {len(new_days)} to add")
        if not args.yes:
            print("Dry run — nothing written. Re-run with --yes to add the rows.")
            return 0
        db.add_all(new_outlets + new_days)
        db.commit()  # one transaction: all rows or none
        print(f"Added {len(new_outlets)} outlets and {len(new_days)} calendar days.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
