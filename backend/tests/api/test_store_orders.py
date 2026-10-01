from datetime import date, datetime, time

import pytest

from app.api import deps
from app.main import app
from app.models.reference import Brand, CalendarDay, Depot, DockType, Outlet

NOW = datetime(2026, 9, 26, 6, 0)  # Sat 26 Sep, 06:00 — the day the Figma screens show


@pytest.fixture
def clock():
    """Pins the service clock. Tests can move it with clock["now"] = …"""
    state = {"now": NOW}
    app.dependency_overrides[deps.get_now] = lambda: state["now"]
    yield state
    app.dependency_overrides.pop(deps.get_now, None)


@pytest.fixture
def outlets(db_session):
    fresh = Outlet(
        code="OUT005", name="Fresh Colombo", brand=Brand.FRESH, district="Colombo",
        dock_type=DockType.REAR_DOCK, window_start=time(4, 0), window_end=time(7, 45), depot=Depot.PELIYAGODA,
    )
    style = Outlet(
        code="OUT015", name="Style Mall", brand=Brand.STYLE, district="Colombo",
        dock_type=DockType.MALL_BAY, window_start=time(8, 0), window_end=time(10, 0), depot=Depot.PELIYAGODA,
    )
    db_session.add_all([fresh, style, CalendarDay(date=date(2026, 10, 1), is_operating=False, holiday_name="Poya Day")])
    db_session.commit()
    return {"fresh": fresh, "style": style}


def item(sku, zone, qty=5, name=None):
    return {"sku": sku, "item_name": name or f"Item {sku}", "quantity": qty, "temperature_zone": zone}


def place(client, outlet_id, delivery_date, items, priority=False, notes=None):
    return client.post(
        "/api/v1/orders/store",
        json={"outlet_id": outlet_id, "delivery_date": delivery_date, "is_priority": priority, "notes": notes, "items": items},
    )


def test_mixed_request_splits_into_one_order_per_zone(client, clock, outlets):
    res = place(
        client, outlets["fresh"].id, "2026-09-30",
        [item("SKU-063", "Chilled", 15), item("SKU-001", "Ambient", 6), item("SKU-014", "Chilled", 10)],
        notes="Check seals on paper cups.",
    )
    assert res.status_code == 201, res.text
    orders = res.json()
    assert [o["temperature_zone"] for o in orders] == ["Chilled", "Ambient"]
    assert [o["order_number"] for o in orders] == ["ORD0000001", "ORD0000002"]
    chilled = orders[0]
    assert chilled["status"] == "SUBMITTED"
    assert chilled["brand"] == "Fresh"
    assert chilled["units"] == 25
    assert chilled["operating_date"] == "2026-09-30"
    assert chilled["delivery_window"] == "04:00 – 07:45"
    assert chilled["cutoff_at"] == "2026-09-29T16:00:00"
    assert chilled["notes"] == "Check seals on paper cups."
    assert {i["sku"] for i in chilled["items"]} == {"SKU-063", "SKU-014"}

    notifications = client.get("/api/v1/notifications/", params={"outlet_id": outlets["fresh"].id}).json()
    assert {n["type"] for n in notifications} == {"order_submitted"}
    assert {n["order_number"] for n in notifications} == {"ORD0000001", "ORD0000002"}
    assert len(notifications) == 2


def test_fresh_outlet_cannot_place_a_second_chilled_order_for_the_same_day(client, clock, outlets):
    assert place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-063", "Chilled")]).status_code == 201
    res = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-070", "Chilled")])
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "DUPLICATE_ORDER"
    assert res.json()["detail"]["existing_orders"] == ["ORD0000001"]
    # One ambient order the same day is still allowed
    assert place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient")]).status_code == 201


def test_style_outlet_gets_one_order_per_day_and_no_mixed_zones(client, clock, outlets):
    res = place(client, outlets["style"].id, "2026-09-30", [item("SKU-500", "Chilled"), item("SKU-501", "Ambient")])
    assert res.json()["detail"]["code"] == "MIXED_ZONES_NOT_ALLOWED"
    assert place(client, outlets["style"].id, "2026-09-30", [item("SKU-501", "Ambient")]).status_code == 201
    res = place(client, outlets["style"].id, "2026-09-30", [item("SKU-502", "Ambient")])
    assert res.json()["detail"]["code"] == "DUPLICATE_ORDER"


