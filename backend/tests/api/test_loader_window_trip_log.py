"""Delivery-window status per stop on the run read, and the derived
"Trip complete · back at depot" line once a gated-out run's driver trip is done."""
from datetime import datetime, time, timedelta

import pytest

from app.models.delivery_run import RunStatus
from app.models.driver import DriverTrip, DriverTripStatus
from app.models.user import User, UserRole
from app.services.loader_service import stop_window_status
from tests.conftest_loader import (  # noqa: F401  (loader_client is a fixture)
    loader_client,
    make_dock,
    make_order,
    make_outlet,
    make_run,
    make_run_order,
    make_stop,
    make_trip,
    make_vehicle,
)

BASE = "/api/v1/loader"


def utc(depot_hhmm: str, day: str = "2026-05-28") -> datetime:
    """Depot time (UTC+05:30) as the naive UTC the database stores."""
    hh, mm = map(int, depot_hhmm.split(":"))
    minutes = hh * 60 + mm - 330
    base = datetime.fromisoformat(f"{day}T00:00:00")
    return base + timedelta(minutes=minutes)


@pytest.fixture
def window_run(db_session):
    """RUN-0071: one stop at OUT003 (window 05:00-07:30), order for 28 May."""
    db = db_session
    vehicle = make_vehicle(db, code="VEH035")
    dock = make_dock(db)
    outlet = make_outlet(db, "OUT003")
    outlet.window_start, outlet.window_end = time(5, 0), time(7, 30)
    order = make_order(db, "ORD0071001", outlet)
    order.operating_date = "2026-05-28"
    run = make_run(db, vehicle, dock, code="RUN-0071", plan_version=1)
    stop = make_stop(db, run, 1, 1, outlet, plan_version=1)
    make_run_order(db, stop, order, plan_version=1)
    db.flush()
    return run, stop, order


@pytest.mark.parametrize(
    ("departs", "eta", "expected"),
    [
        ("16:26", None, "closed"),   # RUN-0071: leaves after the window
        ("03:30", None, "ok"),       # night wave, well before 07:30
        ("06:30", "07:10", "closing"),  # ETA in the last 30 minutes
        ("06:30", "07:45", "closed"),   # the ETA wins over the departure
        ("04:00", "04:40", "ok"),       # early: the truck waits for 05:00
    ],
)
def test_window_status_from_departure_or_eta(db_session, window_run, departs, eta, expected):
    run, stop, _ = window_run
    run.departs_at = utc(departs)
    stop.eta = utc(eta) if eta else None

    assert stop_window_status(run, stop) == expected


def test_leaving_the_evening_before_the_delivery_day_is_ok(db_session, window_run):
    run, stop, order = window_run
    order.operating_date = "2026-05-29"
    run.departs_at = utc("21:00")

    assert stop_window_status(run, stop) == "ok"


def test_an_outlet_without_a_window_has_no_status(db_session, window_run):
    run, stop, _ = window_run
    stop.outlet.window_end = None

    assert stop_window_status(run, stop) is None


def test_the_run_read_carries_window_status_per_stop(loader_client, db_session, window_run):
    run, _, _ = window_run
    run.departs_at = utc("16:26")
    db_session.flush()

    detail = loader_client.get(f"{BASE}/runs/RUN-0071").json()

    assert [(s["outlet"]["code"], s["window_status"]) for s in detail["stops"]] == [("OUT003", "closed")]


# --- Trip complete -------------------------------------------------------------


@pytest.fixture
def gated_out_run(db_session, window_run):
    run, _, order = window_run
    trip = make_trip(db_session, run.vehicle, [order], code="RUN-0071")
    run.dispatch_trip_id = trip.id
    run.status = RunStatus.GATED_OUT
    run.gated_out_at = utc("16:30")
    driver = User(email="kamal@waypoint.lk", full_name="Kamal Perera", hashed_password="x", role=UserRole.DRIVER)
    db_session.add(driver)
    db_session.flush()
    driver_trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=trip.id, status=DriverTripStatus.STARTED)
    db_session.add(driver_trip)
    db_session.flush()
    return run, driver_trip


def complete(db, driver_trip, depot_hhmm="20:05"):
    driver_trip.status = DriverTripStatus.COMPLETED
    driver_trip.completed_at = utc(depot_hhmm)
    db.flush()


def test_the_log_ends_with_trip_complete_once_the_driver_is_back(loader_client, db_session, gated_out_run):
    run, driver_trip = gated_out_run
    complete(db_session, driver_trip)

    events = loader_client.get(f"{BASE}/runs/RUN-0071/activity").json()

    assert events[0]["type"] == "trip_completed"
    assert events[0]["summary"] == "Trip complete · back at depot"
    assert events[0]["actor"] == {"kind": "system", "name": "Kamal Perera", "full_name": None}
    assert events[0]["at"] == "2026-05-28T14:35:00Z"  # 20:05 depot

    feed = loader_client.get(f"{BASE}/activity", params={"dock": "3"}).json()
    line = next(e for e in feed if e["event_type"] == "trip_completed")
    assert (line["run_code"], line["message"], line["actor"]) == ("RUN-0071", "Trip complete · back at depot", "Kamal Perera")


def test_no_trip_complete_while_the_driver_is_still_out(loader_client, db_session, gated_out_run):
    events = loader_client.get(f"{BASE}/runs/RUN-0071/activity").json()

    assert all(e["type"] != "trip_completed" for e in events)


def test_no_trip_complete_for_a_run_that_has_not_gated_out(loader_client, db_session, gated_out_run):
    run, driver_trip = gated_out_run
    complete(db_session, driver_trip)
    run.status = RunStatus.READY_TO_DEPART
    db_session.flush()

    events = loader_client.get(f"{BASE}/runs/RUN-0071/activity").json()
    feed = loader_client.get(f"{BASE}/activity", params={"dock": "3"}).json()

    assert all(e["type"] != "trip_completed" for e in events)
    assert all(e["event_type"] != "trip_completed" for e in feed)
