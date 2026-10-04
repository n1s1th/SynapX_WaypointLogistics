"""Driver API on loader runs: a run the loader signs off becomes the driver's trip,
and the driver's progress reaches the loader, dispatcher and store.

Built on the loader's trip_setup (VEH014, three Fresh outlets, four orders):
the dispatcher's trip names the driver, the loader builds and releases the run.
"""
import base64
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt
from sqlalchemy import select

from app.api import deps
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.models.delivery_run import RunOrderState, RunStatus, RunStop, RunStopOrder
from app.models.driver import DeliveryStop, DriverAvailability, DriverTrip, SOSAlert
from app.models.allocation import AllocationStatus
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.reference import Depot
from app.models.fleet import DriverProfile, VehicleStatus
from app.models.loader_issue import IssueStatus, IssueType
from app.models.notification import Notification, NotificationType
from app.models.order import OrderStatus
from app.models.shipment import DispatchTrip
from app.models.user import User, UserRole
from app.services.loader_service import LoaderService
from tests.conftest_loader import (  # noqa: F401  (loader_client and trip_setup are fixtures)
    loader_client,
    make_issue,
    make_loader,
    make_outlet,
    make_run_order,
    make_stop,
    make_trip,
    trip_setup,
)

API = "/api/v1/driver"
SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
FLAGGED = "ORD1003"  # the loader couldn't find it: on the plan, not on the truck


def make_driver(db, email="tharindu@waypoint.com", name="Tharindu Fernando", vehicle=None):
    user = User(
        email=email, full_name=name, hashed_password=get_password_hash("driver123"),
        role=UserRole.DRIVER, is_active=True,
    )
    db.add(user)
    db.flush()
    profile = DriverProfile(
        user_id=user.id, license_type="Heavy", phone="0771234567",
        assigned_vehicle_id=vehicle.id if vehicle else None,
    )
    db.add(profile)
    db.flush()
    return user, profile


def auth(user) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def run_rows(db, run):
    return db.execute(
        select(RunStopOrder).join(RunStop, RunStopOrder.run_stop_id == RunStop.id).where(RunStop.run_id == run.id)
    ).scalars().all()


def release(db, run, flagged=(FLAGGED,)):
    """The loader's sign-off: every order checked except the flagged ones."""
    for row in run_rows(db, run):
        row.state = RunOrderState.FLAGGED if row.order.order_number in flagged else RunOrderState.LOADED
    run.status = RunStatus.READY_TO_DEPART
    db.flush()


@pytest.fixture
def dispatched(trip_setup):
    """Dispatcher has sent RUN-0024 to Tharindu; the loader built the run (not released yet)."""
    db = trip_setup["db"]
    driver, profile = make_driver(db)
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    trip.driver_id = profile.id
    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    orders = {order.order_number: order for order in trip_setup["orders"]}
    return {"db": db, "driver": driver, "dispatch_trip": trip, "run": run, "orders": orders}


@pytest.fixture
def released(dispatched):
    release(dispatched["db"], dispatched["run"])
    return dispatched


def today(client, driver):
    res = client.get(f"{API}/trips/today", headers=auth(driver))
    assert res.status_code == 200, res.text
    return res.json()


def trip_detail(client, driver, trip_id):
    res = client.get(f"{API}/trips/{trip_id}", headers=auth(driver))
    assert res.status_code == 200, res.text
    return res.json()


def start(client, driver, trip_id):
    res = client.post(f"{API}/trips/{trip_id}/start", headers=auth(driver))
    assert res.status_code == 200, res.text
    return res.json()


def deliver(client, driver, stop_id, outcome="delivered"):
    assert client.patch(f"{API}/stops/{stop_id}/arrive", headers=auth(driver)).status_code == 200
    res = client.patch(f"{API}/stops/{stop_id}/outcome", headers=auth(driver), json={"outcome": outcome})
    assert res.status_code == 200, res.text
    res = client.post(
        f"{API}/stops/{stop_id}/pod", headers=auth(driver),
        json={"recipient_name": "Malini Perera", "signature_data": SIGNATURE},
    )
    assert res.status_code == 200, res.text


def started_trip(client, setup):
    trip = today(client, setup["driver"])[0]
    start(client, setup["driver"], trip["id"])
    return trip_detail(client, setup["driver"], trip["id"])


# ---- Hand-off from the loader --------------------------------------------------

def departs_soon(db, run):
    """As Quick Allocate plans it: leaving two hours from now."""
    run.departs_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=2)
    db.flush()


def test_dispatched_run_shows_at_once_and_start_waits_for_the_loader(loader_client, dispatched):
    db, driver = dispatched["db"], dispatched["driver"]
    departs_soon(db, dispatched["run"])
    trips = today(loader_client, driver)

    assert len(trips) == 1
    assert trips[0]["status"] == "assigned"
    assert trips[0]["dispatch_trip_id"] == dispatched["dispatch_trip"].id
    assert trips[0]["loader_status"] == "not_started"
    res = loader_client.post(f"{API}/trips/{trips[0]['id']}/start", headers=auth(driver))
    assert res.status_code == 409
    assert "still at the dock" in res.json()["detail"]

    release(db, dispatched["run"])

    assert [t["loader_status"] for t in today(loader_client, driver)] == ["ready_to_depart"]
    assert start(loader_client, driver, trips[0]["id"])["status"] == "started"