def test_holidays_and_sundays_are_rejected_with_the_next_operating_day(client, clock, outlets):
    res = place(client, outlets["fresh"].id, "2026-10-01", [item("SKU-001", "Ambient")])
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "NOT_OPERATING_DAY"
    assert res.json()["detail"]["suggested_date"] == "2026-10-02"
    assert "Poya Day" in res.json()["detail"]["message"]

    res = place(client, outlets["fresh"].id, "2026-09-27", [item("SKU-001", "Ambient")])
    assert res.json()["detail"]["suggested_date"] == "2026-09-28"


def test_default_orders_need_two_operating_days_but_high_priority_needs_one(client, clock, outlets):
    res = place(client, outlets["fresh"].id, "2026-09-28", [item("SKU-001", "Ambient")])
    assert res.json()["detail"]["code"] == "TOO_EARLY"
    assert res.json()["detail"]["earliest_date"] == "2026-09-29"
    assert place(client, outlets["fresh"].id, "2026-09-28", [item("SKU-001", "Ambient")], priority=True).status_code == 201


def test_cutoff_is_strict_at_4pm_the_day_before(client, clock, outlets):
    clock["now"] = datetime(2026, 9, 29, 16, 0, 0)
    res = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient")], priority=True)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "CUTOFF_PASSED"


def test_invalid_payload_is_rejected(client, clock, outlets):
    assert place(client, outlets["fresh"].id, "2026-09-30", []).status_code == 422
    assert place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient", qty=0)]).status_code == 422
    assert place(client, 9999, "2026-09-30", [item("SKU-001", "Ambient")]).status_code == 404


def test_list_filters_and_detail(client, clock, outlets):
    fresh_id = outlets["fresh"].id
    place(client, fresh_id, "2026-09-30", [item("SKU-063", "Chilled", name="Greek Yogurt 500g")], priority=True)
    place(client, fresh_id, "2026-10-02", [item("SKU-001", "Ambient", name="Bottled Water 500ml")])

    all_orders = client.get("/api/v1/orders/store", params={"outlet_id": fresh_id}).json()
    assert len(all_orders) == 2
    high = client.get("/api/v1/orders/store", params={"outlet_id": fresh_id, "priority": True}).json()
    assert [o["order_number"] for o in high] == ["ORD0000001"]
    by_item = client.get("/api/v1/orders/store", params={"outlet_id": fresh_id, "search": "water"}).json()
    assert [o["order_number"] for o in by_item] == ["ORD0000002"]
    by_status = client.get("/api/v1/orders/store", params=[("outlet_id", fresh_id), ("status", "SUBMITTED"), ("status", "PROCESSING")]).json()
    assert len(by_status) == 2
    none = client.get("/api/v1/orders/store", params={"outlet_id": fresh_id, "date_from": "2026-09-27"}).json()
    assert none == []

    detail = client.get("/api/v1/orders/store/ord0000001")
    assert detail.status_code == 200
    assert detail.json()["items"][0]["item_name"] == "Greek Yogurt 500g"
    assert client.get("/api/v1/orders/store/ORD9999999").status_code == 404


