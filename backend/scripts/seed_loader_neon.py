"""Insert-only loader demo data for a SHARED database (Neon).

Unlike seed_loader_demo.py (local only, upserts, --reset), this script never
updates or deletes anything. Every row is looked up by its natural key first
and skipped if it exists, so running it twice changes nothing - including
after a demo has ticked, flagged and released the run.

What it adds, for one operating day (--date, default today in depot time):

    docks           DOCK3 "Dock 3" (Peliyagoda)
    dock_tablets    "Dock tablet 3"
    loader_users    Saman J. (PIN 4417), Tharindu J. (2580), Nimal S. (1357)
                    - the names and PINs in frontend/lib/loader/mock-data.ts
    orders          LDR-<MMDD>-01..08 on the run, plus LDR-<MMDD>-09 (deferred
                    yesterday, not on the plan) for the plan-change demo
    delivery_runs   LDR-RUN-<MMDD>: Fresh, Gampaha, night wave, departs 03:30,
                    not started, plan v1 published the evening before and
                    acknowledged by Saman J.
    run_stops / run_stop_orders / plan_revisions / loader_activities for it

It reuses what the shared database already has and never changes it:

    vehicles        the first Peliyagoda reefer truck in fleet (VEH014 on Neon);
                    only if there is none does it add LDR-VEH-01
    outlets         OUT026, OUT030, OUT031, OUT027, OUT028 (Fresh Gampaha). If
                    any is missing it stops: outlets come from
                    seed_reference_data.py, not from here.

It writes nothing to calendar_days, users, allocations or any other team's
table, and changes no schema.

    python scripts/seed_loader_neon.py --dry-run                          # local DB
    python scripts/seed_loader_neon.py --dry-run --i-know-this-is-neon    # Neon, read-only
    python scripts/seed_loader_neon.py --i-know-this-is-neon              # Neon, writes

--dry-run opens a READ ONLY transaction and prints every row it would add.
A non-local database is refused unless --i-know-this-is-neon is passed.
"""
from __future__ import annotations

import argparse
import sys
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

# Allow running as `python scripts/seed_loader_neon.py` from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every model)
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.delivery_run import (
    DeliveryRun,
    RunOrderState,
    RunStatus,
    RunStop,
    RunStopOrder,
    StopStatus,
)
from app.models.fleet import Vehicle, VehicleStatus
from app.models.loader_activity import ActorKind, LoaderActivity
from app.models.loader_user import LoaderUser
from app.models.order import Order, OrderStatus
from app.models.plan_revision import PlanRevision
from app.models.reference import (
    Brand,
    Depot,
    Dock,
    DockTablet,
    Outlet,
    TemperatureClass,
)

# Asia/Colombo is UTC+05:30 all year (no DST). Stored datetimes are naive UTC.
DEPOT_UTC_OFFSET = timedelta(hours=5, minutes=30)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}

DOCK_CODE = "DOCK3"
TABLET_LABEL = "Dock tablet 3"

# full name, short name, PIN - as in frontend/lib/loader/mock-data.ts
LOADERS = [
    ("Saman Jayawardena", "Saman J.", "4417"),
    ("Tharindu Jayasuriya", "Tharindu J.", "2580"),
    ("Nimal Silva", "Nimal S.", "1357"),
]

# Used only when fleet has no Peliyagoda reefer truck. Loader-only code.
FALLBACK_VEHICLE = {
    "code": "LDR-VEH-01",
    "vehicle_type": "truck",
    "capacity_kg": 6000.0,
    "capacity_vol_m3": 24.0,
    "temperature_mode": "reefer",
    "depot_name": "peliyagoda",
}

# Delivery order. ETAs follow the booklet: Gampaha is 37 min out of the depot,
# then 9 min between stops; Fresh handling is 15 min rear dock, 16 min street.
STOPS = [
    # seq, outlet, ETA (depot time), handling minutes
    (1, "OUT026", "04:07", 15),
    (2, "OUT030", "04:31", 15),
    (3, "OUT031", "04:55", 15),
    (4, "OUT027", "05:19", 16),
]

