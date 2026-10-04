"""Real endpoint trace from candidate groups through the versioned dock plan."""
from datetime import datetime, time, timezone
from uuid import uuid4

import pytest

from app.models.allocation import Allocation, AllocationStatus
from app.models.delivery_run import RunStatus
from app.models.order import Order, OrderStatus
from app.models.reference import Brand, Depot, DockType, Outlet
from app.models.shipment import DispatchTrip
from app.services.loader_service import loader_service
from tests.api.test_allocation_recommendations import _seed_planning, DEPARTURE, DAY
from tests.conftest_loader import loader_client  # noqa: F401


@pytest.fixture
def scenario(db_session, tmp_path, monkeypatch):
    setup = _seed_planning(db_session, tmp_path, monkeypatch)
    outlet = Outlet(code="ZZ-URGENT", name="Early Fresh outlet", brand=Brand.FRESH, district="Colombo",
                    dock_type=DockType.REAR_DOCK, depot=Depot.PELIYAGODA,
                    window_start=time(6), window_end=time(7))
    db_session.add(outlet)
    db_session.flush()
    early = Order(order_number="EARLY-ORDER", client_name=outlet.name, destination_address="Colombo",
                  status=OrderStatus.CONFIRMED, depot=Depot.PELIYAGODA, outlet_id=outlet.id,
                  brand="Fresh", district="Colombo", operating_date=DAY, temperature_zone="Ambient",
                  weight_kg=500, volume_m3=3, delivery_window="06:00 - 07:00", is_late=False)
    db_session.add(early)
    db_session.commit()
    setup["early"] = early
    setup["ids"] = [setup["order"].id, early.id]
    return setup


def recommendation(client, setup):
    response = client.post("/api/v1/allocation-recommendations", json={"order_ids": setup["ids"], "departure_time": DEPARTURE})
    assert response.status_code == 200, response.text
    return next(row for row in response.json()["vehicles"] if row["vehicle_id"] == setup["vehicle"].id)


def confirm(client, setup, candidate):
    return client.post("/api/v1/allocations/confirm", json={"order_ids": setup["ids"], "departure_time": DEPARTURE,
                       "vehicle_id": setup["vehicle"].id, "route_fingerprint": candidate["route_summary"]["route_fingerprint"]})


def legacy_trip(setup):
    """A pre-router trip whose current order misses the early window."""
    db = setup["db"]
    allocation = Allocation(vehicle_id=setup["vehicle"].id, run_id="ROUTE-LEGACY", status=AllocationStatus.DISPATCHED)
    db.add(allocation)
    db.flush()
    for order in (setup["order"], setup["early"]):
        order.allocation_id = allocation.id
    trip = DispatchTrip(trip_code="ROUTE-LEGACY", allocation_id=allocation.id, vehicle_id=setup["vehicle"].id,
                        vehicle_number=setup["vehicle"].code, driver_name="Route Driver", origin="peliyagoda",
                        destination="Colombo", depot_name="peliyagoda", departure_time=datetime(2026, 10, 5, 0, 30),
                        stop_sequence=["ALLOC-OUT", "ZZ-URGENT"])
    db.add(trip)
    db.flush()
    dock = loader_service.create_run_for_dispatch_trip(db, trip)
    db.commit()
    return trip, dock


def preview(client, trip, order=None):
    response = client.post(f"/api/v1/delivery-runs/{trip.id}/route-preview", json={"stop_order": order})
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, trip, comparison, **extra):
    return client.post(f"/api/v1/delivery-runs/{trip.id}/plan", json={
        "plan": {"client_action_id": str(uuid4()), "base_version": comparison["base_version"],
                 "stop_order": comparison["proposed"]["ordered_outlet_codes"]},
        "route_fingerprint": comparison["proposed"]["route_fingerprint"], **extra,
    })


def test_complete_order_allocation_dispatch_loader_trace(loader_client, scenario):
    db = scenario["db"]
    groups = loader_client.get(f"/api/v1/allocation-recommendations/groups?operating_date={DAY}")
    assert groups.status_code == 200
    assert any(set(group["order_ids"]) == set(scenario["ids"]) for group in groups.json())
    candidate = recommendation(loader_client, scenario)
    route = candidate["route_summary"]
    assert candidate["eligible"]
    assert all(not check["blocking"] for check in candidate["constraints"].values())
    assert candidate["constraints"]["fuel"]["status"] == "unknown"
    assert route["ordered_outlet_codes"] == ["ZZ-URGENT", "ALLOC-OUT"]
    assert route["estimated_fuel_liters"] == candidate["constraints"]["fuel"]["projected_liters"] == 3.2
    confirmed = confirm(loader_client, scenario, candidate)
    assert confirmed.status_code == 201, confirmed.text
    allocation = db.get(Allocation, confirmed.json()["id"])
    assert allocation.route_plan == route
    ready = loader_client.patch(f"/api/v1/allocations/{allocation.id}", json={"status": "READY"})
    assert ready.status_code == 200
    dispatched = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")
    assert dispatched.status_code == 201, dispatched.text
    body = dispatched.json()
    assert body["route_plan"] == route
    assert [stop["outlet_code"] for stop in body["stop_sequence"]] == route["ordered_outlet_codes"]
    assert [stop["arrival_at"] for stop in body["stop_sequence"]] == [stop["arrival_at"] for stop in route["arrivals"]]
    dock = loader_service.run_for_dispatch_trip(db, body["id"])
    stops = sorted(loader_service.current_stops(db, dock), key=lambda stop: stop.stop_sequence)
    assert [stop.outlet.code for stop in stops] == route["ordered_outlet_codes"]
    assert [stop.load_position for stop in stops] == [2, 1]
    assert stops[0].eta == datetime.fromisoformat(route["arrivals"][0]["arrival_at"]).astimezone(timezone.utc).replace(tzinfo=None)
    assert stops[0].handling_minutes == 15
    detail = loader_client.get(f"/api/v1/loader/runs/{dock.code}").json()
    assert detail["unacknowledged_plan_version"] == 1


