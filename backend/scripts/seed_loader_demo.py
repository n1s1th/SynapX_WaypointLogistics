"""Seed the Figma loader scenario into a LOCAL database.

Source of truth is the Figma page "02 - Loader", specifically the frame
"Changes from the brief - data check", which quotes vehicles.csv, outlets.csv and
calendar.csv directly. The CSVs themselves are not in the repo.

The scenario is seeded at t0 - the state BEFORE the story moves - so the dev-only
simulate endpoints drive it forward:

    RUN-021  loading on plan v2, 5 of 8 orders in
             -> POST /loader/dev/runs/RUN-021/plan-change publishes v3
    RUN-027  ORD0092314 flagged Missing, awaiting a dispatcher decision
             -> POST /loader/dev/issues/{id}/decide applies "Move to VEH036"
             -> POST /loader/dev/issues/{id}/expire applies the default instead

Run it against local Postgres only:

    . .\\scripts\\local_db.ps1
    python scripts/seed_loader_demo.py            # idempotent, safe to repeat
    python scripts/seed_loader_demo.py --reset    # wipe loader data first

The shared Neon database must never be seeded (docs/reference/loader/LOADER_FEATURES.md ->
Rules for Claude Code), so this script refuses any non-local host outright.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

# Allow running as `python scripts/seed_loader_demo.py` from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

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
from app.models.fleet import Vehicle
from app.models.loader_activity import ActorKind, CheckAction, LoaderActivity, LoadingCheck, RunReleaseAction
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue, LoaderIssueOption
from app.models.loader_user import LoaderSession, LoaderUser
from app.models.order import Order, OrderStatus
from app.models.plan_revision import PlanRevision, PlanRevisionChange
from app.models.reference import (
    Brand,
    CalendarDay,
    Depot,
    Dock,
    DockTablet,
    DockType,
    Outlet,
    TempCapability,
    TemperatureClass,
    VehicleType,
)
from app.services.loader_service import LoaderService

# The operating day the whole scenario sits on. Plans are published the evening
# before (EVE). Both are depot dates; every time below is depot-local too.
DAY = date(2026, 5, 28)
EVE = DAY - timedelta(days=1)

# Asia/Colombo is UTC+05:30 all year (no DST), so a fixed offset is exact and
# does not depend on a tz database, which Windows Python does not ship.
DEPOT_UTC_OFFSET = timedelta(hours=5, minutes=30)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def guard_local_database() -> str:
    """Abort unless DATABASE_URL points at a local host.

    backend/.env points at the shared Neon database, so running this script
    without the local_db.ps1 override would seed demo rows into the team's data.
    """
    url = make_url(settings.DATABASE_URL)
    host = (url.host or "").lower()
    if host not in LOCAL_HOSTS:
        raise SystemExit(
            f"REFUSING to seed '{url.database}' on host '{host}'.\n"
            "This script only runs against a local database. Configure the session with:\n"
            "    . .\\scripts\\local_db.ps1"
        )
    return f"{host or 'local'}/{url.database}"


# --------------------------------------------------------------------------
# Reference data, quoted from the Figma "data check" frame
# --------------------------------------------------------------------------

VEHICLES = [
    # code,     type,  temp capability,  max kg,  max m3
    ("VEH001", "truck", "reefer", 5510.0, 26.4),
    ("VEH003", "truck", "reefer", 5510.0, 26.4),
    ("VEH005", "truck", "reefer", 6840.0, 33.4),
    ("VEH012", "truck", "ambient", 4200.0, 24.0),
    ("VEH014", "truck", "ambient", 7200.0, 38.0),
    ("VEH035", "van", "reefer", 1040.0, 7.0),
    ("VEH036", "van", "reefer", 1040.0, 7.0),
]

OUTLETS = [
    # code,     name,               brand,  district,   dock type,   van_only, window
    ("OUT026", "Gampaha North", "fresh", "Gampaha", "rear_dock", False, "03:00", "08:00"),
    ("OUT030", "Gampaha Central", "fresh", "Gampaha", "rear_dock", False, "03:00", "08:00"),
    ("OUT031", "Gampaha East", "fresh", "Gampaha", "rear_dock", False, "03:00", "08:00"),
    ("OUT027", "Gampaha Market St", "fresh", "Gampaha", "street", False, "05:00", "07:30"),
    ("OUT028", "Gampaha South", "fresh", "Gampaha", "street", False, "03:00", "08:00"),
    ("OUT001", "Colombo Fort", "fresh", "Colombo", "street", True, "05:00", "07:30"),
    ("OUT002", "Colombo Kollupitiya", "fresh", "Colombo", "street", True, "05:30", "08:00"),
    ("OUT003", "Colombo Bambalapitiya", "fresh", "Colombo", "street", True, "05:00", "07:30"),
    ("OUT005", "Colombo Borella", "fresh", "Colombo", "rear_dock", False, "04:00", "07:45"),
    ("OUT015", "Style Colombo City Mall", "style", "Colombo", "mall_bay", False, "09:00", "11:00"),
    ("OUT016", "Style Colombo Marina", "style", "Colombo", "mall_bay", False, "09:00", "11:00"),
    ("OUT021", "Tech Colombo One Galle Face", "tech", "Colombo", "mall_bay", False, "10:30", "12:30"),
    ("OUT024", "Tech Colombo Depot Store", "tech", "Colombo", "rear_dock", False, "09:00", "17:00"),
]

LOADERS = [
    # full name,            short name,   PIN
    ("Saman Jayawardena", "Saman J.", "4417"),
    ("Tharindu Jayasuriya", "Tharindu J.", "2290"),
    ("Nimal Senanayake", "Nimal S.", "7735"),
]

# ORD number, outlet, temperature, units, kg, m3
RUN_021_ORDERS = [
    ("ORD0092301", "OUT026", "ambient", 56, 820.0, 4.0),
    ("ORD0092302", "OUT026", "chilled", 46, 690.0, 3.2),
    ("ORD0092303", "OUT030", "ambient", 50, 740.0, 3.6),
    ("ORD0092304", "OUT030", "chilled", 30, 440.0, 2.2),
    ("ORD0092305", "OUT031", "ambient", 48, 700.0, 3.4),
    ("ORD0092306", "OUT031", "chilled", 34, 500.0, 2.4),
    ("ORD0092307", "OUT027", "ambient", 44, 650.0, 3.2),
    ("ORD0092308", "OUT027", "chilled", 26, 380.0, 1.9),
    # Deferred yesterday; the dispatcher adds it in plan v3.
    ("ORD0092319", "OUT028", "ambient", 40, 590.0, 2.8),
]

RUN_027_ORDERS = [
    ("ORD0092311", "OUT001", "ambient", 14, 160.0, 1.1),
    ("ORD0092312", "OUT001", "chilled", 10, 120.0, 0.8),
    ("ORD0092313", "OUT003", "ambient", 18, 190.0, 1.3),
    ("ORD0092314", "OUT003", "chilled", 8, 90.0, 0.6),
    ("ORD0092315", "OUT002", "ambient", 16, 167.0, 1.2),
]

# ETAs use the booklet's method, as the design states it:
#   Gampaha 37 min out of the depot, then 9 min between stops
#   Colombo 24 min out, then 8 min between stops
#   Fresh handling rear_dock 15 min, street 16 min
# Each stop's ETA is the previous ETA plus that stop's handling plus travel, and
# an arrival before the outlet's window opens is held until it opens.

# RUN-021 plan v2: four stops in delivery order.
# load_position is the reverse - the last stop goes in deepest, at the cab.
#
# These are the v2 times: 03:30 + 37 = 04:07 at OUT026, then +15+9 per rear_dock
# stop. The design's checklist screens show 04:32 / 04:56 / 05:20 / 05:44, which
# are the v3 times - in v3 OUT028 is inserted ahead of OUT026 and pushes
# everything back by 25 minutes. Seeding v2 with v3's times would mean the
# scenario started in a state the plan never had.
RUN_021_V2_STOPS = [
    # delivery seq, outlet, ETA, handling minutes
    (1, "OUT026", "04:07", 15),
    (2, "OUT030", "04:31", 15),
    (3, "OUT031", "04:55", 15),
    (4, "OUT027", "05:19", 16),
]

# Colombo: 04:30 + 24 = 04:54, but OUT001 does not open until 05:00, so the first
# stop waits for the window. After that, +16 handling +8 travel per stop.
RUN_027_STOPS = [
    (1, "OUT001", "05:00", 16),
    (2, "OUT003", "05:24", 16),
    (3, "OUT002", "05:48", 16),
]

# Orders already checked at t0. The queue card reads "5 of 8 loaded - Saman J."
RUN_021_LOADED_AT_T0 = {
    "ORD0092307": "01:41",
    "ORD0092305": "01:52",
    "ORD0092306": "01:58",
    "ORD0092303": "02:05",
    "ORD0092301": "02:11",
}

# RUN-027 reads "3 of 5 loaded - Tharindu J."
RUN_027_LOADED_AT_T0 = {
    "ORD0092315": "01:49",
    "ORD0092313": "01:54",
    "ORD0092311": "02:01",
}

# RUN-027's chilled order is not at the dock: flagged Missing at 02:03 and
# waiting on the dispatcher (Figma 3a). Flagged is not loaded, so the queue still
# reads "3 of 5 loaded", but it no longer blocks review - 4 of 5 checked or flagged.
RUN_027_FLAGGED_AT_T0 = {"ORD0092314"}


def at(hhmm: str, day: date = DAY) -> datetime:
    """A depot-local HH:MM on `day`, as the naive UTC value the database stores.

    The design quotes depot time ("departs 03:30"); the backend stores UTC, like
    every other datetime.now(timezone.utc) it writes. So 03:30 on 28 May in
    Colombo is stored as 22:00 on 27 May, and the API sends "…T22:00:00Z".
    """
    hour, minute = (int(part) for part in hhmm.split(":"))
    return datetime.combine(day, time(hour, minute)) - DEPOT_UTC_OFFSET


def as_time(hhmm: str) -> time:
    hour, minute = (int(part) for part in hhmm.split(":"))
    return time(hour, minute)


def upsert(db: Session, model, match: dict, values: dict):
    """Fetch-or-create by natural key, updating the non-key fields either way."""
    stmt = select(model).filter_by(**match)
    instance = db.execute(stmt).scalars().first()
    if instance is None:
        instance = model(**match, **values)
        db.add(instance)
    else:
        for key, value in values.items():
            setattr(instance, key, value)
    db.flush()
    return instance


def reset(db: Session) -> None:
    """Delete loader-owned rows, children first. Leaves other teams' data alone."""
    # Sessions and release actions exist once the tablet has signed in or
    # released against this database (L2, L6); they reference tablets, loaders
    # and runs, so they go first.
    for model in (
        LoadingCheck,
        LoaderActivity,
        RunReleaseAction,
        LoaderSession,
        LoaderIssueOption,
        LoaderIssue,
        RunStopOrder,
        RunStop,
        PlanRevisionChange,
        PlanRevision,
        DeliveryRun,
        DockTablet,
        LoaderUser,
        Dock,
    ):
        db.execute(delete(model))

    # Orders carry loader columns but belong to the wider system, so only the
    # scenario's own orders are removed. They must go before outlets: orders
    # reference outlets via fk_orders_outlet_id_outlets, and deleting outlets
    # first violates it.
    scenario_orders = [row[0] for row in RUN_021_ORDERS + RUN_027_ORDERS]
    db.execute(delete(Order).where(Order.order_number.in_(scenario_orders)))

    # vehicles is Thisaru's fleet table, which allocations reference, so only
    # the scenario's own vehicles go.
    db.execute(delete(Vehicle).where(Vehicle.code.in_([row[0] for row in VEHICLES])))
    for model in (Outlet, CalendarDay):
        db.execute(delete(model))
    db.flush()


