"""Integration slice 1: dispatch trips become loader runs, and the dispatcher
reads the dock's side back (docs/loader/INTEGRATION_DESIGN.md)."""
import pytest
from sqlalchemy import func, select

from app.models.delivery_run import DeliveryRun, RunOrderState, RunStatus, RunStop, RunStopOrder
from app.models.loader_activity import ActorKind, LoaderActivity
from app.models.order import OrderItem
from app.models.plan_revision import PlanRevision
from app.models.reference import Brand, TemperatureClass
from app.services.loader_service import (
    LoaderService,
    OrderOnAnotherRunError,
    RunCodeTakenError,
    RunNotBuildableError,
)
from tests.conftest_loader import (  # noqa: F401  (loader_client is a fixture)
    at,
    loader_client,
    make_dock,
    make_issue,
    make_loader,
    make_order,
    make_outlet,
    make_run,
    make_run_order,
    make_stop,
    make_trip,
    trip_setup,
)

BASE = "/api/v1/loader"


def stops_of(db, run, version=1):
    return list(
        db.execute(
            select(RunStop).filter_by(run_id=run.id, plan_version=version).order_by(RunStop.stop_sequence)
        ).scalars()
    )


def count(db, model):
    return db.execute(select(func.count()).select_from(model)).scalar()


# --- create_run_for_dispatch_trip ---------------------------------------------


def test_a_trip_becomes_a_run_with_stops_orders_and_plan_v1(trip_setup):
    db, vehicle, orders = trip_setup["db"], trip_setup["vehicle"], trip_setup["orders"]
    # The dispatcher's list names OUT030 first (by outlet_code), then a place
    # name that is no outlet; the rest follow by delivery window.
    trip = make_trip(db, vehicle, orders, stop_sequence=[
        {"id": "s1", "outlet_code": "OUT030", "name": "Outlet OUT030", "eta": "03:55"},
        "Kelaniya",
    ])

    run = LoaderService.create_run_for_dispatch_trip(db, trip)

    assert run.code == "RUN-0024"
    assert run.dispatch_trip_id == trip.id
    assert run.vehicle_id == vehicle.id
    assert run.dock_id == trip_setup["dock"].id
    assert run.status == RunStatus.NOT_STARTED
    assert run.brand == Brand.FRESH
    assert run.district == "Gampaha"
    assert run.departs_at == at("03:30")
    assert run.trip_number == 1
    assert run.current_plan_version == 1
    assert run.planned_weight_kg == 650.0
    assert run.planned_volume_m3 == pytest.approx(2.7)

    stops = stops_of(db, run)
    assert [s.outlet.code for s in stops] == ["OUT030", "OUT027", "OUT026"]
    assert [s.load_position for s in stops] == [3, 2, 1]
    rows = {r.order.order_number: r for s in stops for r in s.orders}
    assert set(rows) == {"ORD1001", "ORD1002", "ORD1003", "ORD1004"}
    assert all(r.state == RunOrderState.TO_LOAD and r.plan_version == 1 for r in rows.values())
    assert rows["ORD1001"].units == 12 and rows["ORD1001"].weight_kg == 300.0

    revision = db.execute(select(PlanRevision).filter_by(run_id=run.id)).scalars().one()
    assert revision.version == 1
    assert revision.source == "Dispatcher"
    assert revision.acknowledged_at is None  # the loader accepts v1 first

    log = db.execute(select(LoaderActivity).filter_by(run_id=run.id)).scalars().one()
    assert log.event_type == "plan_published"
    assert log.actor_kind == ActorKind.DISPATCHER