def test_optimized_route_publishes_loader_version_and_reversal(loader_client, scenario):
    trip, dock = legacy_trip(scenario)
    comparison = preview(loader_client, trip)
    assert comparison["current"]["window_feasible"] is False
    assert comparison["proposed"]["route_feasible"] is True
    response = apply(loader_client, trip, comparison)
    assert response.status_code == 200, response.text
    scenario["db"].refresh(dock)
    assert dock.current_plan_version == 2
    stops = sorted(loader_service.current_stops(scenario["db"], dock), key=lambda s: s.stop_sequence)
    assert [s.outlet.code for s in stops] == ["ZZ-URGENT", "ALLOC-OUT"]
    assert [s.load_position for s in stops] == [2, 1]
    assert all(s.eta is not None for s in stops)
    detail = loader_client.get(f"/api/v1/loader/runs/{dock.code}").json()
    assert detail["unacknowledged_plan_version"] == 2


def test_manual_reorder_is_revalidated_and_bad_route_rolls_back(loader_client, scenario):
    trip, dock = legacy_trip(scenario)
    good = preview(loader_client, trip)
    assert apply(loader_client, trip, good).status_code == 200
    bad = preview(loader_client, trip, ["ALLOC-OUT", "ZZ-URGENT"])
    assert bad["proposed"]["arrivals"][1]["window_status"] == "FAIL"
    rejected = apply(loader_client, trip, bad)
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "ROUTE_INFEASIBLE"
    scenario["db"].refresh(dock)
    scenario["db"].refresh(trip)
    assert dock.current_plan_version == 2
    assert [s["outlet_code"] for s in trip.stop_sequence] == ["ZZ-URGENT", "ALLOC-OUT"]


def test_stale_version_still_conflicts_and_identical_apply_replays(loader_client, scenario):
    trip, dock = legacy_trip(scenario)
    comparison = preview(loader_client, trip)
    assert apply(loader_client, trip, comparison).status_code == 200
    assert apply(loader_client, trip, comparison).status_code == 200
    comparison["proposed"]["ordered_outlet_codes"] = ["ALLOC-OUT", "ZZ-URGENT"]
    conflict = apply(loader_client, trip, comparison)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "PLAN_VERSION_STALE"


def test_changed_route_inputs_require_new_preview(loader_client, scenario):
    trip, dock = legacy_trip(scenario)
    comparison = preview(loader_client, trip)
    scenario["vehicle"].km_per_l = 4
    scenario["db"].commit()
    response = apply(loader_client, trip, comparison)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ROUTE_STALE"
    scenario["db"].refresh(dock)
    assert dock.current_plan_version == 1


def test_confirmation_rejects_stale_route(loader_client, scenario):
    candidate = recommendation(loader_client, scenario)
    scenario["vehicle"].km_per_l = 4
    scenario["db"].commit()
    assert confirm(loader_client, scenario, candidate).status_code == 422


def test_dispatch_rejects_changed_confirmed_inputs(loader_client, scenario):
    fresh = recommendation(loader_client, scenario)
    confirmed = confirm(loader_client, scenario, fresh)
    assert confirmed.status_code == 201
    allocation = scenario["db"].get(Allocation, confirmed.json()["id"])
    allocation.status = AllocationStatus.READY
    scenario["outlet"].window_end = time(11)
    scenario["db"].commit()
    rejected = loader_client.post(f"/api/v1/delivery-runs/from-allocation/{allocation.id}")
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "ALLOCATION_ROUTE_STALE"


def test_gate_out_still_locks_optimized_plan(loader_client, scenario):
    trip, dock = legacy_trip(scenario)
    comparison = preview(loader_client, trip)
    dock.status = RunStatus.GATED_OUT
    scenario["db"].commit()
    response = apply(loader_client, trip, comparison)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PLAN_LOCKED"


def test_partial_manual_route_and_patch_bypass_are_rejected(loader_client, scenario):
    trip, _ = legacy_trip(scenario)
    assert loader_client.post(f"/api/v1/delivery-runs/{trip.id}/route-preview", json={"stop_order": ["ZZ-URGENT"]}).status_code == 422
    assert loader_client.patch(f"/api/v1/delivery-runs/{trip.id}", json={"stop_sequence": []}).status_code == 422