def seed_reference(db: Session) -> dict:
    upsert(
        db,
        CalendarDay,
        {"date": DAY},
        {"is_operating": True, "festival_ramp": 0.8, "monsoon": True, "holiday_name": None},
    )
    upsert(
        db,
        CalendarDay,
        {"date": date(2026, 5, 30)},
        {"is_operating": True, "festival_ramp": 1.0, "monsoon": True, "holiday_name": "Poson"},
    )

    vehicles = {}
    for code, vtype, temp, max_kg, max_m3 in VEHICLES:
        vehicles[code] = upsert(
            db,
            Vehicle,
            {"code": code},
            {
                # fleet.Vehicle columns (plain strings), in the loader's vocabulary.
                "vehicle_type": VehicleType(vtype).value,
                "temperature_mode": TempCapability(temp).value,
                "capacity_kg": max_kg,
                "capacity_vol_m3": max_m3,
                "depot_name": Depot.PELIYAGODA.value,
            },
        )

    outlets = {}
    for code, name, brand, district, dock_type, van_only, win_start, win_end in OUTLETS:
        outlets[code] = upsert(
            db,
            Outlet,
            {"code": code},
            {
                "name": name,
                "brand": Brand(brand),
                "district": district,
                "dock_type": DockType(dock_type),
                "van_only": van_only,
                "window_start": as_time(win_start),
                "window_end": as_time(win_end),
                "depot": Depot.PELIYAGODA,
            },
        )

    dock = upsert(
        db,
        Dock,
        {"code": "DOCK3"},
        {"name": "Dock 3", "depot": Depot.PELIYAGODA},
    )
    upsert(
        db,
        DockTablet,
        {"label": "Dock tablet 3"},
        {"dock_id": dock.id, "device_token": "dev-tablet-3", "is_active": True},
    )

    loaders = {}
    for full_name, short_name, pin in LOADERS:
        loaders[short_name] = upsert(
            db,
            LoaderUser,
            {"full_name": full_name},
            {
                "short_name": short_name,
                "pin_hash": get_password_hash(pin),
                "home_dock_id": dock.id,
                "depot": Depot.PELIYAGODA,
                "is_active": True,
            },
        )

    return {"vehicles": vehicles, "outlets": outlets, "dock": dock, "loaders": loaders}


