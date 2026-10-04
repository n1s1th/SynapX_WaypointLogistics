"""Load the store catalogue from the brief's cargo spec CSVs into fresh_items, style_items and tech_items.

Reads docs/reference/fresh_cargo_specs.csv, docs/reference/style_cargo_specs.csv and docs/reference/tech_cargo_specs.csv (shared
privately and gitignored). Columns: sku, name, chain, unit_weight_kg, unit_volume_m3 (per carton),
temp_requirement, depot_name, last_updated. Each row goes to its chain's table.

New SKUs are added and existing ones get their specs refreshed from the CSV, which is the source of truth.
Nothing is deleted, and only these three tables are touched. Safe to re-run.

    python scripts/seed_catalogue.py          # dry run: shows what would change
    python scripts/seed_catalogue.py --yes    # write it

Needs migration 0008_store_catalogue applied first. Writing to a non-local database (e.g. the shared Neon
database) needs the DB lead's OK; the script prints the target host first.
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every model)
from app.core.config import settings
from app.models.catalogue import CATALOGUE_BY_BRAND
from app.models.reference import Brand

DOCS = Path(__file__).resolve().parents[2] / "docs" / "reference"
SPEC_FIELDS = ["name", "unit_weight_kg", "unit_volume_m3", "temperature_zone", "depot_name", "spec_updated_at"]


def spec_from_row(row: dict) -> dict:
    zone = row["temp_requirement"].strip().title()
    if zone not in ("Chilled", "Ambient"):
        raise SystemExit(f"{row['sku']}: unknown temp_requirement {row['temp_requirement']!r}")
    return {
        "name": row["name"].strip(),
        "unit_weight_kg": float(row["unit_weight_kg"]),
        "unit_volume_m3": float(row["unit_volume_m3"]),
        "temperature_zone": zone,
        "depot_name": row["depot_name"].strip() or None,
        "spec_updated_at": datetime.fromisoformat(row["last_updated"]) if row.get("last_updated") else None,
    }


def read_specs(folder: Path, brand: Brand) -> dict[str, dict]:
    specs: dict[str, dict] = {}
    with (folder / f"{brand.value}_cargo_specs.csv").open() as f:
        for row in csv.DictReader(f):
            if row["chain"].strip().lower() != brand.value:
                raise SystemExit(f"{row['sku']} is a {row['chain']} item in the {brand.value} file.")
            sku = row["sku"].strip()
            if sku in specs:
                raise SystemExit(f"{sku} appears twice in {brand.value}_cargo_specs.csv.")
            specs[sku] = spec_from_row(row)
    return specs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--docs", type=Path, default=DOCS, help="folder holding the three CSVs")
    parser.add_argument("--yes", action="store_true", help="actually write (default is a dry run)")
    args = parser.parse_args()

    url = settings.DATABASE_URL_UNPOOLED or settings.DATABASE_URL
    print(f"Target database host: {make_url(url).host or 'local file'}")

    with Session(create_engine(url)) as db:
        totals = {"added": 0, "refreshed": 0}
        for brand, model in CATALOGUE_BY_BRAND.items():
            specs = read_specs(args.docs, brand)
            existing = {item.sku: item for item in db.scalars(select(model))}
            new = [sku for sku in specs if sku not in existing]
            changed = [
                sku for sku in specs
                if sku in existing and any(getattr(existing[sku], f) != specs[sku][f] for f in SPEC_FIELDS)
            ]
            print(
                f"{model.__tablename__:12} CSV {len(specs):4} | in database {len(existing):4} | "
                f"to add {len(new):4} | to refresh {len(changed):4}"
            )
            if args.yes:
                for sku in changed:
                    for field in SPEC_FIELDS:
                        setattr(existing[sku], field, specs[sku][field])
                db.add_all(model(sku=sku, **specs[sku]) for sku in new)
            totals["added"] += len(new)
            totals["refreshed"] += len(changed)
        if not args.yes:
            print("Dry run — nothing written. Re-run with --yes to apply.")
            return 0
        db.commit()  # one transaction across all three tables
        print(f"Added {totals['added']} items and refreshed {totals['refreshed']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