# suffix, outlet, temperature, units, kg, m3 - a dry and a chilled order per stop
RUN_ORDERS = [
    ("01", "OUT026", "ambient", 56, 820.0, 4.0),
    ("02", "OUT026", "chilled", 46, 690.0, 3.2),
    ("03", "OUT030", "ambient", 50, 740.0, 3.6),
    ("04", "OUT030", "chilled", 30, 440.0, 2.2),
    ("05", "OUT031", "ambient", 48, 700.0, 3.4),
    ("06", "OUT031", "chilled", 34, 500.0, 2.4),
    ("07", "OUT027", "ambient", 44, 650.0, 3.2),
    ("08", "OUT027", "chilled", 26, 380.0, 1.9),
]

# Not on plan v1: deferred yesterday, for the dispatcher to add with a plan change.
EXTRA_ORDER = ("09", "OUT028", "ambient", 40, 590.0, 2.8)

OUTLET_CODES = sorted({row[1] for row in RUN_ORDERS} | {EXTRA_ORDER[1]})

DEPARTS = "03:30"
NOTE = "Loader demo order (scripts/seed_loader_neon.py)."


# --------------------------------------------------------------------------
# Guards and time helpers
# --------------------------------------------------------------------------

def check_target(neon_ok: bool) -> str:
    url = make_url(settings.DATABASE_URL)
    host = (url.host or "").lower()
    target = f"{host or 'local'}/{url.database}"
    if host not in LOCAL_HOSTS and not neon_ok:
        raise SystemExit(
            f"REFUSING: '{target}' is not a local database.\n"
            "This writes demo rows into a shared database. If that is what you mean,\n"
            "run --dry-run --i-know-this-is-neon first, then --i-know-this-is-neon."
        )
    return target


def depot_today() -> date:
    return (datetime.now(UTC) + DEPOT_UTC_OFFSET).date()


def at(day: date, hhmm: str) -> datetime:
    """Depot-local HH:MM on `day` as the naive UTC value the database stores."""
    hour, minute = (int(part) for part in hhmm.split(":"))
    return datetime.combine(day, time(hour, minute)) - DEPOT_UTC_OFFSET


def _id(row) -> int | None:
    return row.id if row is not None else None


# --------------------------------------------------------------------------
# Insert-if-missing
# --------------------------------------------------------------------------

class Seeder:
    def __init__(self, db: Session, dry_run: bool):
        self.db = db
        self.dry_run = dry_run
        self.added: list[str] = []
        self.kept: list[str] = []

    def find(self, model, **match):
        # A parent that does not exist yet (dry run) has no id, so nothing can
        # hang off it in the database either.
        if any(value is None for value in match.values()):
            return None
        return self.db.execute(select(model).filter_by(**match)).scalars().first()

    def ensure(self, model, match: dict, values: dict, label: str):
        existing = self.find(model, **match)
        if existing is not None:
            self.kept.append(f"{model.__tablename__:<18} {label}")
            return existing
        self.added.append(f"{model.__tablename__:<18} {label}")
        if self.dry_run:
            return None
        row = model(**match, **values)
        self.db.add(row)
        self.db.flush()
        return row


# --------------------------------------------------------------------------
# The scenario
# --------------------------------------------------------------------------

def pick_vehicle(s: Seeder) -> Vehicle | None:
    """First Peliyagoda reefer truck in fleet that is not out of service."""
    vehicle = s.db.execute(
        select(Vehicle)
        .where(
            func.lower(Vehicle.vehicle_type) == "truck",
            func.lower(Vehicle.temperature_mode) == "reefer",
            func.lower(Vehicle.depot_name) == "peliyagoda",
            Vehicle.status != VehicleStatus.UNAVAILABLE,
        )
        .order_by(Vehicle.code)
    ).scalars().first()
    if vehicle is not None:
        s.kept.append(f"{'vehicles':<18} {vehicle.code} (reused from fleet, unchanged)")
        return vehicle
    return s.ensure(
        Vehicle,
        {"code": FALLBACK_VEHICLE["code"]},
        {k: v for k, v in FALLBACK_VEHICLE.items() if k != "code"},
        f"{FALLBACK_VEHICLE['code']} (no Peliyagoda reefer truck in fleet)",
    )


def load_outlets(s: Seeder) -> dict[str, Outlet]:
    outlets = {
        o.code: o
        for o in s.db.execute(select(Outlet).where(Outlet.code.in_(OUTLET_CODES))).scalars()
    }
    missing = [code for code in OUTLET_CODES if code not in outlets]
    if missing:
        raise SystemExit(
            f"Missing outlets {', '.join(missing)}. They come from the brief's outlets.csv "
            "(scripts/seed_reference_data.py); this script does not create outlets."
        )
    return outlets