def test_trip_waiting_at_the_dock_follows_the_loaders_plan(loader_client, dispatched):
    db, driver, run = dispatched["db"], dispatched["driver"], dispatched["run"]
    departs_soon(db, run)
    trip = today(loader_client, driver)[0]
    assert len(trip_detail(loader_client, driver, trip["id"])["stops"]) == 3

    release(db, run)

    detail = trip_detail(loader_client, driver, trip["id"])
    assert [t["id"] for t in today(loader_client, driver)] == [trip["id"]]  # the same trip, not a second one
    assert detail["loader_status"] == "ready_to_depart"
    assert len(detail["stops"]) == 3


def test_driver_at_the_dock_shows_in_the_loaders_and_dispatchers_logs(loader_client, dispatched):
    from app.models.loader_activity import LoaderActivity

    db, driver, run = dispatched["db"], dispatched["driver"], dispatched["run"]
    departs_soon(db, run)
    trip = today(loader_client, driver)[0]
    assert trip["dock_name"] == "Dock 3"
    assert trip["at_dock_at"] is None

    res = loader_client.post(f"{API}/trips/{trip['id']}/at-dock", headers=auth(driver))
    again = loader_client.post(f"{API}/trips/{trip['id']}/at-dock", headers=auth(driver))

    assert res.status_code == 200, res.text
    assert res.json()["at_dock_at"] is not None
    assert again.json()["at_dock_at"] == res.json()["at_dock_at"]  # saying it twice changes nothing
    logged = db.query(LoaderActivity).filter(LoaderActivity.run_id == run.id, LoaderActivity.event_type == "driver_at_dock").all()
    assert len(logged) == 1
    assert logged[0].message == "Driver at Dock 3 · Tharindu Fernando"  # as the tablet shows it
    db.refresh(run)
    assert run.arrived_at is not None and run.arrived_dock_id == run.dock_id  # the loader's queue sees the truck
    events = db.get(DispatchTrip, dispatched["dispatch_trip"].id).loading_events
    assert [e["event"] for e in events].count("Truck at dock") == 1


def test_at_the_dock_is_refused_once_the_trip_has_left(loader_client, released):
    trip = started_trip(loader_client, released)

    res = loader_client.post(f"{API}/trips/{trip['id']}/at-dock", headers=auth(released["driver"]))

    assert res.status_code == 400


def test_old_run_never_loaded_does_not_show(loader_client, dispatched):
    db, driver, run = dispatched["db"], dispatched["driver"], dispatched["run"]
    run.departs_at = datetime(2026, 1, 1, 3, 30)  # dispatched long ago, never loaded
    db.flush()

    assert today(loader_client, driver) == []


def test_trip_stops_follow_the_run_stop_order(loader_client, released):
    db, driver, run = released["db"], released["driver"], released["run"]
    trip = trip_detail(loader_client, driver, today(loader_client, driver)[0]["id"])

    planned = db.execute(
        select(RunStop).where(RunStop.run_id == run.id, RunStop.plan_version == run.current_plan_version)
        .order_by(RunStop.stop_sequence)
    ).scalars().all()
    stops = sorted(trip["stops"], key=lambda stop: stop["sequence"])
    assert [(s["sequence"], s["customer_name"]) for s in stops] == [
        (rs.stop_sequence, rs.outlet.name) for rs in planned
    ]
    assert all(s["latitude"] and s["longitude"] for s in stops)
    assert all(s["status"] == "pending" for s in stops)
    assert stops[0]["customer_name"] == "Outlet OUT027"  # earliest window goes first
    assert stops[0]["notes"] == "Rear dock · window 02:30-08:00"


def test_trip_shows_planned_departure_and_last_window(loader_client, released):
    trip = trip_detail(loader_client, released["driver"], today(loader_client, released["driver"])[0]["id"])

    assert trip["planned_departure"] == "2026-05-28T03:30:00Z"  # the dispatcher's departure
    assert trip["last_window_closes"] == "08:00"


def test_listing_again_makes_no_duplicates(loader_client, released):
    db, driver = released["db"], released["driver"]
    first = today(loader_client, driver)
    second = today(loader_client, driver)

    assert [t["id"] for t in first] == [t["id"] for t in second]
    assert len(db.execute(select(DriverTrip)).scalars().all()) == 1
    assert len(db.execute(select(DeliveryStop)).scalars().all()) == 3


def test_another_driver_does_not_see_the_run(loader_client, released):
    other, _ = make_driver(released["db"], email="kamal@waypoint.com", name="Kamal Silva")
    assert today(loader_client, other) == []
    assert len(today(loader_client, released["driver"])) == 1


def test_trip_with_no_driver_named_goes_to_the_vehicles_driver(loader_client, trip_setup):
    db = trip_setup["db"]
    driver, _ = make_driver(db, vehicle=trip_setup["vehicle"])
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])  # driver_id left empty
    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    release(db, run)

    assert len(today(loader_client, driver)) == 1


def test_plan_change_before_start_updates_the_stops(loader_client, released):
    db, driver, run = released["db"], released["driver"], released["run"]
    trip_id = today(loader_client, driver)[0]["id"]

    # The dispatcher publishes v2: one new outlet only.
    out40 = make_outlet(db, "OUT040")
    stop = make_stop(db, run, 1, 1, out40, plan_version=2)
    make_run_order(db, stop, released["orders"]["ORD1001"], state=RunOrderState.LOADED, plan_version=2)
    run.current_plan_version = 2
    db.flush()

    today(loader_client, driver)
    stops = trip_detail(loader_client, driver, trip_id)["stops"]
    assert [(s["sequence"], s["customer_name"]) for s in stops] == [(1, "Outlet OUT040")]


# ---- Start: the gate-out ---------------------------------------------------------

