from datetime import datetime, time, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base
from app.models.allocation import Allocation, AllocationStatus
from app.models.allocation_planning import VehicleFuelWeek
from app.models.fleet import DriverProfile, Vehicle, VehicleStatus
from app.models.order import Order, OrderStatus
from app.models.reference import Brand, Depot, Dock, DockType, Outlet
from app.models.user import User, UserRole
from app.services.allocation_confirmation import allocation_confirmation_service
from app.services.service_allowance import allowances
from app.services.district_travel import district_travel
from tests.conftest_loader import loader_client  # noqa: F401

DAY = "2026-10-05"  # Monday, an operating day
DEPARTURE = "2026-10-05T06:00:00+05:30"


def _seed_planning(db: Session, tmp_path, monkeypatch):
    csv_file = tmp_path / "service_allowance.csv"
    csv_file.write_text("brand,dock_type,service_allowance_min\nFresh,rear_dock,15\n", encoding="utf-8")
    monkeypatch.setattr(settings, "SERVICE_ALLOWANCE_CSV", str(csv_file))
    user = User(email="allocation-driver@example.com", full_name="Allocation Driver", role=UserRole.DRIVER)
    vehicle = Vehicle(code="ALLOC-VEH", vehicle_type="truck", capacity_kg=5000,
                      capacity_vol_m3=25, temperature_mode="reefer", depot_name="peliyagoda",
                      weekly_fuel_quota_l=200, km_per_l=5, status=VehicleStatus.AVAILABLE)
    outlet = Outlet(code="ALLOC-OUT", name="Allocation Outlet", brand=Brand.FRESH, district="Colombo",
                    dock_type=DockType.REAR_DOCK, van_only=False, depot=Depot.PELIYAGODA,
                    window_start=time(7), window_end=time(12))
    dock = Dock(code="ALLOC-DOCK", name="Allocation Dock", depot=Depot.PELIYAGODA)
    db.add_all([user, vehicle, outlet, dock])
    db.flush()
    driver = DriverProfile(user_id=user.id, assigned_vehicle_id=vehicle.id, license_type="heavy", phone="1234567890")
    order = Order(order_number="ALLOC-ORDER", client_name="Allocation Outlet", destination_address="Colombo",
                  status=OrderStatus.CONFIRMED, depot=Depot.PELIYAGODA, outlet_id=outlet.id,
                  brand="Fresh", district="Colombo", operating_date=DAY, temperature_zone="Ambient",
                  weight_kg=1000, volume_m3=5, delivery_window="07:00 – 12:00", is_late=False)
    db.add_all([driver, order])
    db.add_all([
        VehicleFuelWeek(vehicle_id=vehicle.id, week_start=datetime.fromisoformat(DAY).date(), liters_used=100,
                        source="verified-meter", recorded_at=datetime.now(timezone.utc)),
    ])
    db.commit()
    return {"db": db, "vehicle": vehicle, "outlet": outlet, "order": order}


@pytest.fixture
def planning(db_session, tmp_path, monkeypatch):
    return _seed_planning(db_session, tmp_path, monkeypatch)


def _recommend(client, setup, **extra):
    return client.post("/api/v1/allocation-recommendations", json={
        "order_ids": [setup["order"].id], "departure_time": DEPARTURE, **extra,
    })


def _confirm(client, setup, **extra):
    return client.post("/api/v1/allocations/confirm", json={
        "order_ids": [setup["order"].id], "vehicle_id": setup["vehicle"].id,
        "departure_time": DEPARTURE, **extra,
    })


def _checks(client, setup):
    response = _recommend(client, setup)
    assert response.status_code == 200, response.text
    candidate = next(row for row in response.json()["vehicles"] if row["vehicle_id"] == setup["vehicle"].id)
    return candidate