def test_the_built_run_reads_on_the_loader_api(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    LoaderService.create_run_for_dispatch_trip(db, trip)

    body = loader_client.get(f"{BASE}/runs/RUN-0024").json()
    assert body["status"] == "not_started"
    assert body["current_plan_version"] == 1
    assert body["unacknowledged_plan_version"] == 1
    assert body["orders_total"] == 4


def test_creating_twice_returns_the_same_run(trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    first = LoaderService.create_run_for_dispatch_trip(db, trip)
    counts = [count(db, m) for m in (DeliveryRun, RunStop, RunStopOrder, PlanRevision, LoaderActivity)]
    second = LoaderService.create_run_for_dispatch_trip(db, trip)

    assert second.id == first.id
    assert [count(db, m) for m in (DeliveryRun, RunStop, RunStopOrder, PlanRevision, LoaderActivity)] == counts


def test_the_endpoint_is_201_then_200(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    first = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/run")
    second = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/run")

    assert first.status_code == 201
    assert first.json()["created"] is True
    assert second.status_code == 200
    assert second.json()["created"] is False
    assert first.json()["run_code"] == second.json()["run_code"] == "RUN-0024"
    assert loader_client.post(f"{BASE}/dispatch-trips/999999/run").status_code == 404


def test_units_fall_back_to_the_order_lines_and_temperature_to_the_zone(loader_client, trip_setup):
    db = trip_setup["db"]
    order = trip_setup["orders"][1]
    order.units = None
    order.temperature_class = None
    order.temperature_zone = "Chilled"
    db.add_all([
        OrderItem(order_id=order.id, sku="A", item_name="Milk", quantity=6, unit_price=1.0),
        OrderItem(order_id=order.id, sku="B", item_name="Curd", quantity=4, unit_price=1.0),
    ])
    db.flush()
    db.refresh(order)
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    LoaderService.create_run_for_dispatch_trip(db, trip)

    body = loader_client.get(f"{BASE}/runs/RUN-0024").json()
    row = next(o for s in body["stops"] for o in s["orders"] if o["order_number"] == "ORD1002")
    assert row["units"] == 10
    assert row["temperature_class"] == "chilled"


# --- 422 RUN_NOT_BUILDABLE ------------------------------------------------------


def codes(error: RunNotBuildableError):
    return sorted(v["code"] for v in error.violations)


def test_an_order_without_an_outlet_is_422_and_nothing_is_written(loader_client, trip_setup):
    db = trip_setup["db"]
    trip_setup["orders"][2].outlet_id = None
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    response = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/run")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "RUN_NOT_BUILDABLE"
    assert detail["violations"] == [
        {"code": "ORDER_WITHOUT_OUTLET", "message": "ORD1003 has no outlet.", "order_number": "ORD1003"}
    ]
    assert count(db, DeliveryRun) == 0


def test_every_reason_is_listed_at_once(trip_setup):
    db = trip_setup["db"]
    orders = trip_setup["orders"]
    orders[0].outlet_id = None
    orders[2].brand = "Tech"
    trip = make_trip(db, trip_setup["vehicle"], orders, departs=None)

    with pytest.raises(RunNotBuildableError) as raised:
        LoaderService.create_run_for_dispatch_trip(db, trip)

    assert codes(raised.value) == ["MIXED_BRANDS", "NO_DEPARTURE_TIME", "ORDER_WITHOUT_OUTLET"]


@pytest.mark.parametrize("case, expected", [
    ("no_orders", ["NO_ORDERS"]),
    ("no_allocation", ["NO_ALLOCATION"]),
    ("no_dock", ["NO_DOCK"]),
    ("long_code", ["RUN_CODE_TOO_LONG"]),
])
def test_trips_the_dock_cannot_load_are_422(trip_setup, case, expected):
    db, vehicle, orders = trip_setup["db"], trip_setup["vehicle"], trip_setup["orders"]
    if case == "no_orders":
        trip = make_trip(db, vehicle, [])
    elif case == "no_allocation":
        trip = make_trip(db, vehicle, orders)
        trip.allocation_id = None
    elif case == "no_dock":
        vehicle.depot_name = "kandy"  # DOCK3 is at Peliyagoda
        trip = make_trip(db, vehicle, orders)
    else:
        trip = make_trip(db, vehicle, orders, code="RUN-" + "9" * 20)

    with pytest.raises(RunNotBuildableError) as raised:
        LoaderService.create_run_for_dispatch_trip(db, trip)
    assert codes(raised.value) == expected
    assert count(db, DeliveryRun) == 0


def test_a_named_dock_is_used_or_reported(trip_setup):
    db = trip_setup["db"]
    other = make_dock(db, code="DOCK1", name="Dock 1")
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    with pytest.raises(RunNotBuildableError) as raised:
        LoaderService.create_run_for_dispatch_trip(db, trip, dock_code="DOCK9")
    assert codes(raised.value) == ["NO_DOCK"]

    run = LoaderService.create_run_for_dispatch_trip(db, trip, dock_code="DOCK3")
    assert run.dock_id == trip_setup["dock"].id
    assert other.id != run.dock_id


# --- 409s ----------------------------------------------------------------------


def put_on_other_run(db, setup, order, state=RunOrderState.TO_LOAD, status=RunStatus.LOADING):
    other = make_run(db, setup["vehicle"], setup["dock"], code="LDR-RUN-1002", status=status, plan_version=1)
    stop = make_stop(db, other, 1, 1, order.outlet, plan_version=1)
    make_run_order(db, stop, order, state=state, plan_version=1)
    return other


def test_an_order_already_on_another_run_is_409(loader_client, trip_setup):
    db = trip_setup["db"]
    put_on_other_run(db, trip_setup, trip_setup["orders"][1])
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    response = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/run")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "ORDER_ON_ANOTHER_RUN"
    assert detail["orders"] == [{"order_number": "ORD1002", "run_code": "LDR-RUN-1002"}]
    assert count(db, DeliveryRun) == 1  # only the other run


@pytest.mark.parametrize("state, status", [
    (RunOrderState.MOVED, RunStatus.LOADING),      # dropped from that run's plan
    (RunOrderState.TAKE_OFF, RunStatus.LOADING),   # coming off that truck
    (RunOrderState.TO_LOAD, RunStatus.GATED_OUT),  # that run has left
])
def test_an_order_that_left_the_other_run_is_free(trip_setup, state, status):
    db = trip_setup["db"]
    put_on_other_run(db, trip_setup, trip_setup["orders"][1], state=state, status=status)
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    assert run.dispatch_trip_id == trip.id


def test_a_trip_code_held_by_another_run_is_409(trip_setup):
    db = trip_setup["db"]
    make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="RUN-0024", plan_version=1)
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])

    with pytest.raises(RunCodeTakenError):
        LoaderService.create_run_for_dispatch_trip(db, trip)