def seed_orders(db: Session, outlets: dict) -> dict:
    orders = {}
    for number, outlet_code, temperature, units, weight, volume in RUN_021_ORDERS + RUN_027_ORDERS:
        outlet = outlets[outlet_code]
        orders[number] = upsert(
            db,
            Order,
            {"order_number": number},
            {
                "client_name": outlet.name,
                "destination_address": f"{outlet.name}, {outlet.district}",
                "status": OrderStatus.PROCESSING,
                "outlet_id": outlet.id,
                "brand": outlet.brand.label,
                "temperature_class": TemperatureClass(temperature),
                "units": units,
                "weight_kg": weight,
                "volume_m3": volume,
            },
        )
    return orders


def seed_run(
    db: Session,
    *,
    code: str,
    vehicle,
    dock,
    trip_number: int,
    brand: Brand,
    district: str,
    wave: str,
    departs: str,
    status: RunStatus,
    plan_version: int,
    arrived: str | None = "00:30",
) -> DeliveryRun:
    """arrived: when the truck pulled in (depot clock, like departs); None
    leaves the run awaiting its truck, hidden from the loader queue."""
    return upsert(
        db,
        DeliveryRun,
        {"code": code},
        {
            "vehicle_id": vehicle.id,
            "dock_id": dock.id,
            "trip_number": trip_number,
            "brand": brand,
            "district": district,
            "wave": wave,
            "departs_at": at(departs),
            "status": status,
            "current_plan_version": plan_version,
            "arrived_at": at(arrived) if arrived else None,
            "arrived_dock_id": dock.id if arrived else None,
        },
    )