def test_cancel_only_before_cutoff_and_only_early_statuses(client, clock, outlets):
    orders = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-063", "Chilled"), item("SKU-001", "Ambient")]).json()
    chilled_id, ambient_id = orders[0]["id"], orders[1]["id"]

    res = client.post(f"/api/v1/orders/{chilled_id}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "CANCELLED"

    clock["now"] = datetime(2026, 9, 29, 16, 30)
    res = client.post(f"/api/v1/orders/{ambient_id}/cancel")
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "CUTOFF_PASSED"


def test_status_updates_follow_the_lifecycle_and_notify_the_store(client, clock, outlets):
    order = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient")]).json()[0]
    oid = order["id"]

    assert client.patch(f"/api/v1/orders/{oid}/status", json={"status": "DELIVERED"}).status_code == 409
    assert client.patch(f"/api/v1/orders/{oid}/status", json={"status": "PROCESSING"}).json()["status"] == "PROCESSING"
    res = client.patch(f"/api/v1/orders/{oid}/status", json={"status": "READY_FOR_DISPATCH"})
    assert res.json()["status"] == "READY_FOR_DISPATCH"
    assert client.post(f"/api/v1/orders/{oid}/cancel").status_code == 409

    notifications = client.get("/api/v1/notifications/", params={"outlet_id": outlets["fresh"].id}).json()
    ready = [n for n in notifications if n["type"] == "ready_for_dispatch"]
    assert len(ready) == 1
    assert ready[0]["title"] == "ORD0000001 is ready for dispatch"
    assert "Wed 30 Sep, 04:00 – 07:45" in ready[0]["message"]


def test_defer_counts_deferrals_and_explains_why(client, clock, outlets, db_session):
    # The route is the Dispatcher's (POST /orders/{id}/defer); order_service.defer_order is what it should call
    # so the store gets the deferral notice.
    from app.services.order_service import order_service

    oid = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient")]).json()[0]["id"]
    order = order_service.defer_order(db_session, oid, "No reefer capacity after a breakdown.", date(2026, 10, 2))
    assert order.status.value == "DEFERRED"
    assert order.deferral_count == 1
    assert order.operating_date == "2026-10-02"
    assert order.cutoff_at == datetime(2026, 10, 1, 16, 0)

    deferred = [
        n for n in client.get("/api/v1/notifications/", params={"outlet_id": outlets["fresh"].id}).json()
        if n["type"] == "deferred"
    ]
    assert deferred[0]["title"] == "ORD0000001 deferred to Fri 2 Oct"
    assert deferred[0]["message"] == "No reefer capacity after a breakdown."


def test_loader_contract_lists_active_orders_for_a_day(client, clock, outlets):
    place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-063", "Chilled")], priority=True)
    place(client, outlets["style"].id, "2026-09-30", [item("SKU-501", "Ambient")])
    cancelled = place(client, outlets["fresh"].id, "2026-09-30", [item("SKU-001", "Ambient")]).json()[0]
    client.post(f"/api/v1/orders/{cancelled['id']}/cancel")

    res = client.get("/api/v1/orders/by-date", params={"date": "2026-09-30", "depot": "peliyagoda"})
    assert res.status_code == 200
    assert [o["order_number"] for o in res.json()] == ["ORD0000001", "ORD0000002"]


def test_notifications_filter_and_mark_read(client, clock, outlets):
    fresh_id = outlets["fresh"].id
    oid = place(client, fresh_id, "2026-09-30", [item("SKU-001", "Ambient")]).json()[0]["id"]
    client.patch(f"/api/v1/orders/{oid}/status", json={"status": "PROCESSING"})
    client.patch(f"/api/v1/orders/{oid}/status", json={"status": "READY_FOR_DISPATCH"})
    client.patch(f"/api/v1/orders/{oid}/status", json={"status": "DISPATCHED"})
    client.patch(f"/api/v1/orders/{oid}/status", json={"status": "DELIVERED"})

    everything = client.get("/api/v1/notifications/", params={"outlet_id": fresh_id}).json()
    assert everything[0]["type"] == "delivered"
    deliveries = client.get("/api/v1/notifications/", params={"outlet_id": fresh_id, "category": "delivery"}).json()
    assert [n["type"] for n in deliveries] == ["delivered"]

    first = everything[0]["id"]
    assert client.patch(f"/api/v1/notifications/{first}/read").json()["is_read"] is True
    unread = client.get("/api/v1/notifications/", params={"outlet_id": fresh_id, "unread": True}).json()
    assert len(unread) == len(everything) - 1

    marked = client.post("/api/v1/notifications/read-all", params={"outlet_id": fresh_id}).json()
    assert marked["updated"] == len(everything) - 1
    assert client.get("/api/v1/notifications/", params={"outlet_id": fresh_id, "unread": True}).json() == []
    assert client.patch("/api/v1/notifications/99999/read").status_code == 404


def test_calendar_lists_operating_days_and_earliest_dates(client, clock, outlets):
    res = client.get("/api/v1/calendar/operating-days", params={"date_from": "2026-09-26", "date_to": "2026-10-03"})
    assert res.status_code == 200
    body = res.json()
    assert "2026-09-27" not in body["operating_days"]  # Sunday
    assert "2026-10-01" not in body["operating_days"]  # Poya Day
    assert body["operating_days"][:3] == ["2026-09-26", "2026-09-28", "2026-09-29"]
    assert body["earliest_default"] == "2026-09-29"
    assert body["earliest_high_priority"] == "2026-09-28"
