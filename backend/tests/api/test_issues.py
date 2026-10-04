import pytest
from fastapi.testclient import TestClient


def test_list_and_create_issue(client: TestClient):
    # 1. No demo issues are seeded: a fresh database starts empty
    res = client.get("/api/v1/issues")
    assert res.status_code == 200
    assert res.json() == []

    # 2. Create new delivery issue
    new_issue_payload = {
        "order_number": "ORD0000010",
        "outlet_id": 5,
        "issue_type": "Damaged Goods",
        "title": "Crushed boxes of tomatoes",
        "affected_item": "Fresh Tomatoes 5kg",
        "sku": "SKU-990",
        "expected_units": 10,
        "received_units": 7,
        "description": "3 boxes crushed during handling.",
        "photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "photo_name": "tomatoes.png",
        "photo_size": "1.2 MB",
        "reported_by": "Sarah Jenkins (Store Manager)",
        "driver_name": "Kamal Perera",
        "vehicle_id": "VEH001",
    }
    create_res = client.post("/api/v1/issues", json=new_issue_payload)
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["id"] is not None
    assert created["title"] == "Crushed boxes of tomatoes"
    assert created["photo_url"] is not None
    assert created["status"] == "open"

    # 3. Update issue details (edit complaint) and status
    patch_res = client.patch(
        f"/api/v1/issues/{created['id']}",
        json={"title": "Updated: Crushed tomatoes", "received_units": 6, "status": "under_review"},
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["title"] == "Updated: Crushed tomatoes"
    assert updated["received_units"] == 6
    assert updated["status"] == "under_review"

    # 4. Delete / withdraw issue
    del_res = client.delete(f"/api/v1/issues/{created['id']}")
    assert del_res.status_code == 204

    # Confirm it is removed
    get_res = client.get(f"/api/v1/issues/{created['id']}")
    assert get_res.status_code == 404