def seed_stops_and_orders(
    db: Session,
    run: DeliveryRun,
    stop_spec: list,
    order_spec: list,
    orders: dict,
    outlets: dict,
    plan_version: int,
    loaded_at: dict,
    loader: LoaderUser,
    flagged: frozenset | set = frozenset(),
) -> None:
    """Create stops plus their checklist rows, and mark the t0 checks and flags."""
    total_stops = len(stop_spec)
    orders_by_outlet: dict[str, list] = {}
    for number, outlet_code, _temp, units, weight, volume in order_spec:
        orders_by_outlet.setdefault(outlet_code, []).append((number, units, weight, volume))

    planned_weight = 0.0
    planned_volume = 0.0
    loaded_weight = 0.0
    loaded_volume = 0.0

    for sequence, outlet_code, eta, handling in stop_spec:
        stop = upsert(
            db,
            RunStop,
            {"run_id": run.id, "plan_version": plan_version, "stop_sequence": sequence},
            {
                # Delivery order reversed: the last stop is loaded first, deepest.
                "load_position": total_stops - sequence + 1,
                "outlet_id": outlets[outlet_code].id,
                "eta": at(eta),
                "handling_minutes": handling,
                "status": StopStatus.PENDING,
            },
        )
        for number, units, weight, volume in orders_by_outlet.get(outlet_code, []):
            checked = loaded_at.get(number)
            if checked:
                state = RunOrderState.LOADED
            elif number in flagged:
                state = RunOrderState.FLAGGED
            else:
                state = RunOrderState.TO_LOAD
            upsert(
                db,
                RunStopOrder,
                {"run_stop_id": stop.id, "order_id": orders[number].id},
                {
                    "plan_version": plan_version,
                    "state": state,
                    "units": units,
                    "weight_kg": weight,
                    "volume_m3": volume,
                    "checked_at": at(checked) if checked else None,
                    "checked_by_id": loader.id if checked else None,
                },
            )
            planned_weight += weight
            planned_volume += volume
            if checked:
                loaded_weight += weight
                loaded_volume += volume

        # Status follows the rows, by the same rule the check endpoints apply:
        # all checked -> complete, some -> loading. Hard-coding pending left
        # OUT031 "pending" with both of its orders already loaded.
        db.flush()
        db.refresh(stop, ["orders"])
        LoaderService.refresh_stop_status(stop)

    run.planned_weight_kg = round(planned_weight, 2)
    run.planned_volume_m3 = round(planned_volume, 2)
    run.loaded_weight_kg = round(loaded_weight, 2)
    run.loaded_volume_m3 = round(loaded_volume, 2)
    db.flush()