def test_the_409_is_raised_by_the_service_too(trip_setup):
    db = trip_setup["db"]
    put_on_other_run(db, trip_setup, trip_setup["orders"][0])
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    with pytest.raises(OrderOnAnotherRunError):
        LoaderService.create_run_for_dispatch_trip(db, trip)


# --- dispatcher_view -------------------------------------------------------------

VIEW_KEYS = {
    "run_code", "status", "dock", "departs_at", "plan_version", "plan_acknowledged",
    "stop_count", "stops_completed", "orders_checked", "orders_total", "open_shortfalls",
    "planned_weight_kg", "loaded_weight_kg", "planned_volume_m3", "loaded_volume_m3",
    "released_at", "released_by", "last_update_at", "loading_events",
}


def test_the_dispatcher_view_has_the_readiness_dialog_shape(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    LoaderService.create_run_for_dispatch_trip(db, trip)

    body = loader_client.get(f"{BASE}/dispatch-trips/{trip.id}/loading").json()

    assert set(body) == VIEW_KEYS
    assert body["run_code"] == "RUN-0024"
    assert body["status"] == "not_started"
    assert body["dock"] == "DOCK3"
    assert body["plan_acknowledged"] is False
    assert (body["stop_count"], body["stops_completed"]) == (3, 0)
    assert (body["orders_checked"], body["orders_total"]) == (0, 4)
    assert body["open_shortfalls"] == 0
    assert body["released_at"] is None
    [event] = body["loading_events"]
    assert {"event", "time", "note", "status"} <= set(event)
    assert event["event"] == "Plan published"
    assert event["note"] == "Dispatcher published plan v1"
    assert event["status"] == "warning"


def test_the_dispatcher_view_follows_the_dock(trip_setup):
    db = trip_setup["db"]
    orders = trip_setup["orders"]
    trip = make_trip(db, trip_setup["vehicle"], orders)
    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    loader = make_loader(db)

    # OUT030 (one order) fully loaded; ORD1002 at OUT027 flagged missing.
    stops = {s.outlet.code: s for s in stops_of(db, run)}
    for row in stops["OUT030"].orders:
        row.state = RunOrderState.LOADED
    LoaderService.refresh_stop_status(stops["OUT030"])
    flagged = next(r for r in stops["OUT027"].orders)
    flagged.state = RunOrderState.FLAGGED
    make_issue(db, run, flagged.order, loader)
    LoaderService.log(
        db, run, at=at("02:03"), actor_kind=ActorKind.LOADER, event_type="issue_flagged",
        actor_id=loader.id, order_id=flagged.order_id,
        message="ORD1002: missing 8 of 8 units, sent to Dispatcher",
    )
    db.flush()

    view = LoaderService.dispatcher_view(db, [trip.id])[trip.id]

    assert view.stops_completed == 1
    assert view.orders_checked == 2  # loaded + flagged resolve their rows
    assert view.open_shortfalls == 1
    shortfall = next(e for e in view.loading_events if e.type == "issue_flagged")
    assert shortfall.status == "error"
    assert shortfall.event == "Shortfall flagged"
    assert shortfall.note == "OUT027 · ORD1002: missing 8 of 8 units, sent to Dispatcher"
    assert shortfall.time == "07:33"  # 02:03 UTC in depot time


# --- runs without a trip (LDR-RUN-1002 and the local seeds) ------------------------


def test_runs_without_a_trip_are_untouched(trip_setup):
    db = trip_setup["db"]
    # Two runs with dispatch_trip_id null, like LDR-RUN-1002 and the local seed.
    seeded = make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="RUN-021", plan_version=1)
    spare = make_order(db, "ORD2001", make_outlet(db, "OUT031"))
    make_run_order(db, make_stop(db, seeded, 1, 1, spare.outlet, plan_version=1), spare, plan_version=1)
    second = make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="LDR-RUN-1002", plan_version=1)
    before = {
        r.id: (r.status, r.current_plan_version, r.planned_weight_kg) for r in (seeded, second)
    }
    rows_before = count(db, RunStopOrder)

    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    LoaderService.create_run_for_dispatch_trip(db, trip)

    assert seeded.dispatch_trip_id is None and second.dispatch_trip_id is None  # NULLs repeat
    assert {
        r.id: (r.status, r.current_plan_version, r.planned_weight_kg) for r in (seeded, second)
    } == before
    assert count(db, RunStopOrder) == rows_before + 4
    view = LoaderService.dispatcher_view(db, [trip.id, 0])
    assert set(view) == {trip.id}
    assert LoaderService.dispatcher_view(db, []) == {}