def test_start_is_the_gate_out(loader_client, released):
    db, run, orders = released["db"], released["run"], released["orders"]
    trip = today(loader_client, released["driver"])[0]

    body = start(loader_client, released["driver"], trip["id"])

    assert body["status"] == "started"
    db.refresh(run)
    assert run.status == RunStatus.GATED_OUT
    assert run.gated_out_at is not None
    # On the truck: on to dispatched. Flagged by the loader: not dispatched.
    for number in ("ORD1001", "ORD1002", "ORD1004"):
        db.refresh(orders[number])
        assert orders[number].status == OrderStatus.DISPATCHED, number
    db.refresh(orders[FLAGGED])
    assert orders[FLAGGED].status != OrderStatus.DISPATCHED

    dispatch_trip = db.get(DispatchTrip, released["dispatch_trip"].id)
    assert dispatch_trip.status == "en_route"
    assert dispatch_trip.driver_name == "Tharindu Fernando"
    assert dispatch_trip.stop_count == 3
    assert dispatch_trip.loading_events[-1]["event"] == "Left the gate"
    assert dispatch_trip.loading_events[-1]["status"] == "ok"


def test_starting_twice_returns_the_same_trip(loader_client, released):
    trip = today(loader_client, released["driver"])[0]
    first = start(loader_client, released["driver"], trip["id"])
    second = start(loader_client, released["driver"], trip["id"])
    assert first["started_at"] == second["started_at"]


def test_start_is_refused_while_the_run_is_back_at_the_dock(loader_client, released):
    db, run = released["db"], released["run"]
    trip = today(loader_client, released["driver"])[0]
    run.status = RunStatus.LOADING  # a late plan change reopened the checklist
    db.flush()

    res = loader_client.post(f"{API}/trips/{trip['id']}/start", headers=auth(released["driver"]))

    assert res.status_code == 409
    assert "still at the dock" in res.json()["detail"]


# ---- At the stop -------------------------------------------------------------------

def test_stop_detail_lists_every_order_at_the_stop(loader_client, released):
    trip = started_trip(loader_client, released)
    # OUT026 gets two orders (ORD1001 and ORD1004)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT026")

    res = loader_client.get(f"{API}/stops/{stop['id']}", headers=auth(released["driver"]))

    assert res.status_code == 200, res.text
    body = res.json()
    assert sorted(o["order_number"] for o in body["orders"]) == ["ORD1001", "ORD1004"]
    assert body["order"]["order_number"] == body["orders"][0]["order_number"]
    assert all(o["on_truck"] for o in body["orders"])


def test_stop_order_shows_the_loaders_temperature_and_the_outlet_window(loader_client, released):
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT027")

    order = loader_client.get(f"{API}/stops/{stop['id']}", headers=auth(released["driver"])).json()["order"]

    assert order["order_number"] == "ORD1002"
    assert order["temperature_zone"] == "Chilled"  # not the "Ambient" column default
    assert order["delivery_window"] == "02:30-08:00"


def test_flagged_order_shows_as_not_on_the_truck(loader_client, released):
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT030")

    body = loader_client.get(f"{API}/stops/{stop['id']}", headers=auth(released["driver"])).json()

    assert [(o["order_number"], o["on_truck"]) for o in body["orders"]] == [(FLAGGED, False)]
    assert body["orders"][0]["units_loaded"] == 0


def send_short(db, run, order, missing, decision="Send without it"):
    """The loader flags the order short and the dispatcher sends what is there."""
    row = next(r for r in run_rows(db, run) if r.order_id == order.id)
    row.state = RunOrderState.FLAGGED
    issue = make_issue(db, run, order, make_loader(db))
    issue.issue_type = IssueType.SHORT
    issue.units_affected = missing
    issue.units_total = row.units
    issue.status = IssueStatus.DECIDED
    next(o for o in issue.options if o.label == decision).is_chosen = True
    db.flush()


def test_short_order_is_on_the_truck_and_shows_units_loaded(loader_client, released):
    db, orders = released["db"], released["orders"]
    send_short(db, released["run"], orders["ORD1001"], missing=3)  # 9 of 12 go out
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT026")

    body = loader_client.get(f"{API}/stops/{stop['id']}", headers=auth(released["driver"])).json()

    short = next(o for o in body["orders"] if o["order_number"] == "ORD1001")
    assert (short["on_truck"], short["units"], short["units_loaded"]) == (True, 12, 9)
    assert short["shortfall"] == {"reason": "short", "decision": "Send without it"}
    full = next(o for o in body["orders"] if o["order_number"] == "ORD1004")
    assert (full["units"], full["units_loaded"], full["shortfall"]) == (3, 3, None)


def test_short_order_is_dispatched_then_delivered(loader_client, released):
    db, orders = released["db"], released["orders"]
    send_short(db, released["run"], orders["ORD1001"], missing=3)
    trip = started_trip(loader_client, released)

    db.refresh(orders["ORD1001"])
    assert orders["ORD1001"].status == OrderStatus.DISPATCHED  # not left at Ready for dispatch

    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT026")
    deliver(loader_client, released["driver"], stop["id"])

    db.refresh(orders["ORD1001"])
    assert orders["ORD1001"].status == OrderStatus.DELIVERED


def test_delivering_a_stop_tells_the_store_and_the_dispatcher(loader_client, released):
    db, orders = released["db"], released["orders"]
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT026")

    deliver(loader_client, released["driver"], stop["id"])

    for number in ("ORD1001", "ORD1004"):
        db.refresh(orders[number])
        assert orders[number].status == OrderStatus.DELIVERED, number
    db.refresh(orders["ORD1002"])
    assert orders["ORD1002"].status == OrderStatus.DISPATCHED  # another stop
    delivered = db.execute(
        select(Notification).where(Notification.type == NotificationType.DELIVERED)
    ).scalars().all()
    assert len(delivered) == 2

    dispatch_trip = db.get(DispatchTrip, released["dispatch_trip"].id)
    assert dispatch_trip.stops_completed == 1
    assert dispatch_trip.loading_events[-1]["event"] == "Delivered"


