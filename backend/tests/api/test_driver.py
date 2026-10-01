"""Driver API: collect a released run, deliver it stop by stop, sync offline records.

Built on the loader's RUN-021 fixture (four Gampaha Fresh stops on VEH001), released
by the loader and collected by the driver assigned to VEH001.
"""
from datetime import datetime

import pytest
from sqlalchemy import select

from app.api import deps
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.delivery_run import RunOrderState, RunStatus, RunStop, RunStopOrder
from app.models.driver import (
    DeliveryStop,
    DeliveryStopStatus,
    IssueReport,
    IssueType,
    ProofOfDelivery,
    SOSAlert,
)
from app.models.fleet import DriverProfile
from app.models.notification import Notification, NotificationType
from app.models.order import OrderStatus
from app.models.reference import TempCapability, VehicleType
from app.models.shipment import DispatchTrip
from app.models.user import User, UserRole
from app.services import geo
from app.services.driver_service import driver_service
from tests.conftest_loader import build_run_021, loader_client, make_vehicle  # noqa: F401  (loader_client is a fixture)

API = "/api/v1/driver"
SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="


def make_user(db, email, name, role=UserRole.DRIVER) -> User:
    user = User(
        email=email, full_name=name, hashed_password=get_password_hash("driver123"),
        role=role, is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def make_driver(db, vehicle, email="tharindu@waypoint.com", name="Tharindu Fernando") -> User:
    user = make_user(db, email, name)
    db.add(DriverProfile(
        user_id=user.id, license_type="Heavy", phone="0771234567",
        assigned_vehicle_id=vehicle.id if vehicle else None,
    ))
    db.flush()
    return user


def auth(user) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def release(db, run, flagged=("ORD0092308",)):
    """The loader's sign-off: every order checked except the flagged ones."""
    rows = db.execute(
        select(RunStopOrder)
        .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
        .where(RunStop.run_id == run.id)
    ).scalars()
    for row in rows:
        row.state = RunOrderState.FLAGGED if row.order.order_number in flagged else RunOrderState.LOADED
    run.status = RunStatus.READY_TO_DEPART
    db.flush()


@pytest.fixture
def released(db_session):
    run, orders = build_run_021(db_session)
    release(db_session, run)
    driver = make_driver(db_session, run.vehicle)
    return run, orders, driver


def start(client, driver, code="RUN-021"):
    res = client.post(f"{API}/runs/{code}/start", headers=auth(driver))
    assert res.status_code == 200, res.text
    return res.json()


def deliver(client, driver, stop_id):
    assert client.patch(f"{API}/stops/{stop_id}/arrive", headers=auth(driver), json={}).status_code == 200
    res = client.patch(f"{API}/stops/{stop_id}/outcome", headers=auth(driver), json={"outcome": "delivered"})
    assert res.status_code == 200, res.text
    res = client.post(
        f"{API}/stops/{stop_id}/pod", headers=auth(driver),
        json={"recipient_name": "Malini Perera", "signature_data": SIGNATURE},
    )
    assert res.status_code == 200, res.text
    return res.json()


# ---- Hand-off from the loader ---------------------------------------------------------

def test_released_run_is_listed_and_starting_it_is_the_gate_out(loader_client, db_session, released):
    run, orders, driver = released

    cards = loader_client.get(f"{API}/runs", headers=auth(driver)).json()
    assert [card["code"] for card in cards] == ["RUN-021"]
    assert cards[0]["state"] == "ready"
    assert cards[0]["stop_count"] == 4
    assert cards[0]["has_chilled"] is True
    assert cards[0]["vehicle"]["code"] == "VEH001"

    trip = start(loader_client, driver)
    assert trip["status"] == "started"
    assert trip["run"]["code"] == "RUN-021"
    assert [stop["outlet"]["code"] for stop in trip["stops"]] == ["OUT026", "OUT030", "OUT031", "OUT027"]
    assert all(stop["latitude"] and stop["location_approximate"] for stop in trip["stops"])
    assert trip["depot"]["name"] == "Peliyagoda distribution centre"
    not_loaded = [order for order in trip["stops"][3]["orders"] if not order["on_truck"]]
    assert [order["order_number"] for order in not_loaded] == ["ORD0092308"]

    db_session.refresh(run)
    assert run.status == RunStatus.GATED_OUT
    assert run.gated_out_at is not None

    # On the truck: walked processing -> ready_for_dispatch -> dispatched. Flagged: untouched.
    assert orders["ORD0092301"].status == OrderStatus.DISPATCHED
    assert orders["ORD0092308"].status == OrderStatus.PROCESSING
    etas = db_session.execute(
        select(Notification).where(Notification.type == NotificationType.ETA_UPDATED)
    ).scalars().all()
    assert len(etas) == 7

    dispatch_trip = db_session.get(DispatchTrip, run.dispatch_trip_id)
    assert dispatch_trip.trip_code == "RUN-021"
    assert dispatch_trip.status == "en_route"
    assert dispatch_trip.stop_count == 4
    assert dispatch_trip.loading_events[-1]["event"] == "Left the gate"

    # Starting again resumes the same trip.
    assert start(loader_client, driver)["id"] == trip["id"]
    assert len(db_session.execute(select(DeliveryStop)).scalars().all()) == 4


def test_run_sheet_shows_the_stops_before_departure(loader_client, released):
    _, _, driver = released
    res = loader_client.get(f"{API}/runs/RUN-021", headers=auth(driver))
    assert res.status_code == 200, res.text
    sheet = res.json()
    assert sheet["state"] == "ready"
    assert sheet["trip_id"] is None
    assert [stop["sequence"] for stop in sheet["stops"]] == [1, 2, 3, 4]
    first = sheet["stops"][0]
    assert first["outlet"]["window_start"] == "03:00"
    assert first["outlet"]["dock_type"] == "rear_dock"
    assert {order["order_number"] for order in first["orders"]} == {"ORD0092301", "ORD0092302"}
    # Same pin before and after departure.
    trip = start(loader_client, driver)
    assert (trip["stops"][0]["latitude"], trip["stops"][0]["longitude"]) == (first["latitude"], first["longitude"])
    assert loader_client.get(f"{API}/runs/RUN-021", headers=auth(driver)).json()["trip_id"] == trip["id"]


def test_run_still_at_the_dock_cannot_be_collected(loader_client, db_session, released):
    run, _, driver = released
    run.status = RunStatus.LOADING
    db_session.flush()

    cards = loader_client.get(f"{API}/runs", headers=auth(driver)).json()
    assert cards[0]["state"] == "being_loaded"
    res = loader_client.post(f"{API}/runs/RUN-021/start", headers=auth(driver))
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "RUN_NOT_RELEASED"


def test_driver_cannot_collect_another_vehicles_run(loader_client, db_session, released):
    van = make_vehicle(db_session, code="VEH035", vtype=VehicleType.VAN, temp=TempCapability.REEFER)
    other = make_driver(db_session, van, email="nimal@waypoint.com", name="Nimal Silva")

    assert loader_client.get(f"{API}/runs", headers=auth(other)).json() == []
    res = loader_client.post(f"{API}/runs/RUN-021/start", headers=auth(other))
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "NOT_YOUR_RUN"


def test_only_drivers_use_the_driver_api(loader_client, db_session, released):
    dispatcher = make_user(db_session, "dispatch@waypoint.com", "Nisal D.", UserRole.DISPATCHER)
    assert loader_client.get(f"{API}/runs", headers=auth(dispatcher)).status_code == 403


# ---- Stops ------------------------------------------------------------------------------

def test_full_delivery_with_proof_tells_the_store(loader_client, db_session, released):
    _, orders, driver = released
    trip = start(loader_client, driver)
    stop_id = trip["stops"][0]["id"]

    # 02:40 in Colombo: the 03:00 window isn't open yet, so the vehicle waits.
    res = loader_client.patch(
        f"{API}/stops/{stop_id}/arrive", headers=auth(driver),
        json={"client_timestamp": "2026-05-27T21:10:00Z"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["timing"] == {"status": "early", "minutes": 20}

    res = loader_client.patch(f"{API}/stops/{stop_id}/outcome", headers=auth(driver), json={"outcome": "delivered"})
    assert res.json()["status"] == "delivered"
    assert orders["ORD0092301"].status == OrderStatus.DELIVERED
    assert orders["ORD0092302"].status == OrderStatus.DELIVERED
    delivered_notes = db_session.execute(
        select(Notification).where(Notification.type == NotificationType.DELIVERED)
    ).scalars().all()
    assert len(delivered_notes) == 2

    res = loader_client.post(f"{API}/stops/{stop_id}/pod", headers=auth(driver), json={"recipient_name": "Malini"})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "EVIDENCE_REQUIRED"

    res = loader_client.post(
        f"{API}/stops/{stop_id}/pod", headers=auth(driver),
        json={"recipient_name": "Malini Perera", "signature_data": SIGNATURE, "photo_url": PHOTO},
    )
    assert res.status_code == 200, res.text
    stop = res.json()
    assert stop["completed_at"] is not None
    assert stop["pod"]["has_signature"] and stop["pod"]["has_photo"]

    view = loader_client.get(f"{API}/trips/{trip['id']}", headers=auth(driver)).json()
    assert view["counts"]["done"] == 1
    assert view["counts"]["pod"] == 1
    assert view["stops"][1]["departed_at"] is not None  # left stop 1 for stop 2


def test_failed_delivery_needs_a_reason_and_raises_an_issue(loader_client, db_session, released):
    _, orders, driver = released
    trip = start(loader_client, driver)
    stop_id = trip["stops"][1]["id"]

    res = loader_client.patch(f"{API}/stops/{stop_id}/outcome", headers=auth(driver), json={"outcome": "failed"})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "REASON_REQUIRED"

    res = loader_client.patch(
        f"{API}/stops/{stop_id}/outcome", headers=auth(driver),
        json={"outcome": "failed", "reason": "Outlet closed"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "failed"
    assert res.json()["completed_at"] is not None
    issue = db_session.execute(select(IssueReport)).scalars().one()
    assert issue.issue_type == IssueType.CUSTOMER_UNAVAILABLE
    # No way back from dispatched in the order lifecycle: the orders wait for the dispatcher.
    assert orders["ORD0092303"].status == OrderStatus.DISPATCHED


def test_partial_delivery_records_units_per_order(loader_client, db_session, released):
    _, _, driver = released
    trip = start(loader_client, driver)
    stop_id = trip["stops"][2]["id"]

    res = loader_client.patch(
        f"{API}/stops/{stop_id}/outcome", headers=auth(driver),
        json={"outcome": "partial", "delivered_units": {"ORD0092305": 60}},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "INVALID_UNITS"

    res = loader_client.patch(
        f"{API}/stops/{stop_id}/outcome", headers=auth(driver),
        json={"outcome": "partial", "delivered_units": {"ORD0092305": 40}, "reason": "Two cartons crushed"},
    )
    assert res.status_code == 200, res.text
    assert "ORD0092305 40/48 units" in res.json()["note"]
    assert db_session.execute(select(IssueReport)).scalars().one().issue_type == IssueType.OTHER


# ---- Offline sync -------------------------------------------------------------------------

def test_sync_applies_offline_records_once(loader_client, db_session, released):
    _, _, driver = released
    trip = start(loader_client, driver)
    stop_id = trip["stops"][0]["id"]
    actions = [
        {"action_id": "a-1", "action_type": "arrive", "stop_id": stop_id,
         "client_timestamp": "2026-05-27T22:05:00Z"},
        {"action_id": "a-2", "action_type": "outcome", "stop_id": stop_id,
         "payload": {"outcome": "delivered"}, "client_timestamp": "2026-05-27T22:15:00Z"},
        {"action_id": "a-3", "action_type": "pod", "stop_id": stop_id,
         "payload": {"recipient_name": "Malini Perera", "signature_data": SIGNATURE},
         "client_timestamp": "2026-05-27T22:18:00Z"},
    ]
    first = loader_client.post(f"{API}/sync", headers=auth(driver), json=actions).json()
    assert [result["status"] for result in first["results"]] == ["applied"] * 3

    # The phone retries after a dropped connection: nothing is applied twice.
    second = loader_client.post(f"{API}/sync", headers=auth(driver), json=actions).json()
    assert [result["status"] for result in second["results"]] == ["applied"] * 3
    assert len(db_session.execute(select(ProofOfDelivery)).scalars().all()) == 1

    stop = db_session.get(DeliveryStop, stop_id)
    # The tap times are kept, not the upload time.
    assert stop.arrived_at == datetime(2026, 5, 27, 22, 5)
    assert stop.completed_at == datetime(2026, 5, 27, 22, 18)


def test_stop_removed_while_offline_is_a_conflict_the_driver_resolves(loader_client, db_session, released):
    _, orders, driver = released
    trip = start(loader_client, driver)
    second_stop = trip["stops"][1]["id"]
    third_stop = trip["stops"][2]["id"]

    # While the phone is offline, dispatch removes stops 2 and 3.
    driver_service.dev_defer_stop(db_session, "RUN-021", 2, "Store asked to move the delivery")
    driver_service.dev_defer_stop(db_session, "RUN-021", 3, "Cold room fault at the outlet")

    actions = [
        {"action_id": "b-1", "action_type": "arrive", "stop_id": second_stop,
         "client_timestamp": "2026-05-27T23:00:00Z"},
        {"action_id": "b-2", "action_type": "outcome", "stop_id": second_stop,
         "payload": {"outcome": "delivered"}, "client_timestamp": "2026-05-27T23:10:00Z"},
    ]
    results = loader_client.post(f"{API}/sync", headers=auth(driver), json=actions).json()["results"]
    assert [result["status"] for result in results] == ["conflict", "conflict"]
    assert results[0]["code"] == "STOP_REMOVED"
    assert results[0]["server_state"]["status"] == "rescheduled"
    assert "Deferred by Dispatcher" in results[0]["message"]

    # Keep my delivery record: the delivery happened, so it stands.
    res = loader_client.post(
        f"{API}/stops/{second_stop}/resolve", headers=auth(driver),
        json={"resolution": "keep_record", "record": {
            "outcome": "delivered", "arrived_at": "2026-05-27T23:00:00Z",
            "pod": {"recipient_name": "Kasun", "signature_data": SIGNATURE,
                    "client_timestamp": "2026-05-27T23:12:00Z"},
        }},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "delivered"
    assert res.json()["pod"]["recipient_name"] == "Kasun"
    assert orders["ORD0092303"].status == OrderStatus.DELIVERED

    # Flag for dispatcher review: the stop stays removed, dispatch decides.
    res = loader_client.post(
        f"{API}/stops/{third_stop}/resolve", headers=auth(driver),
        json={"resolution": "flag_review", "record": {"outcome": "delivered"}},
    )
    assert res.json()["status"] == "rescheduled"
    descriptions = [issue.description for issue in db_session.execute(select(IssueReport)).scalars()]
    assert any("kept their delivered record" in text for text in descriptions)
    assert any("Needs dispatcher review" in text for text in descriptions)


@pytest.mark.skipif(settings.ENVIRONMENT == "production", reason="dev routes are not mounted in production")
def test_dev_route_defers_a_stop(loader_client, db_session, released):
    _, _, driver = released
    start(loader_client, driver)
    res = loader_client.post(f"{API}/dev/runs/RUN-021/stops/4/defer", json={"reason": "Outlet asked for tomorrow"})
    assert res.status_code == 200, res.text
    stop = res.json()["stops"][3]
    assert stop["status"] == "rescheduled"
    assert "Outlet asked for tomorrow" in stop["removed_reason"]


# ---- End of the trip -------------------------------------------------------------------------

def test_trip_completes_only_when_every_stop_is_done_then_checks_in(loader_client, db_session, released):
    run, _, driver = released
    trip = start(loader_client, driver)

    res = loader_client.post(f"{API}/trips/{trip['id']}/complete", headers=auth(driver), json={})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "STOPS_OPEN"

    for stop in trip["stops"][:3]:
        deliver(loader_client, driver, stop["id"])
    last = trip["stops"][3]["id"]
    loader_client.patch(
        f"{API}/stops/{last}/outcome", headers=auth(driver), json={"outcome": "failed", "reason": "No one to receive"}
    )

    # Check-in closes the trip when every stop is done.
    res = loader_client.post(f"{API}/trips/{trip['id']}/checkin", headers=auth(driver), json={})
    assert res.status_code == 200, res.text
    view = res.json()
    assert view["status"] == "completed"
    assert view["checked_in_at"] is not None
    assert view["counts"] == {
        "total": 4, "done": 4, "delivered": 3, "partial": 0, "failed": 1, "removed": 0, "pod": 3,
    }
    dispatch_trip = db_session.get(DispatchTrip, run.dispatch_trip_id)
    assert dispatch_trip.status == "completed"
    assert dispatch_trip.stops_completed == 4
    # Driver events never use "error": the dispatcher reads those as loading shortfalls.
    assert all(event["status"] in ("ok", "warning") for event in dispatch_trip.loading_events)

    card = loader_client.get(f"{API}/runs", headers=auth(driver)).json()[0]
    assert card["state"] == "completed"
    assert card["checked_in"] is True


def test_sos_keeps_trip_location_and_message(loader_client, db_session, released):
    _, _, driver = released
    trip = start(loader_client, driver)
    res = loader_client.post(
        f"{API}/sos", headers=auth(driver),
        json={"driver_trip_id": trip["id"], "latitude": 7.0873, "longitude": 80.0144,
              "message": "Vehicle breakdown · engine overheating"},
    )
    assert res.status_code == 200, res.text
    alert = db_session.get(SOSAlert, res.json()["id"])
    assert alert.driver_trip_id == trip["id"]
    assert (alert.latitude, alert.longitude) == (7.0873, 80.0144)
    assert alert.message == "Vehicle breakdown · engine overheating"
    assert loader_client.get(f"{API}/sos/{alert.id}", headers=auth(driver)).json()["status"] == "triggered"


def test_ready_tomorrow_confirms_the_next_operating_day_once(loader_client, db_session, released):
    _, _, driver = released
    # Saturday afternoon: Waypoint doesn't run on Sunday, so "tomorrow" is Monday.
    app.dependency_overrides[deps.get_now] = lambda: datetime(2026, 10, 3, 15, 30)

    res = loader_client.get(f"{API}/ready-tomorrow", headers=auth(driver)).json()
    assert res == {"for_date": "2026-10-05", "confirmed": False, "confirmed_at": None}

    first = loader_client.post(f"{API}/ready-tomorrow", headers=auth(driver)).json()
    assert first["confirmed"] is True
    second = loader_client.post(f"{API}/ready-tomorrow", headers=auth(driver)).json()
    assert second["confirmed_at"] == first["confirmed_at"]


def test_monitor_shows_trips_on_the_road(loader_client, db_session, released):
    _, _, driver = released
    trip = start(loader_client, driver)
    dispatcher = make_user(db_session, "dispatch@waypoint.com", "Nisal D.", UserRole.DISPATCHER)
    rows = loader_client.get(f"{API}/monitor", headers=auth(dispatcher)).json()
    assert [(row["run_code"], row["stop_count"], row["stops_done"]) for row in rows] == [("RUN-021", 4, 0)]
    assert rows[0]["trip_id"] == trip["id"]


# ---- Map positions -----------------------------------------------------------------------------

def test_outlet_pins_are_stable_near_their_town_and_off_the_coast():
    for district, area in geo.DISTRICTS.items():
        for number in range(1, 25):
            code = f"OUT{number:03d}"
            pin = geo.approx_outlet_location(code, district)
            assert pin == geo.approx_outlet_location(code, district)
            distance = geo.haversine_km((area.latitude, area.longitude), pin)
            assert geo.MIN_OFFSET_KM - 0.05 <= distance <= geo.MAX_OFFSET_KM + 0.05
    # Colombo's coast is to the west: its pins stay east of the town centre.
    colombo = geo.DISTRICTS["Colombo"]
    assert all(
        geo.approx_outlet_location(f"OUT{number:03d}", "Colombo")[1] >= colombo.longitude
        for number in range(1, 121)
    )
    # Unknown district: pinned near the outlet's depot instead.
    lat, lng = geo.approx_outlet_location("OUT999", "Atlantis", "kandy")
    assert geo.haversine_km((lat, lng), (geo.DEPOTS["kandy"].latitude, geo.DEPOTS["kandy"].longitude)) < 3.1