def order_values(day: date, outlet: Outlet, temperature: str, units: int, kg: float,
                 m3: float, status: OrderStatus) -> dict:
    window = (
        f"{outlet.window_start:%H:%M}–{outlet.window_end:%H:%M}"
        if outlet.window_start and outlet.window_end else None
    )
    chilled = temperature == "chilled"
    return {
        "client_name": f"{outlet.name} ({outlet.code})",
        "destination_address": f"{outlet.name}, {outlet.district}",
        "status": status,
        "total_amount": round(kg * 120, 2),
        "brand": Brand.FRESH.label,
        "district": outlet.district,
        "temperature_zone": "Chilled" if chilled else "Ambient",
        "delivery_window": window,
        "weight_kg": kg,
        "is_priority": False,
        "is_late": False,
        "operating_date": day.isoformat(),
        "outlet_id": outlet.id,
        "temperature_class": TemperatureClass.CHILLED if chilled else TemperatureClass.AMBIENT,
        "units": units,
        "volume_m3": m3,
        # Store Manager (0004): placed two days ahead, before the 16:00 cutoff
        # the day before. placed_by stays empty - there is no store user to name.
        "submitted_at": at(day - timedelta(days=2), "10:15"),
        "cutoff_at": at(day - timedelta(days=1), "16:00"),
        "notes": NOTE,
        "placed_by": None,
    }