def seed_checks(db: Session, run: DeliveryRun, loaded_at: dict, loader: LoaderUser) -> None:
    """Append the LoadingCheck history behind the t0 checked rows."""
    rows = db.execute(
        select(RunStopOrder)
        .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
        .where(RunStop.run_id == run.id)
    ).scalars().all()
    by_order_number = {row.order.order_number: row for row in rows}
    for number, hhmm in loaded_at.items():
        row = by_order_number.get(number)
        if row is None:
            continue
        upsert(
            db,
            LoadingCheck,
            {"client_action_id": f"seed-{run.code}-{number}-check"},
            {
                "run_stop_order_id": row.id,
                "action": CheckAction.CHECK,
                "actor_id": loader.id,
                "at": at(hhmm),
                "plan_version": row.plan_version,
            },
        )


def activity(db: Session, run: DeliveryRun, hhmm: str, kind: ActorKind, event: str,
             message: str, actor: LoaderUser | None = None, label: str | None = None,
             order: Order | None = None) -> None:
    upsert(
        db,
        LoaderActivity,
        {"run_id": run.id, "at": at(hhmm), "event_type": event},
        {
            "actor_kind": kind,
            "actor_id": actor.id if actor else None,
            "actor_label": label or (actor.short_name if actor else None),
            "order_id": order.id if order else None,
            "message": message,
        },
    )


