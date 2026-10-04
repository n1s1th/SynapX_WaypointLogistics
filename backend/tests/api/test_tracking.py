def test_dispatch_and_tracking(client):
    # 1. Create Order to associate shipment with
    order_res = client.post("/api/v1/orders/", json={
        "order_number": "ORD-DISPATCH-99",
        "client_name": "Metro Freight Inc",
        "destination_address": "88 Harbor Rd, Boston, MA",
        "status": "PROCESSING",
        "items": []
    })
    order_id = order_res.json()["id"]

    # 2. Create Dispatch Trip
    trip_res = client.post("/api/v1/delivery-runs/", json={
        "trip_code": "TRIP-BOS-2026",
        "vehicle_number": "TRK-9812",
        "driver_name": "Marcus Vance",
        "origin": "Newark, NJ Hub",
        "destination": "Boston, MA Depot",
    })
    assert trip_res.status_code == 201, trip_res.text
    trip_id = trip_res.json()["id"]

    # 3. Create Shipment
    shipment_res = client.post("/api/v1/tracking/", json={
        "tracking_number": "TRK-MA-554433",
        "order_id": order_id,
        "dispatch_trip_id": trip_id,
        "status": "PENDING",
        "current_location": "Newark Hub Facility",
        "latitude": 40.7357,
        "longitude": -74.1724,
    })
    assert shipment_res.status_code == 201, shipment_res.text
    shipment = shipment_res.json()
    assert shipment["tracking_number"] == "TRK-MA-554433"

    # 4. Track Shipment by Tracking Number
    track_res = client.get("/api/v1/tracking/TRK-MA-554433")
    assert track_res.status_code == 200
    assert track_res.json()["status"] == "PENDING"

    # 5. Live GPS and Status update
    update_res = client.patch("/api/v1/tracking/TRK-MA-554433", json={
        "status": "IN_TRANSIT",
        "current_location": "I-95 North Mile Marker 72",
        "latitude": 41.3083,
        "longitude": -72.9279,
    })
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["status"] == "IN_TRANSIT"
    assert updated["current_location"] == "I-95 North Mile Marker 72"