def test_recommendation_uses_recorded_inputs(loader_client, planning):
    candidate = _checks(loader_client, planning)
    assert candidate["eligible"] is True
    assert candidate["recommendation_score"] is not None
    assert candidate["route_summary"]["estimated_distance_km"] == 12
    assert candidate["route_summary"]["estimated_duration_minutes"] == 39
    assert candidate["route_summary"]["scheduled_elapsed_minutes"] == 75
    assert candidate["route_summary"]["window_feasible"] is True
    assert candidate["constraints"]["fuel"]["projected_liters"] == 2.4


@pytest.mark.parametrize("change,expected", [
    ("temperature", "temperature"),
    ("access", "access"),
    ("weight", "weight"),
    ("volume", "volume"),
    ("depot", "depot"),
    ("availability", "availability"),
    ("trips_today", "trips_today"),
    ("fuel", "fuel"),
    ("delivery_windows", "delivery_windows"),
])
def test_hard_constraint_failures(loader_client, planning, change, expected):
    db = planning["db"]
    vehicle, outlet, order = planning["vehicle"], planning["outlet"], planning["order"]
    if change == "temperature":
        vehicle.temperature_mode = "ambient"
        order.temperature_zone = "Chilled"
    elif change == "access":
        outlet.van_only = True
    elif change == "weight":
        order.weight_kg = vehicle.capacity_kg + 1
    elif change == "volume":
        order.volume_m3 = vehicle.capacity_vol_m3 + 1
    elif change == "depot":
        vehicle.depot_name = "kandy"
        # Recommendations list depot vehicles only; confirm checks explicit wrong vehicle IDs.
    elif change == "availability":
        vehicle.status = VehicleStatus.UNAVAILABLE
    elif change == "trips_today":
        db.add_all([
            Allocation(vehicle_id=vehicle.id, status=AllocationStatus.COMPLETED,
                       departure_time=datetime(2026, 10, 5, 1, 0)),
            Allocation(vehicle_id=vehicle.id, status=AllocationStatus.COMPLETED,
                       departure_time=datetime(2026, 10, 5, 2, 0)),
        ])
    elif change == "fuel":
        vehicle.weekly_fuel_status = "Exceeded quota"
    elif change == "delivery_windows":
        order.delivery_window = None
        outlet.window_start = time(6)
        outlet.window_end = time(6, 38)
    db.commit()
    if change == "depot":
        response = _confirm(loader_client, planning)
        assert response.status_code == 422
        assert any(item["constraint"] == "DEPOT" for item in response.json()["detail"]["violations"])
        return
    candidate = _checks(loader_client, planning)
    assert candidate["eligible"] is False
    assert candidate["recommendation_score"] is None
    assert candidate["constraints"][expected]["status"] == "fail"


def test_missing_reference_data_blocks_confirmation(loader_client, planning, monkeypatch):
    vehicle_id = planning["vehicle"].id
    monkeypatch.setattr(settings, "SERVICE_ALLOWANCE_CSV", "missing/service_allowance.csv")
    response = _confirm(loader_client, planning)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "ALLOCATION_CONSTRAINT_FAILED"
    assert any(row["constraint"] == "DELIVERY_WINDOWS" and row["status"] == "unknown"
               for row in response.json()["detail"]["violations"])
    assert planning["db"].query(Allocation).filter_by(vehicle_id=vehicle_id).count() == 0


def test_confirmation_is_atomic_and_prevents_duplicate_orders(loader_client, planning):
    first = _confirm(loader_client, planning)
    assert first.status_code == 201, first.text
    assert first.json()["driver_id"] == planning["vehicle"].driver.id
    allocation_id = first.json()["id"]
    db = planning["db"]
    db.expire_all()
    assert planning["order"].allocation_id == allocation_id
    assert planning["order"].status == OrderStatus.ALLOCATED
    assert planning["vehicle"].status == VehicleStatus.ALLOCATED
    vehicle_id = planning["vehicle"].id
    assert db.query(Allocation).filter_by(vehicle_id=vehicle_id).count() == 1
    status_change = loader_client.patch(
        f"/api/v1/fleet/vehicles/{vehicle_id}/status?status=AVAILABLE"
    )
    assert status_change.status_code == 409
    second = _confirm(loader_client, planning)
    assert second.status_code == 422