def seed_scenario(db: Session) -> None:
    ref = seed_reference(db)
    vehicles, outlets, dock, loaders = ref["vehicles"], ref["outlets"], ref["dock"], ref["loaders"]
    orders = seed_orders(db, outlets)

    saman = loaders["Saman J."]
    tharindu = loaders["Tharindu J."]
    nimal = loaders["Nimal S."]

    # --- RUN-021: the core flow, mid-load on plan v2 -----------------------
    run_021 = seed_run(
        db, code="RUN-021", vehicle=vehicles["VEH001"], dock=dock, trip_number=1,
        brand=Brand.FRESH, district="Gampaha", wave="night", departs="03:30",
        status=RunStatus.LOADING, plan_version=2,
    )
    v2_orders = [row for row in RUN_021_ORDERS if row[0] != "ORD0092319"]
    seed_stops_and_orders(
        db, run_021, RUN_021_V2_STOPS, v2_orders, orders, outlets,
        plan_version=2, loaded_at=RUN_021_LOADED_AT_T0, loader=saman,
    )
    seed_checks(db, run_021, RUN_021_LOADED_AT_T0, saman)
    upsert(
        db, PlanRevision, {"run_id": run_021.id, "version": 2},
        {
            "published_at": at("21:40", day=EVE),
            "source": "Dispatcher",
            "summary": "Initial plan for the night wave.",
            "planned_weight_kg": run_021.planned_weight_kg,
            "planned_volume_m3": run_021.planned_volume_m3,
            "acknowledged_at": at("21:45", day=EVE),
            "acknowledged_by_id": saman.id,
        },
    )
    activity(db, run_021, "01:41", ActorKind.LOADER, "order_checked",
             "ORD0092307 loaded", actor=saman, order=orders["ORD0092307"])
    activity(db, run_021, "02:11", ActorKind.LOADER, "order_checked",
             "ORD0092301 loaded", actor=saman, order=orders["ORD0092301"])

    # --- RUN-027: D2, chilled order missing, awaiting a decision -----------
    run_027 = seed_run(
        db, code="RUN-027", vehicle=vehicles["VEH035"], dock=dock, trip_number=1,
        brand=Brand.FRESH, district="Colombo", wave="night", departs="04:30",
        status=RunStatus.ISSUE_FLAGGED, plan_version=1,
    )
    seed_stops_and_orders(
        db, run_027, RUN_027_STOPS, RUN_027_ORDERS, orders, outlets,
        plan_version=1, loaded_at=RUN_027_LOADED_AT_T0, loader=tharindu,
        flagged=RUN_027_FLAGGED_AT_T0,
    )
    seed_checks(db, run_027, RUN_027_LOADED_AT_T0, tharindu)
    upsert(
        db, PlanRevision, {"run_id": run_027.id, "version": 1},
        {
            "published_at": at("21:40", day=EVE),
            "source": "Dispatcher",
            "summary": "Initial plan for the night wave.",
            "planned_weight_kg": run_027.planned_weight_kg,
            "planned_volume_m3": run_027.planned_volume_m3,
            "acknowledged_at": at("21:50", day=EVE),
            "acknowledged_by_id": tharindu.id,
        },
    )

    issue = upsert(
        db,
        LoaderIssue,
        {"run_id": run_027.id, "order_id": orders["ORD0092314"].id},
        {
            "issue_type": IssueType.MISSING,
            "units_affected": 8,
            "units_total": 8,
            "quick_note_tag": None,
            "note": "Chilled order not at the dock.",
            "reported_by_id": tharindu.id,
            "reported_at": at("02:03"),
            "status": IssueStatus.SENT,
            # Decide-by is departure minus 20 minutes.
            "decide_by": at("04:10"),
        },
    )
    for position, (label, detail, is_default) in enumerate(
        [
            ("Send without it", "OUT003 gets its dry order only; chilled follows tomorrow.", False),
            ("Move to VEH036 · Trip 1", "VEH036 is a reefer van on the same district.", False),
            ("Hold VEH035", "Delays every stop on the run.", False),
        ]
    ):
        upsert(
            db,
            LoaderIssueOption,
            {"issue_id": issue.id, "label": label},
            {"detail": detail, "is_default": is_default, "is_chosen": False, "position": position},
        )
    # If nobody answers by 04:10 the truck still has to leave.
    default_option = db.execute(
        select(LoaderIssueOption).filter_by(issue_id=issue.id, label="Send without it")
    ).scalars().one()
    default_option.is_default = True

    activity(db, run_027, "02:03", ActorKind.LOADER, "issue_flagged",
             "ORD0092314: missing 8 of 8 units, sent to Dispatcher", actor=tharindu,
             order=orders["ORD0092314"])

    # --- Remaining runs: queue-level only ---------------------------------
    # Their per-order breakdown is not pinned down in Figma (the RUN-022
    # checklist frames show a different plan version and different outlets from
    # its own queue card), and they belong to L3/L6. Seeded to match exactly
    # what the queue cards state, so the queue is complete; confirm the
    # checklist detail with Sanduni when L3/L6 land.
    seed_run(
        db, code="RUN-022", vehicle=vehicles["VEH005"], dock=dock, trip_number=1,
        brand=Brand.FRESH, district="Colombo", wave="night", departs="03:40",
        status=RunStatus.READY_TO_DEPART, plan_version=1,
    ).released_by_id = nimal.id
    run_022 = db.execute(select(DeliveryRun).filter_by(code="RUN-022")).scalars().one()
    run_022.released_at = at("01:48")
    run_022.release_notified_at = run_022.released_at  # an old release: nobody to tell now

    seed_run(
        db, code="RUN-029", vehicle=vehicles["VEH005"], dock=dock, trip_number=2,
        brand=Brand.FRESH, district="Colombo", wave="night", departs="05:20",
        status=RunStatus.NOT_STARTED, plan_version=1, arrived="01:10",  # at the dock, free to pick
    )
    seed_run(
        db, code="RUN-031", vehicle=vehicles["VEH014"], dock=dock, trip_number=1,
        brand=Brand.STYLE, district="Colombo", wave="day", departs="08:20",
        status=RunStatus.NOT_STARTED, plan_version=1, arrived=None,  # truck not in yet
    )
    seed_run(
        db, code="RUN-033", vehicle=vehicles["VEH012"], dock=dock, trip_number=1,
        brand=Brand.TECH, district="Colombo", wave="day", departs="09:10",
        status=RunStatus.NOT_STARTED, plan_version=1, arrived=None,  # truck not in yet
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete loader rows and the scenario's orders before seeding",
    )
    args = parser.parse_args()

    target = guard_local_database()
    db = SessionLocal()
    try:
        if args.reset:
            reset(db)
            print("Cleared existing loader data.")
        seed_scenario(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"Seeded the Figma loader scenario into {target}.")
    print("  RUN-021  VEH001  loading on plan v2, 5 of 8 orders in")
    print("  RUN-027  VEH035  ORD0092314 flagged Missing, awaiting a decision")
    print("  plus RUN-022, RUN-029, RUN-031, RUN-033 at queue level")


if __name__ == "__main__":
    main()