def test_failed_stop_keeps_orders_dispatched_and_warns_the_dispatcher(loader_client, released):
    db, orders = released["db"], released["orders"]
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT027")
    driver = released["driver"]

    assert loader_client.patch(f"{API}/stops/{stop['id']}/arrive", headers=auth(driver)).status_code == 200
    res = loader_client.patch(f"{API}/stops/{stop['id']}/outcome", headers=auth(driver), json={"outcome": "failed"})

    assert res.status_code == 200, res.text
    db.refresh(orders["ORD1002"])
    assert orders["ORD1002"].status == OrderStatus.DISPATCHED
    event = db.get(DispatchTrip, released["dispatch_trip"].id).loading_events[-1]
    assert event["event"] == "Not delivered"
    assert event["status"] == "warning"


# ---- What the stores see: ETAs, arrivals, orders sent back ------------------------------

@pytest.fixture
def deferring_allowed(monkeypatch):
    """The order rules once the store side allows DISPATCHED → DEFERRED."""
    from app.services import order_service as order_rules_module
    monkeypatch.setitem(
        order_rules_module.TRANSITIONS, OrderStatus.DISPATCHED, {OrderStatus.DELIVERED, OrderStatus.DEFERRED},
    )


def fail_stop(client, driver, stop_id):
    assert client.patch(f"{API}/stops/{stop_id}/arrive", headers=auth(driver)).status_code == 200
    res = client.patch(f"{API}/stops/{stop_id}/outcome", headers=auth(driver), json={"outcome": "failed"})
    assert res.status_code == 200, res.text


def test_starting_gives_every_store_its_own_eta(loader_client, released):
    db = released["db"]
    trip = started_trip(loader_client, released)
    stops = sorted(trip["stops"], key=lambda s: s["sequence"])

    etas = [datetime.fromisoformat(s["eta"]) for s in stops]
    assert all(eta is not None for eta in etas)
    assert etas == sorted(etas) and len(set(etas)) == len(etas)  # later stop, later ETA
    outlets = {o.outlet_id for o in released["orders"].values()}
    assert {s["outlet_id"] for s in stops} == outlets  # each stop names its store

    dispatch_trip = db.get(DispatchTrip, released["dispatch_trip"].id)
    assert dispatch_trip.estimated_arrival == db.get(DeliveryStop, stops[-1]["id"]).eta


def test_a_delay_moves_the_eta_on_and_tells_the_stores_still_to_come(loader_client, released):
    db, driver, orders = released["db"], released["driver"], released["orders"]
    trip = started_trip(loader_client, released)
    first, *rest = sorted(trip["stops"], key=lambda s: s["sequence"])
    deliver(loader_client, driver, first["id"])
    before = {s["id"]: db.get(DeliveryStop, s["id"]).eta for s in rest}

    res = loader_client.post(f"{API}/trips/{trip['id']}/issues", headers=auth(driver), json={
        "issue_type": "traffic_delay", "description": "Road closed at Kirulapone", "delay_minutes": 30,
    })

    assert res.status_code == 200, res.text
    for stop_id, eta in before.items():
        assert (db.get(DeliveryStop, stop_id).eta - eta).total_seconds() >= 30 * 60
    told = db.execute(select(Notification).where(Notification.type == NotificationType.ETA_UPDATED)).scalars().all()
    waiting_outlets = {db.get(DeliveryStop, s["id"]).outlet_id for s in rest}
    assert told and {n.outlet_id for n in told} <= waiting_outlets
    assert orders[FLAGGED].id not in {n.order_id for n in told}  # not on the truck
    assert db.get(DispatchTrip, released["dispatch_trip"].id).loading_events[-1]["event"] == "Running late"


def test_a_failed_stop_report_sends_its_orders_back_to_dispatch(loader_client, released, deferring_allowed):
    db, driver, orders = released["db"], released["driver"], released["orders"]
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT027")
    fail_stop(loader_client, driver, stop["id"])

    res = loader_client.post(f"{API}/trips/{trip['id']}/issues", headers=auth(driver), json={
        "stop_id": stop["id"], "issue_type": "customer_unavailable", "description": "Outlet closed",
    })

    assert res.status_code == 200, res.text
    db.refresh(orders["ORD1002"])
    assert orders["ORD1002"].status == OrderStatus.DEFERRED
    assert orders["ORD1002"].deferral_reason == "Not delivered: Outlet closed"
    db.refresh(orders["ORD1001"])
    assert orders["ORD1001"].status == OrderStatus.DISPATCHED  # another stop
    deferred = db.execute(select(Notification).where(Notification.type == NotificationType.DEFERRED)).scalars().all()
    assert [n.order_id for n in deferred] == [orders["ORD1002"].id]

    # Sent back: the stop can't be turned into a delivery on this trip
    res = loader_client.patch(f"{API}/stops/{stop['id']}/outcome", headers=auth(driver), json={"outcome": "delivered"})
    assert res.status_code == 409


def test_completing_the_trip_sends_back_an_unreported_failed_stop(loader_client, released, deferring_allowed):
    db, driver, orders = released["db"], released["driver"], released["orders"]
    trip = started_trip(loader_client, released)
    for stop in trip["stops"]:
        if stop["customer_name"] == "Outlet OUT027":
            fail_stop(loader_client, driver, stop["id"])
        else:
            deliver(loader_client, driver, stop["id"])

    assert loader_client.post(f"{API}/trips/{trip['id']}/complete", headers=auth(driver)).status_code == 200

    db.refresh(orders["ORD1002"])
    assert orders["ORD1002"].status == OrderStatus.DEFERRED