def test_missing_fuel_and_driver_are_warnings_and_confirmation_succeeds(loader_client, planning):
    db = planning["db"]
    db.query(VehicleFuelWeek).filter_by(vehicle_id=planning["vehicle"].id).delete()
    db.query(DriverProfile).filter_by(assigned_vehicle_id=planning["vehicle"].id).delete()
    db.commit()
    db.expire_all()
    candidate = _checks(loader_client, planning)
    assert candidate["eligible"] is True
    assert candidate["recommendation_score"] is not None
    assert candidate["constraints"]["delivery_windows"]["status"] == "pass"
    assert candidate["constraints"]["fuel"]["status"] == "unknown"
    assert candidate["constraints"]["fuel"]["blocking"] is False
    assert candidate["constraints"]["fuel"]["message"] == "Not verified"
    assert candidate["constraints"]["driver"]["status"] == "unknown"
    assert candidate["constraints"]["driver"]["blocking"] is False
    assert candidate["constraints"]["driver"]["message"] == "Not assigned"
    response = _confirm(loader_client, planning)
    assert response.status_code == 201, response.text
    assert response.json()["driver_id"] is None


def test_explicit_exceeded_quota_still_blocks_confirmation(loader_client, planning):
    planning["vehicle"].weekly_fuel_status = " Exceeded quota "
    planning["db"].commit()
    response = _confirm(loader_client, planning)
    assert response.status_code == 422
    assert any(item["constraint"] == "FUEL" and item["status"] == "fail"
               for item in response.json()["detail"]["violations"])


def test_unavailable_fuel_economy_is_advisory(loader_client, planning):
    planning["vehicle"].km_per_l = 0
    planning["db"].commit()
    candidate = _checks(loader_client, planning)
    assert candidate["eligible"] is True
    assert candidate["recommendation_score"] is not None
    assert candidate["constraints"]["fuel"]["blocking"] is False
    assert candidate["constraints"]["fuel"]["projected_liters"] is None


def test_missing_district_reference_blocks_confirmation(loader_client, planning, monkeypatch):
    monkeypatch.setattr(settings, "DISTRICT_TRAVEL_CSV", "missing/district_travel.csv")
    response = _confirm(loader_client, planning)
    assert response.status_code == 422
    assert any(item["constraint"] == "DELIVERY_WINDOWS" and item["status"] == "unknown"
               for item in response.json()["detail"]["violations"])


def test_two_stop_route_uses_official_district_formula(loader_client, planning):
    db = planning["db"]
    second = Outlet(code="ALLOC-OUT-2", name="Second Outlet", brand=Brand.FRESH, district="Colombo",
                    dock_type=DockType.REAR_DOCK, van_only=False, depot=Depot.PELIYAGODA,
                    window_start=time(7), window_end=time(12))
    db.add(second)
    db.flush()
    order = Order(order_number="ALLOC-ORDER-2", client_name="Second Outlet", destination_address="Colombo",
                  status=OrderStatus.CONFIRMED, depot=Depot.PELIYAGODA, outlet_id=second.id,
                  brand="Fresh", district="Colombo", operating_date=DAY, temperature_zone="Ambient",
                  weight_kg=500, volume_m3=3, delivery_window="07:00 - 12:00", is_late=False)
    db.add(order)
    db.commit()
    response = loader_client.post("/api/v1/allocation-recommendations", json={
        "order_ids": [planning["order"].id, order.id], "departure_time": DEPARTURE,
    })
    assert response.status_code == 200, response.text
    candidate = next(row for row in response.json()["vehicles"] if row["vehicle_id"] == planning["vehicle"].id)
    assert candidate["eligible"] is True
    assert candidate["route_summary"]["estimated_duration_minutes"] == 62
    assert candidate["route_summary"]["estimated_distance_km"] == 16


