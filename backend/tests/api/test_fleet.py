from app.core.config import settings
from app.models.allocation import Allocation, AllocationStatus


def create(client, code="TEST-FLEET"):
    return client.post("/api/v1/fleet/vehicles", json={"code": code, "vehicle_type": "truck", "capacity_kg": 1000, "capacity_vol_m3": 8, "depot_name": "Kandy"})


def test_create_edit_and_conflict(client):
    response = create(client)
    assert response.status_code == 201
    vehicle = response.json()
    url = f"/api/v1/fleet/vehicles/{vehicle['id']}"
    payload = {"expected_updated_at": vehicle["updated_at"], "status": "unavailable", "maintenance_state": "Service due", "weekly_fuel_status": "Refuel required", "capacity_kg": 1200}
    updated = client.patch(url, json=payload)
    assert updated.status_code == 200
    assert updated.json()["capacity_kg"] == 1200
    assert updated.json()["status"] == "unavailable"
    assert updated.json()["weekly_fuel_status"] == "Refuel required"
    assert client.patch(url, json=payload).status_code == 409
    clear = client.patch(url, json={"expected_updated_at": updated.json()["updated_at"], "maintenance_state": None})
    assert clear.status_code == 200 and clear.json()["maintenance_state"] is None
    assert create(client).status_code in (400, 409)


def test_active_allocation_blocks_specs_and_availability_but_allows_status_notes(client, db_session):
    vehicle = create(client, "ASSIGNED").json()
    db_session.add(Allocation(vehicle_id=vehicle["id"], status=AllocationStatus.ALLOCATED))
    db_session.commit()
    url = f"/api/v1/fleet/vehicles/{vehicle['id']}"
    assert client.patch(url, json={"expected_updated_at": vehicle["updated_at"], "status": "unavailable"}).status_code == 409
    assert client.patch(url, json={"expected_updated_at": vehicle["updated_at"], "capacity_kg": 2000}).status_code == 409
    assert client.patch(url, json={"expected_updated_at": vehicle["updated_at"], "maintenance_state": "Inspect tyres"}).status_code == 200


def test_validation_and_missing_vehicle(client):
    assert client.post("/api/v1/fleet/vehicles", json={"code": " ", "vehicle_type": "truck", "capacity_kg": -1}).status_code == 422
    assert client.post("/api/v1/fleet/vehicles", json={"code": "TEST", "vehicle_type": "truck", "capacity_kg": 1, "status": "allocated"}).status_code == 422
    vehicle = create(client, "VALIDATION").json()
    url = f"/api/v1/fleet/vehicles/{vehicle['id']}"
    for changes in ({"status": "loading"}, {"code": None}, {"capacity_kg": 0}, {"depot_name": " "}, {"trips_today": 9}):
        assert client.patch(url, json={"expected_updated_at": vehicle["updated_at"], **changes}).status_code == 422
    assert client.patch("/api/v1/fleet/vehicles/999999", json={"expected_updated_at": vehicle["updated_at"], "status": "available"}).status_code == 404


def test_write_requires_auth_outside_dev_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "KEYCLOAK_DEV_MODE", False)
    assert create(client, "NO-AUTH").status_code == 401
    assert client.patch("/api/v1/fleet/vehicles/1", json={"expected_updated_at": "2026-01-01T00:00:00", "status": "available"}).status_code == 401