def test_until_dispatch_allows_it_a_failed_stops_orders_stay_dispatched(loader_client, released):
    db, driver, orders = released["db"], released["driver"], released["orders"]
    trip = started_trip(loader_client, released)
    stop = next(s for s in trip["stops"] if s["customer_name"] == "Outlet OUT027")
    fail_stop(loader_client, driver, stop["id"])

    res = loader_client.post(f"{API}/trips/{trip['id']}/issues", headers=auth(driver), json={
        "stop_id": stop["id"], "issue_type": "customer_unavailable", "description": "Outlet closed",
    })

    assert res.status_code == 200, res.text
    db.refresh(orders["ORD1002"])
    assert orders["ORD1002"].status == OrderStatus.DISPATCHED


def test_trip_shows_the_run_code_and_truck(loader_client, released):
    driver = released["driver"]

    trip = today(loader_client, driver)[0]

    assert (trip["run_code"], trip["vehicle_number"]) == ("RUN-0024", "VEH014")
    detail = trip_detail(loader_client, driver, trip["id"])
    assert (detail["run_code"], detail["vehicle_number"]) == ("RUN-0024", "VEH014")


def test_trip_shows_the_trucks_depot(loader_client, released):
    db, driver = released["db"], released["driver"]

    trip = today(loader_client, driver)[0]

    assert trip["depot_name"] == "peliyagoda"
    # No depot copied onto the dispatcher's trip: the truck's own depot (a Kandy truck here)
    dispatch_trip = released["dispatch_trip"]
    dispatch_trip.depot_name = None
    dispatch_trip.allocation.vehicle.depot_name = "kandy"
    db.flush()
    assert trip_detail(loader_client, driver, trip["id"])["depot_name"] == "kandy"


# ---- End of trip -----------------------------------------------------------------------

def test_completing_the_trip_closes_the_dispatchers_run(loader_client, released):
    db, driver = released["db"], released["driver"]
    trip = started_trip(loader_client, released)
    for stop in trip["stops"]:
        if stop["customer_name"] == "Outlet OUT030":
            loader_client.patch(f"{API}/stops/{stop['id']}/outcome", headers=auth(driver), json={"outcome": "failed"})
        else:
            deliver(loader_client, driver, stop["id"])

    res = loader_client.post(f"{API}/trips/{trip['id']}/complete", headers=auth(driver))

    assert res.status_code == 200, res.text
    dispatch_trip = db.get(DispatchTrip, released["dispatch_trip"].id)
    assert dispatch_trip.status == "completed"
    assert dispatch_trip.stops_completed == 3
    assert dispatch_trip.loading_events[-1]["note"] == "2 delivered · 0 partial · 1 not delivered"
    # Still on today's list, as finished
    assert [t["status"] for t in today(loader_client, driver)] == ["completed"]


def test_finishing_the_trip_frees_the_truck_for_the_next_plan(loader_client, released):
    db, driver = released["db"], released["driver"]
    allocation = released["dispatch_trip"].allocation
    allocation.vehicle.status = VehicleStatus.ALLOCATED  # held by this run, as Quick Allocate leaves it
    db.flush()
    trip = started_trip(loader_client, released)
    for stop in trip["stops"]:
        loader_client.patch(f"{API}/stops/{stop['id']}/outcome", headers=auth(driver), json={"outcome": "failed"})

    res = loader_client.post(f"{API}/trips/{trip['id']}/complete", headers=auth(driver))

    assert res.status_code == 200, res.text
    db.refresh(allocation)
    assert allocation.status == AllocationStatus.COMPLETED
    assert allocation.vehicle.status == VehicleStatus.AVAILABLE
    # The dispatcher can plan the same truck again (next trip, or tomorrow's)
    dispatcher = User(email="dispatch@waypoint.com", full_name="Poorna", hashed_password=get_password_hash("x"),
                      role=UserRole.DISPATCHER, is_active=True)
    db.add(dispatcher)
    db.flush()
    db.add(DepotDispatcherAssignment(depot=Depot.PELIYAGODA, user_id=dispatcher.id))
    db.flush()
    again = loader_client.post(
        "/api/v1/allocations/", headers=auth(dispatcher),
        json={"vehicle_id": allocation.vehicle_id, "status": "ALLOCATED"},
    )
    assert again.status_code == 201, again.text


def test_a_truck_out_of_service_stays_unavailable(loader_client, released):
    db, driver = released["db"], released["driver"]
    allocation = released["dispatch_trip"].allocation
    trip = started_trip(loader_client, released)
    allocation.vehicle.status = VehicleStatus.UNAVAILABLE  # admin took it out mid-trip
    db.flush()
    for stop in trip["stops"]:
        loader_client.patch(f"{API}/stops/{stop['id']}/outcome", headers=auth(driver), json={"outcome": "failed"})

    loader_client.post(f"{API}/trips/{trip['id']}/complete", headers=auth(driver))

    db.refresh(allocation)
    assert allocation.status == AllocationStatus.COMPLETED
    assert allocation.vehicle.status == VehicleStatus.UNAVAILABLE


def test_sync_replay_does_not_apply_twice(loader_client, released):
    trip = started_trip(loader_client, released)
    stop_id = trip["stops"][0]["id"]
    batch = [{
        "action_id": "a-1", "action_type": "arrive", "stop_id": stop_id,
        "payload": {}, "client_timestamp": "2026-10-03T03:40:00Z",
    }]

    first = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=batch).json()
    arrived_at = trip_detail(loader_client, released["driver"], trip["id"])["stops"][0]["arrived_at"]
    second = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=batch).json()

    assert first == {"processed_count": 1, "conflicts": []}
    assert second == {"processed_count": 1, "conflicts": []}
    assert trip_detail(loader_client, released["driver"], trip["id"])["stops"][0]["arrived_at"] == arrived_at


