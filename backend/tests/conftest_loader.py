"""Shared loader fixtures.

Imported by the loader test modules. Kept out of tests/conftest.py so the
existing fixtures other teams rely on are untouched.
"""
from datetime import datetime, time

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_password_hash
from app.models.allocation import Allocation, AllocationStatus
from app.models.delivery_run import (
    DeliveryRun,
    RunOrderState,
    RunStatus,
    RunStop,
    RunStopOrder,
)
from app.models.fleet import Vehicle
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue, LoaderIssueOption
from app.models.loader_user import LoaderUser
from app.models.order import Order, OrderStatus
from app.models.plan_revision import PlanRevision
from app.models.shipment import DispatchTrip
from app.models.reference import (
    Brand,
    Depot,
    Dock,
    DockType,
    Outlet,
    TempCapability,
    TemperatureClass,
    VehicleType,
)

DAY = "2026-05-28"


@pytest.fixture
def loader_client(db_session):
    """A TestClient that reads the SAME session the test seeds into.

    The shared `client` fixture overrides app.core.database.get_db, but the
    endpoints depend on app.api.deps.get_db - a separate function with its own
    SessionLocal. Existing tests do not notice because they create their data
    through the API, so everything consistently uses the app's own engine. Tests
    that seed through db_session and then read over HTTP do notice: the rows land
    in a different in-memory database. Overriding both keeps them in one place.
    """
    from app.api import deps
    from app.core.database import get_db
    from app.main import app

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[deps.get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def at(hhmm: str) -> datetime:
    return datetime.fromisoformat(f"{DAY}T{hhmm}:00")


def make_vehicle(db, code="VEH001", vtype=VehicleType.TRUCK, temp=TempCapability.REEFER,
                 max_kg=5510.0, max_m3=26.4) -> Vehicle:
    vehicle = Vehicle(
        code=code, vehicle_type=vtype.value, temperature_mode=temp.value,
        capacity_kg=max_kg, capacity_vol_m3=max_m3, depot_name=Depot.PELIYAGODA.value,
    )
    db.add(vehicle)
    db.flush()
    return vehicle


def make_dock(db, code="DOCK3", name="Dock 3") -> Dock:
    dock = Dock(code=code, name=name, depot=Depot.PELIYAGODA)
    db.add(dock)
    db.flush()
    return dock


def make_loader(db, full_name="Saman Jayawardena", short_name="Saman J.") -> LoaderUser:
    user = LoaderUser(
        full_name=full_name, short_name=short_name,
        pin_hash=get_password_hash("4417"), is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def make_outlet(db, code, dock_type=DockType.REAR_DOCK, van_only=False,
                brand=Brand.FRESH, district="Gampaha") -> Outlet:
    outlet = Outlet(
        code=code, name=f"Outlet {code}", brand=brand, district=district,
        dock_type=dock_type, van_only=van_only,
        window_start=time(3, 0), window_end=time(8, 0), depot=Depot.PELIYAGODA,
    )
    db.add(outlet)
    db.flush()
    return outlet


def make_order(db, number, outlet, temperature=TemperatureClass.AMBIENT,
               units=10, kg=100.0, m3=1.0) -> Order:
    order = Order(
        order_number=number, client_name=outlet.name,
        destination_address=f"{outlet.name}, {outlet.district}",
        status=OrderStatus.PROCESSING, outlet_id=outlet.id, brand=outlet.brand.label,
        temperature_class=temperature, units=units, weight_kg=kg, volume_m3=m3,
    )
    db.add(order)
    db.flush()
    return order


def make_run(db, vehicle, dock, code="RUN-021", status=RunStatus.LOADING,
             plan_version=2, departs="03:30") -> DeliveryRun:
    run = DeliveryRun(
        code=code, vehicle_id=vehicle.id, dock_id=dock.id, trip_number=1,
        brand=Brand.FRESH, district="Gampaha", wave="night",
        departs_at=at(departs), status=status, current_plan_version=plan_version,
    )
    db.add(run)
    db.flush()
    return run


def make_stop(db, run, sequence, load_position, outlet, plan_version=2,
              eta=None) -> RunStop:
    stop = RunStop(
        run_id=run.id, plan_version=plan_version, stop_sequence=sequence,
        load_position=load_position, outlet_id=outlet.id,
        eta=at(eta) if eta else None, handling_minutes=15,
    )
    db.add(stop)
    db.flush()
    return stop


def make_run_order(db, stop, order, state=RunOrderState.TO_LOAD, plan_version=2,
                   checked_by=None, checked_at=None) -> RunStopOrder:
    row = RunStopOrder(
        run_stop_id=stop.id, order_id=order.id, plan_version=plan_version,
        state=state, units=order.units, weight_kg=order.weight_kg,
        volume_m3=order.volume_m3,
        checked_at=at(checked_at) if checked_at else None,
        checked_by_id=checked_by.id if checked_by else None,
    )
    db.add(row)
    db.flush()
    return row


def make_revision(db, run, version=2, acknowledged_by=None) -> PlanRevision:
    revision = PlanRevision(
        run_id=run.id, version=version, published_at=at("21:40"),
        source="Dispatcher",
        acknowledged_at=at("21:45") if acknowledged_by else None,
        acknowledged_by_id=acknowledged_by.id if acknowledged_by else None,
    )
    db.add(revision)
    db.flush()
    return revision


def make_issue(db, run, order, reporter, with_options=True) -> LoaderIssue:
    issue = LoaderIssue(
        run_id=run.id, order_id=order.id, issue_type=IssueType.MISSING,
        units_affected=8, units_total=8, reported_by_id=reporter.id,
        reported_at=at("02:03"), status=IssueStatus.SENT, decide_by=at("04:10"),
    )
    db.add(issue)
    db.flush()
    if with_options:
        for position, (label, is_default) in enumerate(
            [("Send without it", True), ("Move to VEH036 · Trip 1", False), ("Hold VEH035", False)]
        ):
            db.add(
                LoaderIssueOption(
                    issue_id=issue.id, label=label, is_default=is_default,
                    is_chosen=False, position=position,
                )
            )
        db.flush()
    return issue


def build_run_021(db):
    """A four-stop RUN-021 on plan v2, mirroring the seeded scenario's shape.

    Returns (run, orders-by-number).
    """
    vehicle = make_vehicle(db)
    dock = make_dock(db)
    loader = make_loader(db)

    specs = [
        # stop seq, load pos, outlet, [(order, temperature, units, kg, m3, checked_at)]
        (1, 4, "OUT026", [
            ("ORD0092301", TemperatureClass.AMBIENT, 56, 820.0, 4.0, "02:11"),
            ("ORD0092302", TemperatureClass.CHILLED, 46, 690.0, 3.2, None),
        ]),
        (2, 3, "OUT030", [
            ("ORD0092303", TemperatureClass.AMBIENT, 50, 740.0, 3.6, "02:05"),
            ("ORD0092304", TemperatureClass.CHILLED, 30, 440.0, 2.2, None),
        ]),
        (3, 2, "OUT031", [
            ("ORD0092305", TemperatureClass.AMBIENT, 48, 700.0, 3.4, "01:52"),
            ("ORD0092306", TemperatureClass.CHILLED, 34, 500.0, 2.4, "01:58"),
        ]),
        (4, 1, "OUT027", [
            ("ORD0092307", TemperatureClass.AMBIENT, 44, 650.0, 3.2, "01:41"),
            ("ORD0092308", TemperatureClass.CHILLED, 26, 380.0, 1.9, None),
        ]),
    ]

    run = make_run(db, vehicle, dock)
    orders = {}
    planned_kg = planned_m3 = loaded_kg = loaded_m3 = 0.0
    for sequence, load_position, outlet_code, order_specs in specs:
        outlet = make_outlet(db, outlet_code)
        stop = make_stop(db, run, sequence, load_position, outlet)
        for number, temperature, units, kg, m3, checked_at in order_specs:
            order = make_order(db, number, outlet, temperature, units, kg, m3)
            orders[number] = order
            make_run_order(
                db, stop, order,
                state=RunOrderState.LOADED if checked_at else RunOrderState.TO_LOAD,
                checked_by=loader if checked_at else None,
                checked_at=checked_at,
            )
            planned_kg += kg
            planned_m3 += m3
            if checked_at:
                loaded_kg += kg
                loaded_m3 += m3

    # The order the dispatcher adds in v3; not on the run yet.
    out028 = make_outlet(db, "OUT028", dock_type=DockType.STREET)
    orders["ORD0092319"] = make_order(
        db, "ORD0092319", out028, TemperatureClass.AMBIENT, 40, 590.0, 2.8
    )

    run.planned_weight_kg = round(planned_kg, 2)
    run.planned_volume_m3 = round(planned_m3, 2)
    run.loaded_weight_kg = round(loaded_kg, 2)
    run.loaded_volume_m3 = round(loaded_m3, 2)
    make_revision(db, run, version=2, acknowledged_by=loader)
    db.flush()
    return run, orders


def put_on_truck(db, run, number, checked_at="02:12"):
    """Load an order on the run's current plan without going through the API.

    build_run_021 (like the seed, which matches the design's 1c capacity bars)
    has ORD0092308 still in staging at v2, while the plan-change frames have it
    loaded deepest when v3 asks for it back.
    """
    from sqlalchemy import select

    from app.services.loader_service import LoaderService

    row = db.execute(
        select(RunStopOrder)
        .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
        .join(Order, RunStopOrder.order_id == Order.id)
        .where(
            RunStop.run_id == run.id,
            RunStop.plan_version == run.current_plan_version,
            Order.order_number == number,
        )
    ).scalars().one()
    row.state = RunOrderState.LOADED
    row.checked_at = at(checked_at)
    LoaderService.recalculate_capacity(db, run)
    db.flush()
    return row


# --- dispatcher integration (docs/loader/INTEGRATION_DESIGN.md) ----------------


def make_trip(db, vehicle, orders, code="RUN-0024", departs="03:30", stop_sequence=None):
    allocation = Allocation(vehicle_id=vehicle.id, run_id=code, status=AllocationStatus.DISPATCHED)
    db.add(allocation)
    db.flush()
    for order in orders:
        order.allocation_id = allocation.id
    trip = DispatchTrip(
        trip_code=code, allocation_id=allocation.id, vehicle_id=vehicle.id,
        vehicle_number=vehicle.code, driver_name="Unassigned", origin="peliyagoda",
        destination="multiple stops", depot_name="peliyagoda",
        departure_time=at(departs) if departs else None,
        stop_sequence=stop_sequence if stop_sequence is not None else [],
    )
    db.add(trip)
    db.flush()
    return trip


@pytest.fixture
def trip_setup(db_session):
    """VEH014 at Peliyagoda, DOCK3, three Fresh outlets and four orders."""
    db = db_session
    vehicle = make_vehicle(db, code="VEH014")
    dock = make_dock(db)
    out26 = make_outlet(db, "OUT026")
    out27 = make_outlet(db, "OUT027")
    out30 = make_outlet(db, "OUT030")
    out27.window_start = time(2, 30)  # earliest window: first by default
    orders = [
        make_order(db, "ORD1001", out26, units=12, kg=300.0, m3=1.2),
        make_order(db, "ORD1002", out27, temperature=TemperatureClass.CHILLED, units=8, kg=200.0, m3=0.8),
        make_order(db, "ORD1003", out30, units=5, kg=100.0, m3=0.5),
        make_order(db, "ORD1004", out26, units=3, kg=50.0, m3=0.2),
    ]
    db.flush()
    return {"db": db, "vehicle": vehicle, "dock": dock, "orders": orders}
