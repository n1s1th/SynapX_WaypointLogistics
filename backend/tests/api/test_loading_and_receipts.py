from datetime import datetime, timezone


def test_delivery_receipt_flow(client):
    order_id = 1
    outlet_id = 5
    now_iso = datetime.now(timezone.utc).isoformat()

    # Submit receipt
    payload = {
        "order_id": order_id,
        "outlet_id": outlet_id,
        "units_received": 40,
        "weight_received_kg": 120.5,
        "has_issues": False,
        "confirmed_at": now_iso,
        "synced_from_offline": False,
    }
    submit_res = client.post("/api/receipts", json=payload)
    assert submit_res.status_code == 201
    receipt = submit_res.json()
    assert receipt["order_id"] == order_id
    assert receipt["has_issues"] is False

    # Duplicate should 409
    dup_res = client.post("/api/receipts", json=payload)
    assert dup_res.status_code == 409

    # Get receipt
    get_res = client.get(f"/api/receipts/{order_id}")
    assert get_res.status_code == 200
    assert get_res.json()["outlet_id"] == outlet_id


def test_offline_receipt_sync(client):
    order_1 = 101
    order_2 = 102
    now_iso = datetime.now(timezone.utc).isoformat()

    batch = {
        "receipts": [
            {
                "order_id": order_1,
                "outlet_id": 5,
                "units_received": 30,
                "has_issues": False,
                "confirmed_at": now_iso,
                "synced_from_offline": True,
            },
            {
                "order_id": order_2,
                "outlet_id": 5,
                "units_received": 20,
                "has_issues": True,
                "issue_type": "damaged",
                "issue_description": "2 units crushed in transit",
                "confirmed_at": now_iso,
                "synced_from_offline": True,
            },
        ]
    }
    sync_res = client.post("/api/receipts/sync", json=batch)
    assert sync_res.status_code == 200
    data = sync_res.json()
    assert data["synced"] == 2
    assert data["skipped"] == 0

    # Repeat sync should skip existing
    sync_res_2 = client.post("/api/receipts/sync", json=batch)
    assert sync_res_2.status_code == 200
    data_2 = sync_res_2.json()
    assert data_2["synced"] == 0
    assert data_2["skipped"] == 2