def seed(s: Seeder, day: date) -> str:
    tag = day.strftime("%m%d")
    run_code = f"LDR-RUN-{tag}"
    eve = day - timedelta(days=1)
    # Plan v1 is published at 21:40 the evening before - unless that is still
    # ahead (a future --date), when it is "10 minutes ago", so the Log never
    # shows the plan arriving after the loader's own ticks.
    now = datetime.now(UTC).replace(tzinfo=None)
    published_at = min(at(eve, "21:40"), now - timedelta(minutes=10))
    acknowledged_at = published_at + timedelta(minutes=5)

    dock = s.ensure(Dock, {"code": DOCK_CODE},
                    {"name": "Dock 3", "depot": Depot.PELIYAGODA}, "DOCK3 Dock 3 (Peliyagoda)")
    s.ensure(DockTablet, {"label": TABLET_LABEL},
             {"dock_id": _id(dock), "device_token": None, "is_active": True}, TABLET_LABEL)

    loaders = {}
    for full_name, short_name, pin in LOADERS:
        loaders[short_name] = s.ensure(
            LoaderUser, {"full_name": full_name},
            {"short_name": short_name, "pin_hash": get_password_hash(pin),
             "home_dock_id": _id(dock), "is_active": True},
            f"{short_name} (PIN {pin})",
        )
    saman = loaders["Saman J."]

    vehicle = pick_vehicle(s)
    outlets = load_outlets(s)

    orders = {}
    for suffix, outlet_code, temp, units, kg, m3 in RUN_ORDERS:
        number = f"LDR-{tag}-{suffix}"
        orders[number] = s.ensure(
            Order, {"order_number": number},
            order_values(day, outlets[outlet_code], temp, units, kg, m3, OrderStatus.ALLOCATED),
            f"{number} {outlet_code} {temp} {units} u {kg:g} kg",
        )
    number = f"LDR-{tag}-{EXTRA_ORDER[0]}"
    _, outlet_code, temp, units, kg, m3 = EXTRA_ORDER
    extra = order_values(day, outlets[outlet_code], temp, units, kg, m3, OrderStatus.DEFERRED)
    extra.update(deferral_reason="Vehicle full yesterday; must go today.", deferral_count=1)
    s.ensure(Order, {"order_number": number}, extra,
             f"{number} {outlet_code} {temp} (deferred, not on plan v1)")

    # The run and everything under it are one unit: if the run exists it is
    # left exactly as it is, however far a demo has moved it.
    existing = s.find(DeliveryRun, code=run_code)
    if existing is not None:
        s.kept.append(f"{'delivery_runs':<18} {run_code} (and its stops, rows, plan) - left as is")
        return run_code

    planned_kg = round(sum(row[4] for row in RUN_ORDERS), 2)
    planned_m3 = round(sum(row[5] for row in RUN_ORDERS), 2)
    run = s.ensure(
        DeliveryRun, {"code": run_code},
        {"vehicle_id": _id(vehicle), "dock_id": _id(dock), "trip_number": 1,
         "brand": Brand.FRESH, "district": "Gampaha", "wave": "night",
         "departs_at": at(day, DEPARTS), "status": RunStatus.NOT_STARTED,
         "current_plan_version": 1,
         "planned_weight_kg": planned_kg, "planned_volume_m3": planned_m3,
         "loaded_weight_kg": 0.0, "loaded_volume_m3": 0.0},
        f"{run_code} Fresh Gampaha night, departs {day} {DEPARTS}, "
        f"{vehicle.code if vehicle else FALLBACK_VEHICLE['code']}, {planned_kg:g} kg",
    )

    s.ensure(
        PlanRevision, {"run_id": _id(run), "version": 1},
        {"published_at": published_at, "source": "Dispatcher",
         "summary": "Initial plan for the night wave.",
         "planned_weight_kg": planned_kg, "planned_volume_m3": planned_m3,
         "acknowledged_at": acknowledged_at, "acknowledged_by_id": _id(saman)},
        f"{run_code} plan v1 (acknowledged by Saman J.)",
    )

    for sequence, outlet_code, eta, handling in STOPS:
        stop = s.ensure(
            RunStop, {"run_id": _id(run), "plan_version": 1, "stop_sequence": sequence},
            # Delivery order reversed: the last stop is loaded first, deepest.
            {"load_position": len(STOPS) - sequence + 1, "outlet_id": outlets[outlet_code].id,
             "eta": at(day, eta), "handling_minutes": handling, "status": StopStatus.PENDING},
            f"{run_code} stop {sequence} {outlet_code} ETA {eta}",
        )
        for suffix, code, temp, units, kg, m3 in RUN_ORDERS:
            if code != outlet_code:
                continue
            number = f"LDR-{tag}-{suffix}"
            s.ensure(
                RunStopOrder, {"run_stop_id": _id(stop), "order_id": _id(orders[number])},
                {"plan_version": 1, "state": RunOrderState.TO_LOAD,
                 "units": units, "weight_kg": kg, "volume_m3": m3},
                f"{run_code} stop {sequence} {number} to load",
            )

    for when, kind, event, label, actor, message in [
        (published_at, ActorKind.DISPATCHER, "plan_published", "Dispatcher", None,
         "Dispatcher published plan v1"),
        (acknowledged_at, ActorKind.LOADER, "plan_acknowledged", "Saman J.", saman,
         "Acknowledged · Saman J."),
    ]:
        s.ensure(
            LoaderActivity, {"run_id": _id(run), "at": when, "event_type": event},
            {"actor_kind": kind, "actor_id": _id(actor), "actor_label": label,
             "order_id": None, "message": message},
            f"{run_code} log {when + DEPOT_UTC_OFFSET:%Y-%m-%d %H:%M} depot time {event}",
        )
    return run_code


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--date", type=date.fromisoformat, default=None,
                        help="operating day, YYYY-MM-DD (default: today, depot time)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print what would be added; read-only transaction")
    parser.add_argument("--i-know-this-is-neon", action="store_true",
                        help="allow a non-local (shared) database")
    args = parser.parse_args()

    day = args.date or depot_today()
    target = check_target(args.i_know_this_is_neon)
    mode = "DRY RUN (read-only, nothing written)" if args.dry_run else "WRITE"
    print(f"Target: {target}   Day: {day}   Mode: {mode}\n")

    db = SessionLocal()
    try:
        if args.dry_run and db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION READ ONLY"))
        s = Seeder(db, dry_run=args.dry_run)
        run_code = seed(s, day)
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()

    verb = "Would add" if args.dry_run else "Added"
    print(f"{verb} {len(s.added)} rows:")
    for line in s.added or ["(nothing - everything already exists)"]:
        print(f"  + {line}")
    print(f"\nAlready there, left unchanged ({len(s.kept)}):")
    for line in s.kept or ["(none)"]:
        print(f"  = {line}")
    print(f"\nSign in on Dock tablet 3 as Saman J. / 4417 and open {run_code}.")


if __name__ == "__main__":
    main()