def test_offline_arrival_keeps_the_tap_time_and_replays_cleanly(loader_client, released):
    trip = started_trip(loader_client, released)
    stop_id = trip["stops"][0]["id"]
    arrive = [{"action_id": "a-arr", "action_type": "arrive", "stop_id": stop_id,
               "payload": {}, "client_timestamp": "2026-10-03T00:10:00Z"}]

    first = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=arrive).json()
    deliver(loader_client, released["driver"], stop_id)
    replay = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=arrive).json()

    assert first == {"processed_count": 1, "conflicts": []}
    assert replay == {"processed_count": 1, "conflicts": []}  # already delivered: not a conflict
    stop = trip_detail(loader_client, released["driver"], trip["id"])["stops"][0]
    assert stop["arrived_at"] == "2026-10-03T00:10:00Z"  # when the driver tapped, not when it synced


def test_offline_sos_is_sent_by_sync_with_its_tap_time(loader_client, released):
    trip = started_trip(loader_client, released)
    sos = [{"action_id": "a-sos", "action_type": "sos", "trip_id": trip["id"],
            "payload": {"driver_trip_id": trip["id"], "latitude": 6.13, "longitude": 80.63,
                        "message": "Accident: lorry hit a wall"},
            "client_timestamp": "2026-10-03T00:20:00Z"}]

    result = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=sos).json()

    assert result == {"processed_count": 1, "conflicts": []}
    alert = released["db"].execute(select(SOSAlert)).scalars().one()
    assert (alert.driver_trip_id, alert.latitude, alert.longitude) == (trip["id"], 6.13, 80.63)
    assert alert.message == "Accident: lorry hit a wall"
    assert alert.triggered_at.strftime("%Y-%m-%d %H:%M") == "2026-10-03 00:20"


# ---- Trips not made from a loader run (seed data) still work -------------------------

def test_trip_without_a_run_starts_without_a_gate_out(loader_client, trip_setup):
    db = trip_setup["db"]
    driver, _ = make_driver(db)
    dispatch_trip = make_trip(db, trip_setup["vehicle"], [], code="RUN-0099")
    trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=dispatch_trip.id)
    db.add(trip)
    db.flush()
    db.add(DeliveryStop(driver_trip_id=trip.id, sequence=1, address="12 Galle Rd", customer_name="Shop A"))
    db.flush()

    body = start(loader_client, driver, trip.id)

    assert body["status"] == "started"
    assert db.get(DispatchTrip, dispatch_trip.id).status == "en_route"


# ---- Profile: phone and licence from the driver, vehicle from the depot ----------

def make_account(db, email="nimal@waypoint.com"):
    """A driver account the way Admin creates it: a login, no driver_profiles row."""
    user = User(
        email=email, full_name="Nimal Silva", hashed_password=get_password_hash("driver123"),
        role=UserRole.DRIVER, is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def test_new_account_profile_is_incomplete_and_has_no_trips(loader_client, db_session):
    user = make_account(db_session)

    body = loader_client.get(f"{API}/profile", headers=auth(user)).json()

    assert body["complete"] is False
    assert body["phone"] is None and body["license_type"] is None and body["vehicle"] is None
    assert today(loader_client, user) == []


def test_saving_phone_and_licence_lets_dispatch_pick_the_driver(loader_client, db_session):
    user = make_account(db_session)

    res = loader_client.put(
        f"{API}/profile", headers=auth(user), json={"phone": "+94 77 123 4567", "license_type": "Heavy"},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["complete"] is True
    assert (body["phone"], body["license_type"]) == ("0771234567", "Heavy")
    drivers = loader_client.get("/api/v1/fleet/drivers").json()
    assert any(driver["user_id"] == user.id for driver in drivers)


def test_editing_the_profile_keeps_the_depots_vehicle(loader_client, trip_setup):
    db, vehicle = trip_setup["db"], trip_setup["vehicle"]
    driver, profile = make_driver(db, vehicle=vehicle)

    res = loader_client.put(
        f"{API}/profile", headers=auth(driver), json={"phone": "077-123-4567", "license_type": "Light"},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["phone"], body["license_type"]) == ("0771234567", "Light")
    assert body["vehicle"]["code"] == vehicle.code
    db.refresh(profile)
    assert profile.assigned_vehicle_id == vehicle.id


def test_profile_refuses_a_bad_phone_or_licence(loader_client, db_session):
    user = make_account(db_session)

    for payload in ({"phone": "12345", "license_type": "Heavy"}, {"phone": "0771234567", "license_type": "Bus"}):
        res = loader_client.put(f"{API}/profile", headers=auth(user), json=payload)
        assert res.status_code == 422, res.text

    assert db_session.query(DriverProfile).filter(DriverProfile.user_id == user.id).first() is None


def test_phone_number_cant_be_changed_once_saved(loader_client, db_session):
    user = make_account(db_session)
    first = loader_client.put(f"{API}/profile", headers=auth(user), json={"phone": "0771234567", "license_type": "Heavy"})
    assert first.status_code == 200, first.text

    res = loader_client.put(f"{API}/profile", headers=auth(user), json={"phone": "0712345678", "license_type": "Light"})

    assert (res.status_code, res.json()["detail"]) == (400, "Your phone number can't be changed.")
    body = loader_client.get(f"{API}/profile", headers=auth(user)).json()
    assert (body["phone"], body["license_type"]) == ("0771234567", "Heavy")


def test_profile_shows_the_truck_on_todays_trip(loader_client, released):
    today(loader_client, released["driver"])

    body = loader_client.get(f"{API}/profile", headers=auth(released["driver"])).json()

    truck = released["dispatch_trip"].vehicle_number
    assert truck and body["todays_vehicle"] == truck


# ---- Sign-in through the shared Waypoint (Keycloak) login -------------------------
# Admin makes the account in Keycloak; the driver app sends the Keycloak token.
# The app shows its own messages for "Inactive user" and "Driver access only"
# (frontend/lib/driverSession.ts), so the tests pin them.
# The server checks Keycloak's signature; here it trusts a test key instead.

TEST_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEST_KEY_PEM = TEST_KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
).decode()
TEST_JWK = {
    **jwk.construct(TEST_KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ), "RS256").to_dict(),
    "kid": "driver-test-key", "use": "sig",
}


