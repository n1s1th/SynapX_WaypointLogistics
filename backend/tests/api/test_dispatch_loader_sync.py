"""Dispatch and dock plans must agree, including when the dock rejects a change."""

from uuid import uuid4

from app.models.allocation import Allocation, AllocationStatus
from app.models.delivery_run import DeliveryRun
from app.models.shipment import DispatchTrip
from app.services.loader_service import LoaderService
from app.api.v1.endpoints.dispatch import loader_service
from tests.conftest_loader import (  # noqa: F401
    at, loader_client, make_dock, make_issue, make_loader, make_order, make_run,
    make_outlet, make_trip, make_vehicle, trip_setup,
)


def test_plan_rejection_does_not_update_dispatch_trip(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    dock_run = LoaderService.create_run_for_dispatch_trip(db, trip)
    original_departure = trip.departure_time
    original_stops = trip.stop_sequence

    response = loader_client.post(f"/api/v1/delivery-runs/{trip.id}/plan", json={
        "plan": {
            "client_action_id": str(uuid4()), "base_version": 0,
            "departs_at": "2026-05-28T04:30:00", "dispatcher": "Dispatcher",
        }
    })

    assert response.status_code == 409
    db.refresh(trip)
    db.refresh(dock_run)
    assert trip.departure_time == original_departure
    assert trip.stop_sequence == original_stops
    assert dock_run.current_plan_version == 1


def test_departure_change_updates_trip_and_dock_together(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    dock_run = LoaderService.create_run_for_dispatch_trip(db, trip)

    response = loader_client.post(f"/api/v1/delivery-runs/{trip.id}/plan", json={
        "plan": {
            "client_action_id": str(uuid4()), "base_version": 1,
            "departs_at": "2026-05-28T04:30:00", "dispatcher": "Dispatcher",
        }
    })

    assert response.status_code == 200, response.text
    db.refresh(trip)
    db.refresh(dock_run)
    assert trip.departure_time == dock_run.departs_at
    assert dock_run.current_plan_version == 1


def test_stop_order_updates_trip_and_dock_together(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    dock_run = LoaderService.create_run_for_dispatch_trip(db, trip)
    codes = [stop.outlet.code for stop in sorted(
        LoaderService.current_stops(db, dock_run), key=lambda stop: stop.stop_sequence,
    )]
    reversed_codes = list(reversed(codes))
    stops = [{"id": code, "outlet_code": code, "name": code,
              "eta": "", "sla_ok": True, "sla_note": "On schedule"}
             for code in reversed_codes]

    response = loader_client.post(f"/api/v1/delivery-runs/{trip.id}/plan", json={
        "plan": {"client_action_id": str(uuid4()), "base_version": 1,
                 "stop_order": reversed_codes, "dispatcher": "Dispatcher"},
        "stop_sequence": stops,
    })

    assert response.status_code == 200, response.text
    db.refresh(trip)
    db.refresh(dock_run)
    assert [stop["outlet_code"] for stop in trip.stop_sequence] == reversed_codes
    assert [stop.outlet.code for stop in sorted(
        LoaderService.current_stops(db, dock_run), key=lambda stop: stop.stop_sequence,
    )] == reversed_codes
    assert dock_run.current_plan_version == 2


def test_stop_order_updates_trip_without_dock_run(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    codes = list(dict.fromkeys(order.outlet.code for order in trip_setup["orders"]))
    reversed_stops = [
        {"id": code, "outlet_code": code, "name": code,
         "eta": "", "sla_ok": True, "sla_note": "On schedule"}
        for code in reversed(codes)
    ]

    response = loader_client.post(f"/api/v1/delivery-runs/{trip.id}/plan", json={
        "plan": {"client_action_id": str(uuid4()), "base_version": 1,
                 "stop_order": list(reversed(codes)), "dispatcher": "Dispatcher"},
        "stop_sequence": reversed_stops,
    })

    assert response.status_code == 200, response.text
    db.refresh(trip)
    assert trip.stop_sequence == reversed_stops
    assert response.json()["loader"] is None


def test_dispatcher_run_exposes_open_dock_flags(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    dock_run = LoaderService.create_run_for_dispatch_trip(db, trip)
    reporter = make_loader(db)
    make_issue(db, dock_run, trip_setup["orders"][0], reporter)

    response = loader_client.get(f"/api/v1/delivery-runs/{trip.id}")

    assert response.status_code == 200
    assert response.json()["loader"]["dock"] == "DOCK3"
    assert response.json()["open_shortfalls"] == 1


def test_unbuildable_dock_run_keeps_trip_and_exposes_retry_warning(loader_client, db_session):
    vehicle = make_vehicle(db_session, code="VEH-NODOCK")
    outlet = make_outlet(db_session, "OUT-NODOCK")
    order = make_order(db_session, "ORD-NODOCK", outlet)
    allocation = Allocation(vehicle_id=vehicle.id, run_id="RUN-NODOCK",
                            departure_time=at("03:30"), status=AllocationStatus.READY)
    db_session.add(allocation)
    db_session.flush()
    order.allocation_id = allocation.id
    db_session.flush()

    response = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["loader"] is None
    assert "dock" in body["loader_warning"].lower()
    assert db_session.query(DispatchTrip).filter_by(allocation_id=allocation.id).count() == 1
    assert db_session.query(DeliveryRun).filter_by(dispatch_trip_id=body["id"]).count() == 0
    db_session.refresh(allocation)
    assert allocation.status == AllocationStatus.DISPATCHED
    publish = loader_client.patch(f"/api/v1/delivery-runs/{body['id']}", json={"status": "en_route"})
    assert publish.status_code == 409

    repeated = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")
    assert repeated.status_code == 201
    assert repeated.json()["id"] == body["id"]
    assert repeated.json()["loader_warning"] == body["loader_warning"]

    make_dock(db_session)
    recovered = loader_client.post(f"/api/v1/loader/dispatch-trips/{body['id']}/run")
    assert recovered.status_code == 201, recovered.text
    detail = loader_client.get(f"/api/v1/delivery-runs/{body['id']}")
    assert detail.json()["loader"]["dock"] == "DOCK3"
    assert detail.json()["loader_warning"] is None
    assert detail.json()["stop_sequence"][0]["outlet_code"] == "OUT-NODOCK"


def test_taken_run_code_keeps_dispatch_trip(loader_client, trip_setup):
    db = trip_setup["db"]
    make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="RUN-TAKEN")
    allocation = Allocation(vehicle_id=trip_setup["vehicle"].id, run_id="RUN-TAKEN",
                            departure_time=at("03:30"), status=AllocationStatus.READY)
    db.add(allocation)
    db.flush()
    trip_setup["orders"][0].allocation_id = allocation.id
    db.flush()

    response = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["loader"] is None
    assert "already exists" in body["loader_warning"]
    assert db.query(DispatchTrip).filter_by(allocation_id=allocation.id).count() == 1
    db.refresh(allocation)
    assert allocation.status == AllocationStatus.DISPATCHED


def test_order_on_another_run_keeps_dispatch_trip(loader_client, trip_setup):
    db = trip_setup["db"]
    first_trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])
    LoaderService.create_run_for_dispatch_trip(db, first_trip)
    allocation = Allocation(vehicle_id=trip_setup["vehicle"].id, run_id="RUN-CLASH",
                            departure_time=at("03:30"), status=AllocationStatus.READY)
    db.add(allocation)
    db.flush()
    trip_setup["orders"][0].allocation_id = allocation.id
    db.flush()

    response = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["loader"] is None
    assert "already on another loader run" in body["loader_warning"]
    assert db.query(DispatchTrip).filter_by(allocation_id=allocation.id).count() == 1
    db.refresh(allocation)
    assert allocation.status == AllocationStatus.DISPATCHED


def test_unexpected_loader_error_keeps_dispatch_trip(loader_client, db_session, monkeypatch):
    vehicle = make_vehicle(db_session, code="VEH-LOADER-ERROR")
    outlet = make_outlet(db_session, "OUT-LOADER-ERROR")
    order = make_order(db_session, "ORD-LOADER-ERROR", outlet)
    allocation = Allocation(vehicle_id=vehicle.id, run_id="RUN-LOADER-ERROR",
                            departure_time=at("03:30"), status=AllocationStatus.READY)
    db_session.add(allocation)
    db_session.flush()
    order.allocation_id = allocation.id
    db_session.flush()

    def fail_loader(*args, **kwargs):
        raise RuntimeError("Loader temporarily unavailable")

    monkeypatch.setattr(loader_service, "create_run_for_dispatch_trip", fail_loader)
    response = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["loader"] is None
    assert body["loader_warning"] == "Loader temporarily unavailable"
    assert db_session.query(DispatchTrip).filter_by(allocation_id=allocation.id).count() == 1
    db_session.refresh(allocation)
    assert allocation.status == AllocationStatus.DISPATCHED
