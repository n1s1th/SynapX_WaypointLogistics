from app.models.allocation import AllocationStatus
from app.models.fleet import VehicleStatus


def test_fleet_and_allocations_flow(client):
    # 1. Create a vehicle
    vehicle_payload = {
        "code": "VEH-TEST-001",
        "vehicle_type": "truck",
        "capacity_kg": 5000.0,
        "capacity_vol_m3": 25.0,
        "status": "AVAILABLE",
        "temperature_mode": "reefer",
        "depot_name": "peliyagoda",
        "weekly_fuel_status": "Within quota",
    }
    res = client.post("/api/v1/fleet/vehicles", json=vehicle_payload)
    assert res.status_code == 201, res.text
    vehicle = res.json()
    assert vehicle["code"] == "VEH-TEST-001"
    vehicle_id = vehicle["id"]

    # Prevent duplicate vehicle code
    dup_res = client.post("/api/v1/fleet/vehicles", json=vehicle_payload)
    assert dup_res.status_code == 400

    # 2. Filter vehicles by status
    list_res = client.get("/api/v1/fleet/vehicles?status=AVAILABLE")
    assert list_res.status_code == 200
    vehicles = list_res.json()
    assert any(v["code"] == "VEH-TEST-001" for v in vehicles)

    # 3. Create allocation
    alloc_payload = {
        "vehicle_id": vehicle_id,
        "run_id": "RUN-TEST-001",
        "load_percentage": 75.0,
        "volume_percentage": 80.0,
        "status": "DRAFT",
    }
    alloc_res = client.post("/api/v1/allocations/", json=alloc_payload)
    assert alloc_res.status_code == 201, alloc_res.text
    alloc = alloc_res.json()
    assert alloc["run_id"] == "RUN-TEST-001"
    alloc_id = alloc["id"]

    # Verify vehicle status is now allocated
    v_check = client.get("/api/v1/fleet/vehicles")
    veh_updated = next(v for v in v_check.json() if v["id"] == vehicle_id)
    assert veh_updated["status"] == VehicleStatus.ALLOCATED.value.lower()

    # Cannot re-allocate the same vehicle while allocated
    alloc_fail = client.post("/api/v1/allocations/", json=alloc_payload)
    assert alloc_fail.status_code == 400

    # 4. Get allocation by ID
    get_res = client.get(f"/api/v1/allocations/{alloc_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == alloc_id

    # 5. List allocations
    all_allocs = client.get("/api/v1/allocations/")
    assert all_allocs.status_code == 200
    assert any(a["id"] == alloc_id for a in all_allocs.json())

    # 6. Update allocation to LOADING
    patch_res = client.patch(
        f"/api/v1/allocations/{alloc_id}",
        json={"status": "LOADING"}
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "LOADING"

    # 7. Update allocation to COMPLETED -> vehicle freed
    complete_res = client.patch(
        f"/api/v1/allocations/{alloc_id}",
        json={"status": "COMPLETED"}
    )
    assert complete_res.status_code == 200
    assert complete_res.json()["status"] == "COMPLETED"

    v_after_complete = client.get(f"/api/v1/fleet/vehicles?status=AVAILABLE")
    assert any(v["id"] == vehicle_id for v in v_after_complete.json())

    # 8. Soft-delete / cancel allocation
    del_res = client.delete(f"/api/v1/allocations/{alloc_id}")
    assert del_res.status_code == 200
    get_cancelled = client.get(f"/api/v1/allocations/{alloc_id}")
    assert get_cancelled.json()["status"] == "CANCELLED"