@pytest.fixture
def keycloak(monkeypatch):
    """The server trusts the test key instead of fetching Keycloak's keys."""
    monkeypatch.setattr(deps, "get_jwks", lambda: {"keys": [TEST_JWK]})


def keycloak_token(email, roles=("driver",), sub="7f1c2d9e-0000-4000-8000-000000000001", name="Kasun Perera"):
    """A token like the shared login's, signed with the test key."""
    claims = {
        "sub": sub, "email": email, "preferred_username": email, "name": name,
        "iss": f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}",
        "aud": settings.KEYCLOAK_AUDIENCE, "exp": int(time.time()) + 600,
        "realm_access": {"roles": list(roles)},
    }
    token = jwt.encode(claims, TEST_KEY_PEM, algorithm="RS256", headers={"kid": "driver-test-key"})
    return {"Authorization": f"Bearer {token}"}


def test_keycloak_driver_signs_in_then_adds_phone_and_licence(loader_client, keycloak):
    headers = keycloak_token("kasun@waypoint.com")

    me = loader_client.get(f"{API}/me", headers=headers)

    assert me.status_code == 200, me.text
    assert (me.json()["email"], me.json()["role"]) == ("kasun@waypoint.com", "DRIVER")
    assert loader_client.get(f"{API}/profile", headers=headers).json()["complete"] is False
    saved = loader_client.put(f"{API}/profile", headers=headers, json={"phone": "0771234567", "license_type": "Light"})
    assert saved.json()["complete"] is True
    drivers = loader_client.get("/api/v1/fleet/drivers").json()
    assert any(driver["user_id"] == me.json()["id"] for driver in drivers)


def test_keycloak_login_is_the_admin_made_driver(loader_client, db_session, keycloak):
    user = make_account(db_session, email="nimal@waypoint.com")

    me = loader_client.get(f"{API}/me", headers=keycloak_token("nimal@waypoint.com", name="Nimal Silva")).json()

    assert me["id"] == user.id
    db_session.refresh(user)
    assert user.keycloak_id == "7f1c2d9e-0000-4000-8000-000000000001"


def test_turned_off_driver_is_refused(loader_client, db_session, keycloak):
    user = make_account(db_session, email="off@waypoint.com")
    user.is_active = False
    db_session.flush()

    res = loader_client.get(f"{API}/me", headers=keycloak_token("off@waypoint.com"))

    assert (res.status_code, res.json()["detail"]) == (400, "Inactive user")


def test_other_roles_cant_use_the_driver_app(loader_client, keycloak):
    headers = keycloak_token("dispatch@waypoint.com", roles=("dispatcher",), sub="7f1c2d9e-0000-4000-8000-000000000002")

    res = loader_client.get(f"{API}/me", headers=headers)

    assert (res.status_code, res.json()["detail"]) == (403, "Driver access only")


# ---- Ready for tomorrow -------------------------------------------------------------
# 3 Oct 2026 is a Saturday: the next working day is Monday 5 Oct (Sunday is off when
# the calendar has no row for it).

def pin_clock(value: datetime):
    """Sri Lanka time as the endpoints see it (deps.get_now)."""
    from app.main import app
    app.dependency_overrides[deps.get_now] = lambda: value


def test_im_ready_is_saved_for_the_next_working_day(loader_client, db_session):
    user = make_account(db_session)
    pin_clock(datetime(2026, 10, 3, 10, 0))

    first = loader_client.post(f"{API}/ready-tomorrow", headers=auth(user))

    assert first.status_code == 200, first.text
    assert (first.json()["for_date"], first.json()["confirmed"], first.json()["open"]) == ("2026-10-05", True, True)
    again = loader_client.post(f"{API}/ready-tomorrow", headers=auth(user)).json()
    assert again["confirmed_at"] == first.json()["confirmed_at"]
    assert loader_client.get(f"{API}/ready-tomorrow", headers=auth(user)).json()["confirmed"] is True
    assert db_session.query(DriverAvailability).filter(DriverAvailability.driver_id == user.id).count() == 1


def test_im_ready_closes_at_4_pm(loader_client, db_session):
    user = make_account(db_session)
    pin_clock(datetime(2026, 10, 2, 16, 30))

    res = loader_client.post(f"{API}/ready-tomorrow", headers=auth(user))

    assert res.status_code == 409
    state = loader_client.get(f"{API}/ready-tomorrow", headers=auth(user)).json()
    assert (state["for_date"], state["confirmed"], state["open"]) == ("2026-10-03", False, False)