def test_commit_failure_rolls_back_vehicle_order_and_allocation(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            setup = _seed_planning(db, tmp_path, monkeypatch)
            vehicle_id, order_id = setup["vehicle"].id, setup["order"].id

            def fail_commit():
                raise RuntimeError("database commit failed")

            monkeypatch.setattr(db, "commit", fail_commit)
            with pytest.raises(RuntimeError, match="database commit failed"):
                allocation_confirmation_service.confirm(
                    db, vehicle_id=vehicle_id, order_ids=[order_id],
                    departure_time=datetime.fromisoformat(DEPARTURE), depot=Depot.PELIYAGODA,
                )
        with Session(engine) as check:
            assert check.query(Allocation).count() == 0
            assert check.get(Order, order_id).allocation_id is None
            assert check.get(Order, order_id).status == OrderStatus.CONFIRMED
            assert check.get(Vehicle, vehicle_id).status == VehicleStatus.AVAILABLE
    finally:
        engine.dispose()


def test_official_service_allowance_reference(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_ALLOWANCE_CSV", "app/reference_data/service_allowance.csv")
    from app.models.reference import DockType
    table = allowances()
    assert len(table) == 9
    assert table[(Brand.FRESH, DockType.REAR_DOCK)] == 15
    assert table[(Brand.STYLE, DockType.MALL_BAY)] == 59
    assert table[(Brand.TECH, DockType.STREET)] == 55


def test_official_district_travel_reference(monkeypatch):
    monkeypatch.setattr(settings, "DISTRICT_TRAVEL_CSV", "app/reference_data/district_travel.csv")
    table = district_travel()
    assert len(table) == 12
    assert table[(Depot.PELIYAGODA, "colombo")].depot_to_district_freeflow_min == 24
    assert table[(Depot.KANDY, "matale")].inter_stop_km == 8


def test_admin_can_update_recorded_fuel_input(loader_client, planning):
    vehicle_id = planning["vehicle"].id
    fuel = loader_client.put(f"/api/v1/planning-inputs/fuel-weeks/{vehicle_id}/{DAY}", json={
        "liters_used": 150, "source": "meter-check",
    })
    assert fuel.status_code == 200, fuel.text
    assert fuel.json()["liters_used"] == 150
    candidate = _checks(loader_client, planning)
    assert candidate["route_summary"]["estimated_distance_km"] == 12
    assert candidate["constraints"]["fuel"]["message"] == "Not verified"
    assert candidate["constraints"]["fuel"]["blocking"] is False


@pytest.mark.parametrize("vehicle_type", ["truck", "lorry"])
@pytest.mark.parametrize("restriction_field", ["parking_constraint", "van_only"])
def test_out003_chilled_orders_recommend_both_reefer_vans(loader_client, planning, vehicle_type, restriction_field):
    db = planning["db"]
    planning["vehicle"].vehicle_type = vehicle_type
    planning["outlet"].code = "OUT003"
    planning["outlet"].parking_constraint = "van_only" if restriction_field == "parking_constraint" else "normal"
    planning["outlet"].van_only = restriction_field == "van_only"
    planning["order"].temperature_zone = "Chilled"
    planning["order"].weight_kg = 1040
    planning["order"].volume_m3 = 7
    db.query(VehicleFuelWeek).delete()
    for code in ("VEH035", "VEH036"):
        db.add(Vehicle(code=code, vehicle_type="van", capacity_kg=1040, capacity_vol_m3=7,
                       temperature_mode="reefer", depot_name="peliyagoda", status=VehicleStatus.AVAILABLE,
                       km_per_l=8, weekly_fuel_quota_l=100, weekly_fuel_status="Within quota"))
    db.commit()
    response = _recommend(loader_client, planning)
    assert response.status_code == 200, response.text
    assert response.json()["order_group"]["required_vehicle_type"] == "van"
    assert response.json()["order_group"]["van_only_outlets"] == ["OUT003"]
    groups = loader_client.get(f"/api/v1/allocation-recommendations/groups?operating_date={DAY}")
    assert groups.status_code == 200, groups.text
    group = next(item for item in groups.json() if planning["order"].id in item["order_ids"])
    assert group["required_vehicle_type"] == "van"
    assert group["van_only_outlets"] == ["OUT003"]
    candidates = {item["vehicle_code"]: item for item in response.json()["vehicles"]}
    for code in ("VEH035", "VEH036"):
        assert candidates[code]["eligible"] is True
        assert candidates[code]["constraints"]["driver"]["blocking"] is False
        assert candidates[code]["constraints"]["fuel"]["blocking"] is False
    assert candidates["ALLOC-VEH"]["eligible"] is False
    assert candidates["ALLOC-VEH"]["constraints"]["access"]["status"] == "fail"
    assert "OUT003" in candidates["ALLOC-VEH"]["constraints"]["access"]["message"]


@pytest.mark.parametrize("vehicle_type", ["van", "truck", "lorry"])
def test_normal_outlet_does_not_force_a_vehicle_type(loader_client, planning, vehicle_type):
    planning["vehicle"].vehicle_type = vehicle_type
    planning["outlet"].parking_constraint = "normal"
    planning["db"].commit()
    response = _recommend(loader_client, planning)
    assert response.status_code == 200, response.text
    assert response.json()["order_group"]["required_vehicle_type"] is None
    assert response.json()["order_group"]["van_only_outlets"] == []
    assert _checks(loader_client, planning)["eligible"] is True


def test_confirmation_rechecks_outlet_access_after_recommendation(loader_client, planning):
    assert _checks(loader_client, planning)["eligible"] is True
    planning["outlet"].parking_constraint = "van_only"
    planning["db"].commit()
    response = _confirm(loader_client, planning)
    assert response.status_code == 422, response.text
    assert any(item["constraint"] == "ACCESS" and item["status"] == "fail"
               for item in response.json()["detail"]["violations"])


@pytest.mark.parametrize("brand,count,allowance,budget", [("Fresh", 6, 15, 270), ("Style", 5, 38, 480)])
def test_official_time_budget_sums_same_day_trips(loader_client, planning, tmp_path, monkeypatch, brand, count, allowance, budget):
    db = planning["db"]
    csv_file = tmp_path / "budget_allowance.csv"
    csv_file.write_text(f"brand,dock_type,service_allowance_min\n{brand},rear_dock,{allowance}\n")
    monkeypatch.setattr(settings, "SERVICE_ALLOWANCE_CSV", str(csv_file))
    planning["order"].brand = brand
    planning["outlet"].brand = Brand(brand.lower())
    previous = Allocation(vehicle_id=planning["vehicle"].id, status=AllocationStatus.COMPLETED,
                          departure_time=datetime(2026, 10, 5, 0, 0))
    db.add(previous)
    db.flush()
    current_ids = [planning["order"].id]
    for index in range(count * 2 - 1):
        historical = index < count
        order = Order(order_number=f"BUDGET-{index}", client_name="Budget Outlet", destination_address="Colombo",
                      status=OrderStatus.COMPLETED if historical else OrderStatus.CONFIRMED,
                      allocation_id=previous.id if historical else None, depot=Depot.PELIYAGODA,
                      outlet_id=planning["outlet"].id, brand=brand, district="Colombo", operating_date=DAY,
                      temperature_zone="Ambient", weight_kg=1, volume_m3=0.01, is_late=False)
        db.add(order)
        db.flush()
        if not historical:
            current_ids.append(order.id)
    db.commit()
    response = _recommend(loader_client, planning, order_ids=current_ids)
    candidate = next(item for item in response.json()["vehicles"] if item["vehicle_id"] == planning["vehicle"].id)
    check = candidate["constraints"]["trip_time_budget"]
    assert check["maximum_minutes"] == budget
    assert check["used_minutes"] == check["projected_minutes"] == 24 + (count - 1) * 8 + count * allowance
    assert check["status"] == "fail" and check["blocking"] is True
    assert candidate["constraints"]["trips_today"]["status"] == "pass"
    assert candidate["eligible"] is False
