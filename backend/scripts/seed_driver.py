"""Driver login for the demo: a DRIVER user with a profile on the loader's demo vehicle.

The driver sees a run once the loader releases it, through their vehicle
(driver_profiles.assigned_vehicle_id). The loader's seeds put their demo runs on
the first Peliyagoda reefer truck (VEH014 on Neon, VEH001 in seed_loader_demo.py),
so by default the driver is assigned to that same truck.

Insert-only, like seed_reference_data.py: it adds what is missing and changes
nothing else. An existing profile keeps its vehicle unless --assign-vehicle is
passed. It writes only to users and driver_profiles: no runs, orders or
schema changes.

    python scripts/seed_driver.py                       # dry run: shows what it would add
    python scripts/seed_driver.py --yes                 # add the missing rows
    python scripts/seed_driver.py --vehicle VEH001 --yes

Writing to a non-local database (the shared Neon database) needs the DB lead's OK
(docs/database-migrations.md); the target host is printed before anything else.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every model)
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.fleet import DriverProfile, Vehicle
from app.models.user import User, UserRole

DEFAULT_EMAIL = "driver@waypoint.com"
DEFAULT_PASSWORD = "driver123"
DEFAULT_NAME = "Tharindu Fernando"


def pick_vehicle(db: Session, code: str | None) -> Vehicle | None:
    if code:
        return db.execute(select(Vehicle).where(Vehicle.code == code)).scalars().first()
    # Same rule as scripts/seed_loader_neon.py: the first Peliyagoda reefer truck.
    return (
        db.execute(
            select(Vehicle)
            .where(
                func.lower(Vehicle.depot_name) == "peliyagoda",
                func.lower(Vehicle.temperature_mode) == "reefer",
                func.lower(Vehicle.vehicle_type) == "truck",
            )
            .order_by(Vehicle.code)
        )
        .scalars()
        .first()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--vehicle", help="vehicle code, e.g. VEH014 (default: first Peliyagoda reefer truck)")
    parser.add_argument("--assign-vehicle", action="store_true", help="move an existing profile to this vehicle")
    parser.add_argument("--yes", action="store_true", help="actually write (default is a dry run)")
    args = parser.parse_args()

    url = settings.DATABASE_URL_UNPOOLED or settings.DATABASE_URL
    print(f"Target database host: {make_url(url).host or 'local file'}")

    engine = create_engine(url)
    with Session(engine) as db:
        vehicle = pick_vehicle(db, args.vehicle)
        if vehicle is None:
            print("No matching vehicle. Seed the fleet first, or pass --vehicle.")
            return 1

        user = db.execute(select(User).where(User.email == args.email)).scalars().first()
        if user is not None and user.role != UserRole.DRIVER:
            print(f"{args.email} exists but is a {user.role.value}; pick another --email.")
            return 1
        profile = (
            db.execute(select(DriverProfile).where(DriverProfile.user_id == user.id)).scalars().first()
            if user is not None
            else None
        )

        plan = []
        if user is None:
            plan.append(f"users            add {args.email} ({args.name}, DRIVER)")
        else:
            plan.append(f"users            keep {args.email} (exists)")
        if profile is None:
            plan.append(f"driver_profiles  add profile on {vehicle.code}")
        elif profile.assigned_vehicle_id == vehicle.id:
            plan.append(f"driver_profiles  keep profile on {vehicle.code}")
        elif args.assign_vehicle:
            plan.append(f"driver_profiles  move profile to {vehicle.code}")
        else:
            plan.append("driver_profiles  keep profile on its current vehicle (pass --assign-vehicle to move it)")
        print("\n".join(plan))

        if not args.yes:
            print("Dry run — nothing written. Re-run with --yes to apply.")
            return 0

        created_user = user is None
        if user is None:
            user = User(
                email=args.email,
                full_name=args.name,
                hashed_password=get_password_hash(args.password),
                role=UserRole.DRIVER,
                is_active=True,
            )
            db.add(user)
            db.flush()
        if profile is None:
            db.add(
                DriverProfile(
                    user_id=user.id,
                    license_type="Heavy",
                    phone="0771000214",
                    assigned_vehicle_id=vehicle.id,
                )
            )
        elif args.assign_vehicle:
            profile.assigned_vehicle_id = vehicle.id
        db.commit()  # one transaction: all rows or none
        password = args.password if created_user else "(its existing password)"
        print(f"Done. Sign in as {args.email} / {password}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