def test_dispatcher_sees_who_is_ready(loader_client, trip_setup):
    db, vehicle = trip_setup["db"], trip_setup["vehicle"]
    driver, profile = make_driver(db, vehicle=vehicle)
    pin_clock(datetime(2026, 10, 3, 10, 0))
    loader_client.post(f"{API}/ready-tomorrow", headers=auth(driver))

    ready = loader_client.get(f"{API}/availability", params={"date": "2026-10-05"}).json()

    assert [(d["full_name"], d["phone"], d["vehicle_code"], d["driver_profile_id"]) for d in ready] == [
        ("Tharindu Fernando", "0771234567", vehicle.code, profile.id),
    ]
    assert loader_client.get(f"{API}/availability").json()[0]["driver_id"] == driver.id  # default: next working day
    assert loader_client.get(f"{API}/availability", params={"date": "2026-10-06"}).json() == []


# ---- Photos: Cloudflare R2 when set up, else the local folder -----------------------
# A fake R2 stands in: tests never send files to the real bucket.

PNG_BYTES = base64.b64decode(  # a 1x1 PNG
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def r2_set_up(monkeypatch, client):
    from app.services import photo_storage
    monkeypatch.setattr(photo_storage, "r2_settings", lambda: photo_storage.R2Settings(
        R2_ENDPOINT="https://account.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID="key",
        R2_SECRET_ACCESS_KEY="secret", R2_BUCKET="waypoint-photos", R2_PUBLIC_URL="https://pub-test.r2.dev/",
    ))
    monkeypatch.setattr(photo_storage, "r2_client", lambda: client)


def upload(client, driver):
    return client.post(f"{API}/upload/photo", headers=auth(driver), files={"file": ("pod.png", PNG_BYTES, "image/png")})


def test_photo_goes_to_cloudflare_r2_when_set_up(loader_client, released, monkeypatch):
    saved = {}

    class FakeR2:
        def put_object(self, **fields):
            saved.update(fields)

    r2_set_up(monkeypatch, FakeR2())

    res = upload(loader_client, released["driver"])

    assert res.status_code == 200, res.text
    url = res.json()["photo_url"]
    assert url.startswith("https://pub-test.r2.dev/driver/") and url.endswith(".png")
    assert (saved["Bucket"], saved["ContentType"], saved["Body"]) == ("waypoint-photos", "image/png", PNG_BYTES)
    assert url == f"https://pub-test.r2.dev/{saved['Key']}"


def test_photo_is_kept_locally_if_r2_fails(loader_client, released, monkeypatch, tmp_path):
    from app.services import photo_storage

    class BrokenR2:
        def put_object(self, **fields):
            raise ConnectionError("no route to R2")

    r2_set_up(monkeypatch, BrokenR2())
    monkeypatch.setattr(photo_storage, "UPLOAD_DIR", str(tmp_path))

    url = upload(loader_client, released["driver"]).json()["photo_url"]

    assert url.startswith("/static/uploads/")
    assert (tmp_path / url.rsplit("/", 1)[-1]).read_bytes() == PNG_BYTES


def test_photo_stays_local_without_r2_settings(loader_client, released, monkeypatch, tmp_path):
    from app.services import photo_storage
    monkeypatch.setattr(photo_storage, "r2_settings", lambda: photo_storage.R2Settings(
        R2_ENDPOINT="", R2_ACCESS_KEY_ID="", R2_SECRET_ACCESS_KEY="", R2_BUCKET="", R2_PUBLIC_URL="",
    ))
    monkeypatch.setattr(photo_storage, "UPLOAD_DIR", str(tmp_path))

    url = upload(loader_client, released["driver"]).json()["photo_url"]

    assert url.startswith("/static/uploads/") and url.endswith(".png")
    assert (tmp_path / url.rsplit("/", 1)[-1]).exists()


# ---- SOS photo (sos_alerts.photo_url, migration 0016) ------------------------------

def sos_photo(db, alert_id):
    """The link as the dispatcher's Exceptions reads it: alert.photo_url."""
    alert = db.get(SOSAlert, alert_id)
    db.refresh(alert)
    return alert.photo_url


def test_sos_photo_link_is_saved(loader_client, released):
    trip = started_trip(loader_client, released)
    link = "https://pub-test.r2.dev/driver/2026-10-04/abc.jpg"

    res = loader_client.post(f"{API}/sos", headers=auth(released["driver"]), json={
        "driver_trip_id": trip["id"], "latitude": 6.9, "longitude": 79.86,
        "message": "Vehicle Breakdown", "photo_url": link,
    })

    assert res.status_code == 200, res.text
    assert res.json()["photo_url"] == link
    assert sos_photo(released["db"], res.json()["id"]) == link


def test_offline_sos_keeps_its_photo_link(loader_client, released):
    trip = started_trip(loader_client, released)
    link = "https://pub-test.r2.dev/driver/2026-10-04/offline.jpg"

    res = loader_client.post(f"{API}/sync", headers=auth(released["driver"]), json=[{
        "action_id": "sos-photo-1", "action_type": "sos", "trip_id": trip["id"],
        "client_timestamp": "2026-10-04T04:10:00Z",
        "payload": {"driver_trip_id": trip["id"], "message": "Accident", "photo_url": link},
    }])

    assert res.status_code == 200, res.text
    alert = released["db"].query(SOSAlert).filter(SOSAlert.message == "Accident").one()
    assert sos_photo(released["db"], alert.id) == link


def test_sos_without_a_photo_has_no_link(loader_client, released):
    trip = started_trip(loader_client, released)

    res = loader_client.post(f"{API}/sos", headers=auth(released["driver"]), json={
        "driver_trip_id": trip["id"], "message": "Medical Emergency",
    })

    assert res.status_code == 200, res.text
    assert sos_photo(released["db"], res.json()["id"]) is None
