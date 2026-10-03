"""Driver offline delivery & sync (POST /driver/sync and friends).

Runs against the in-memory SQLite test database; uploads go to a tmp folder.
Each test gets its own session in create_savepoint mode, so the service's own
commit/rollback per event behaves as in production without leaking between
tests.
"""
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import tests.conftest  # noqa: F401  (forces sqlite settings before app imports)
from app.api.deps import get_db
from app.core.database import Base
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.driver import (
    DeliveryStop, DeliveryStopStatus, DriverSyncEvent, DriverTrip, DriverTripStatus,
    IssueReport, ProofOfDelivery,
)
from app.models.order import Order, OrderItem, OrderStatus
from app.models.shipment import DispatchTrip, Shipment, ShipmentStatus
from app.models.user import User, UserRole
from app.services import driver_service

SIGNATURE = "data:image/png;base64," + base64.b64encode(b"signature-strokes").decode()
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def engine():
    """A private in-memory database with working SAVEPOINTs.

    pysqlite does not emit BEGIN itself, so savepoints (and the outer rollback
    that undoes each test) silently do nothing. SQLAlchemy's documented recipe
    below fixes that, keeping these tests isolated from the shared test DB.
    """
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(eng, "connect")
    def _no_pysqlite_autobegin(dbapi_connection, _record):
        dbapi_connection.isolation_level = None

    @event.listens_for(eng, "begin")
    def _emit_begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    connection = engine.connect()
    outer = connection.begin()
    session = sessionmaker(bind=connection, join_transaction_mode="create_savepoint")()
    yield session
    session.close()
    outer.rollback()
    connection.close()


@pytest.fixture
def api(db, tmp_path, monkeypatch):
    monkeypatch.setattr(driver_service, "UPLOAD_DIR", str(tmp_path))
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _user(db, email, role):
    user = User(email=email, full_name=email.split("@")[0].title(),
                hashed_password=get_password_hash("pw"), role=role, is_active=True)
    db.add(user)
    db.commit()
    return user


def _auth(user, minutes=30):
    token = create_access_token(user.id, expires_delta=timedelta(minutes=minutes))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def world(db):
    """A started 3-stop trip; each stop delivers one DISPATCHED order with 2 items."""
    driver = _user(db, f"driver-{uuid.uuid4().hex[:6]}@waypoint.test", UserRole.DRIVER)
    other = _user(db, f"other-{uuid.uuid4().hex[:6]}@waypoint.test", UserRole.DRIVER)
    dispatcher = _user(db, f"disp-{uuid.uuid4().hex[:6]}@waypoint.test", UserRole.DISPATCHER)

    run = DispatchTrip(trip_code=f"DT-{uuid.uuid4().hex[:6]}", vehicle_number="TRK-1",
                       driver_name=driver.full_name, origin="Peliyagoda", destination="Colombo")
    db.add(run)
    db.flush()
    trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=run.id, status=DriverTripStatus.ASSIGNED)
    db.add(trip)
    db.flush()

    stops = []
    for seq in (1, 2, 3):
        order = Order(order_number=f"T-{uuid.uuid4().hex[:8]}", client_name=f"Store {seq}",
                      destination_address=f"{seq} Galle Rd", status=OrderStatus.DISPATCHED,
                      items=[OrderItem(sku=f"SKU-{seq}A", item_name="Rice 5kg", quantity=10, unit_price=0),
                             OrderItem(sku=f"SKU-{seq}B", item_name="Dhal 1kg", quantity=4, unit_price=0)])
        db.add(order)
        db.flush()
        shipment = Shipment(tracking_number=f"TRK-{order.order_number}", order_id=order.id,
                            dispatch_trip_id=run.id, status=ShipmentStatus.OUT_FOR_DELIVERY)
        db.add(shipment)
        db.flush()
        stop = DeliveryStop(driver_trip_id=trip.id, shipment_id=shipment.id, sequence=seq,
                            address=f"{seq} Galle Rd", customer_name=f"Store {seq}",
                            latitude=6.9, longitude=79.85)
        db.add(stop)
        stops.append(stop)
    db.commit()
    return {"driver": driver, "other": other, "dispatcher": dispatcher, "run": run, "trip": trip, "stops": stops}


def _start(api, w):
    r = api.post(f"/api/v1/driver/trips/{w['trip'].id}/start", headers=_auth(w["driver"]))
    assert r.status_code == 200, r.text
    return r.json()


def _upload(api, user, client_file_id=None):
    data = {"client_file_id": client_file_id} if client_file_id else {}
    r = api.post("/api/v1/driver/upload/photo", headers=_auth(user), data=data,
                 files={"file": ("pod.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["photo_url"]


def _deliver(w, stop, photo_url, outcome="delivered", action_id=None, minutes_ago=5, **extra):
    payload = {"outcome": outcome, "recipient_name": "Malini Perera", "signature_data": SIGNATURE,
               "photo_urls": [photo_url] if photo_url else []}
    payload.update(extra)
    return {
        "action_id": action_id or str(uuid.uuid4()),
        "action_type": "deliver",
        "trip_id": w["trip"].id,
        "stop_id": stop.id,
        "payload": payload,
        "client_timestamp": (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(),
    }


def _sync(api, user, *actions, headers=None):
    return api.post("/api/v1/driver/sync", json=list(actions), headers=headers or _auth(user))


def _result(response, i=0):
    assert response.status_code == 200, response.text
    return response.json()["results"][i]


# ─── 1. Online preparation ───────────────────────────────────────────────────

def test_start_trip_online_returns_everything_the_phone_caches(api, db, world):
    trip = _start(api, world)
    assert trip["status"] == "started"

    detail = api.get(f"/api/v1/driver/trips/{world['trip'].id}", headers=_auth(world["driver"])).json()
    assert [s["sequence"] for s in detail["stops"]] == [1, 2, 3]
    first = detail["stops"][0]
    assert first["address"] and first["latitude"] is not None
    assert first["order"]["items"][0] == {"sku": "SKU-1A", "item_name": "Rice 5kg", "quantity": 10}
    assert first["pod_requirements"]["signature"] is True and first["pod_requirements"]["min_photos"] == 1

    db.refresh(world["run"])
    assert world["run"].status == "en_route" and world["run"].stop_count == 3

    # A started trip stays in "today" even if it was assigned on an earlier date
    world["trip"].assigned_date = datetime(2020, 1, 1)
    db.commit()
    ids = [t["id"] for t in api.get("/api/v1/driver/trips/today", headers=_auth(world["driver"])).json()]
    assert world["trip"].id in ids


def test_deliveries_cannot_be_recorded_before_the_trip_is_started(api, db, world):
    photo = _upload(api, world["driver"])
    res = _result(_sync(api, world["driver"], _deliver(world, world["stops"][0], photo)))
    assert res["status"] == "rejected" and res["code"] == "TRIP_NOT_STARTED"


# ─── 2/3/5. Online, then offline, then out of sequence ───────────────────────

def test_store_one_online_store_two_offline_and_store_three_out_of_sequence(api, db, world):
    _start(api, world)
    s1, s2, s3 = world["stops"]

    # Store 1 online
    assert _result(_sync(api, world["driver"], _deliver(world, s1, _upload(api, world["driver"]))))["status"] == "applied"

    # Store 3 out of sequence, then store 2 (both captured offline, synced later)
    photo3, photo2 = _upload(api, world["driver"]), _upload(api, world["driver"])
    r = _sync(api, world["driver"],
              _deliver(world, s3, photo3, minutes_ago=20),
              _deliver(world, s2, photo2, outcome="partial", minutes_ago=10,
                       delivered_items={"SKU-2A": 6, "SKU-2B": 4}))
    assert [x["status"] for x in r.json()["results"]] == ["applied", "applied"]

    for stop in (s1, s2, s3):
        db.refresh(stop)
    assert (s1.status, s2.status, s3.status) == (DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.DELIVERED)
    assert s2.pod.delivered_items == {"SKU-2A": 6, "SKU-2B": 4}
    assert s3.pod.delivered_items == {"SKU-3A": 10, "SKU-3B": 4}  # full delivery fills ordered units

    # Event time (phone) and receipt time (server) are kept separately
    pod3 = s3.pod
    assert pod3.captured_at < pod3.created_at.replace(tzinfo=pod3.captured_at.tzinfo) - timedelta(minutes=15)

    # Store and dispatcher see server-confirmed results
    assert s1.shipment.order.status == OrderStatus.DELIVERED
    db.refresh(world["run"])
    assert world["run"].stops_completed == 3


def test_refused_and_failed_are_never_shown_as_delivered(api, db, world):
    _start(api, world)
    s1, s2, _ = world["stops"]
    refused = {**_deliver(world, s1, None, outcome="refused"), }
    refused["payload"] = {"outcome": "refused", "reason": "Store manager refused the chilled items"}
    failed = _deliver(world, s2, None, outcome="failed")
    failed["payload"] = {"outcome": "failed"}  # no reason

    r = _sync(api, world["driver"], refused, failed)
    assert [x["status"] for x in r.json()["results"]] == ["applied", "rejected"]
    assert r.json()["results"][1]["code"] == "REASON_REQUIRED"

    db.refresh(s1)
    db.refresh(s2)
    assert s1.status == DeliveryStopStatus.FAILED and s1.outcome_reason.startswith("Refused by outlet")
    assert s1.pod is None and s1.shipment.order.status == OrderStatus.DISPATCHED
    assert db.query(IssueReport).filter(IssueReport.stop_id == s1.id).count() == 1
    assert s2.status == DeliveryStopStatus.PENDING


def test_partial_quantities_are_validated_against_the_order(api, db, world):
    _start(api, world)
    s1 = world["stops"][0]
    photo = _upload(api, world["driver"])
    cases = [
        ({"SKU-1A": 10, "SKU-1B": 4}, "QUANTITY_MISMATCH"),   # nothing short → not partial
        ({"SKU-1A": 11, "SKU-1B": 4}, "QUANTITY_INVALID"),    # more than ordered
        ({"SKU-1A": 5}, "QUANTITIES_REQUIRED"),               # item missing
        ({"SKU-1A": 0, "SKU-1B": 0}, "QUANTITY_MISMATCH"),    # nothing delivered → failed
    ]
    for items, code in cases:
        res = _result(_sync(api, world["driver"], _deliver(world, s1, photo, outcome="partial", delivered_items=items)))
        assert (res["status"], res["code"]) == ("rejected", code), items
    db.refresh(s1)
    assert s1.status == DeliveryStopStatus.PENDING


# ─── 6. Lost response → retry ────────────────────────────────────────────────

def test_retry_after_lost_response_never_duplicates_delivery_or_photo(api, db, world, tmp_path):
    _start(api, world)
    s1 = world["stops"][0]
    file_id = str(uuid.uuid4())
    photo = _upload(api, world["driver"], file_id)
    assert _upload(api, world["driver"], file_id) == photo  # re-upload: same file
    assert len(list(tmp_path.iterdir())) == 1

    action = _deliver(world, s1, photo)
    first = _result(_sync(api, world["driver"], action))  # server commits; pretend the response was lost
    retry = _result(_sync(api, world["driver"], action))

    assert first["status"] == retry["status"] == "applied"
    assert (first["duplicate"], retry["duplicate"]) == (False, True)
    assert db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == s1.id).count() == 1
    assert db.query(DriverSyncEvent).filter(DriverSyncEvent.client_action_id == action["action_id"]).count() == 1


def test_a_second_tap_on_an_already_delivered_stop_is_a_conflict_not_a_second_pod(api, db, world):
    _start(api, world)
    s1 = world["stops"][0]
    _sync(api, world["driver"], _deliver(world, s1, _upload(api, world["driver"])))
    res = _result(_sync(api, world["driver"], _deliver(world, s1, _upload(api, world["driver"]))))
    assert res["status"] == "conflict" and res["code"] == "STOP_ALREADY_RESOLVED"
    assert res["server_state"]["status"] == "delivered"
    assert db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == s1.id).count() == 1


# ─── 7/8. Partial batch, missing evidence ────────────────────────────────────

def test_one_bad_event_does_not_block_the_others(api, db, world):
    _start(api, world)
    s1, s2, s3 = world["stops"]
    bad = _deliver(world, s2, _upload(api, world["driver"]))
    bad["payload"]["signature_data"] = ""
    r = _sync(api, world["driver"],
              _deliver(world, s1, _upload(api, world["driver"])),
              bad,
              {"action_id": str(uuid.uuid4()), "action_type": "arrive", "trip_id": world["trip"].id,
               "stop_id": s3.id, "payload": {}, "client_timestamp": datetime.now(timezone.utc).isoformat()})
    body = r.json()
    assert [x["status"] for x in body["results"]] == ["applied", "rejected", "applied"]
    assert body["results"][1]["code"] == "SIGNATURE_REQUIRED"
    assert body["processed_count"] == 2
    for stop in (s1, s2, s3):
        db.refresh(stop)
    assert (s1.status, s2.status, s3.status) == (DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PENDING, DeliveryStopStatus.ARRIVED)


@pytest.mark.parametrize("change, code", [
    (lambda p: p.update(recipient_name="  "), "RECIPIENT_REQUIRED"),
    (lambda p: p.update(signature_data=None), "SIGNATURE_REQUIRED"),
    (lambda p: p.update(photo_urls=[]), "PHOTO_REQUIRED"),
    (lambda p: p.update(photo_urls=["/static/uploads/" + "a" * 32 + ".jpg"]), "PHOTO_NOT_UPLOADED"),
    (lambda p: p.update(photo_urls=["https://evil.example/x.jpg"]), "PHOTO_NOT_UPLOADED"),
])
def test_missing_or_unsaved_pod_evidence_is_rejected(api, db, world, change, code):
    _start(api, world)
    s1 = world["stops"][0]
    action = _deliver(world, s1, _upload(api, world["driver"]))
    change(action["payload"])
    res = _result(_sync(api, world["driver"], action))
    assert (res["status"], res["code"]) == ("rejected", code)
    db.refresh(s1)
    assert s1.status == DeliveryStopStatus.PENDING and s1.pod is None


# ─── 9/11. Auth ──────────────────────────────────────────────────────────────

def test_expired_session_applies_nothing_and_the_same_action_syncs_after_sign_in(api, db, world):
    _start(api, world)
    s1 = world["stops"][0]
    action = _deliver(world, s1, _upload(api, world["driver"]))

    expired = _sync(api, world["driver"], action, headers=_auth(world["driver"], minutes=-5))
    assert expired.status_code in (401, 403)
    assert db.query(DriverSyncEvent).count() == 0
    db.refresh(s1)
    assert s1.status == DeliveryStopStatus.PENDING

    res = _result(_sync(api, world["driver"], action))
    assert res["status"] == "applied" and res["duplicate"] is False


def test_unauthorized_and_malformed_sync_requests(api, db, world):
    _start(api, world)
    s1 = world["stops"][0]
    action = _deliver(world, s1, _upload(api, world["driver"]))

    assert _sync(api, None, action, headers=_auth(world["dispatcher"])).status_code == 403
    assert _sync(api, None, action, headers={"Authorization": "Bearer not-a-token"}).status_code == 403
    assert _sync(api, world["driver"], {**action, "action_id": "x"}).status_code == 422
    assert _sync(api, world["driver"], *[action] * 51).status_code == 413

    # Another driver cannot write to this trip...
    res = _result(_sync(api, world["other"], {**action, "action_id": str(uuid.uuid4())}))
    assert res["status"] == "conflict" and res["code"] == "TRIP_REASSIGNED"
    # ...nor read back someone else's action id
    _sync(api, world["driver"], action)
    stolen = _result(_sync(api, world["other"], action))
    assert stolen["code"] == "ACTION_ID_TAKEN" and stolen["server_state"] is None

    unknown = _result(_sync(api, world["driver"], {**action, "action_id": str(uuid.uuid4()), "action_type": "teleport"}))
    assert (unknown["status"], unknown["code"]) == ("rejected", "UNKNOWN_ACTION")

    db.refresh(s1)
    assert db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == s1.id).count() == 1


# ─── 10. Plan changed while offline ──────────────────────────────────────────

def test_reassignment_and_removed_stops_become_conflicts_for_dispatcher_review(api, db, world):
    _start(api, world)
    s1, s2, _ = world["stops"]
    reassigned = _deliver(world, s1, _upload(api, world["driver"]))
    removed = _deliver(world, s2, _upload(api, world["driver"]))

    # While the driver is offline: dispatch removes stop 2, then hands the trip to another driver
    s2.status = DeliveryStopStatus.RESCHEDULED
    db.commit()
    r = _result(_sync(api, world["driver"], removed))
    assert (r["status"], r["code"]) == ("conflict", "STOP_REMOVED")

    world["trip"].driver_id = world["other"].id
    db.commit()
    r = _result(_sync(api, world["driver"], reassigned))
    assert (r["status"], r["code"]) == ("conflict", "TRIP_REASSIGNED")

    db.refresh(s1)
    assert s1.status == DeliveryStopStatus.PENDING and s1.pod is None  # nothing silently applied

    view = api.get(f"/api/v1/delivery-runs/{world['run'].id}/deliveries", headers=_auth(world["dispatcher"])).json()
    conflicts = {c["code"]: c for c in view["conflicts"]}
    assert set(conflicts) == {"STOP_REMOVED", "TRIP_REASSIGNED"}
    assert conflicts["STOP_REMOVED"]["driver_record"]["recipient_name"] == "Malini Perera"
    assert conflicts["STOP_REMOVED"]["driver_record"]["photo_count"] == 1
    assert "signature_data" not in json.dumps(view)  # evidence never leaks into the review payload

    event_id = conflicts["STOP_REMOVED"]["event_id"]
    ok = api.post(f"/api/v1/delivery-runs/{world['run'].id}/sync-conflicts/{event_id}/review",
                  json={"note": "Outlet deferred to tomorrow"}, headers=_auth(world["dispatcher"]))
    assert ok.status_code == 200 and ok.json()["review_note"] == "Outlet deferred to tomorrow"

    # The phone re-checks the same action and learns it was reviewed
    replay = _result(_sync(api, world["driver"], removed))
    assert replay["duplicate"] and replay["reviewed"] and replay["status"] == "conflict"


# ─── 12. Trip completion ─────────────────────────────────────────────────────

def test_trip_completes_only_after_the_server_has_every_stop(api, db, world):
    _start(api, world)
    complete = {"action_id": str(uuid.uuid4()), "action_type": "complete_trip", "trip_id": world["trip"].id,
                "stop_id": None, "payload": {}, "client_timestamp": datetime.now(timezone.utc).isoformat()}

    early = _result(_sync(api, world["driver"], complete))
    assert (early["status"], early["code"]) == ("rejected", "STOPS_UNRESOLVED")
    db.refresh(world["trip"])
    assert world["trip"].status == DriverTripStatus.STARTED

    s1, s2, s3 = world["stops"]
    failed = _deliver(world, s3, None)
    failed["payload"] = {"outcome": "failed", "reason": "Outlet closed"}
    _sync(api, world["driver"],
          _deliver(world, s1, _upload(api, world["driver"])),
          _deliver(world, s2, _upload(api, world["driver"]), outcome="partial",
                   delivered_items={"SKU-2A": 9, "SKU-2B": 4}),
          failed)

    done = _result(_sync(api, world["driver"], {**complete, "action_id": str(uuid.uuid4())}))
    assert done["status"] == "applied" and done["server_state"]["status"] == "completed"
    db.refresh(world["trip"])
    db.refresh(world["run"])
    assert world["trip"].status == DriverTripStatus.COMPLETED
    assert (world["run"].status, world["run"].stops_completed) == ("completed", 3)

    view = api.get(f"/api/v1/delivery-runs/{world['run'].id}/deliveries", headers=_auth(world["dispatcher"])).json()
    by_seq = {s["sequence"]: s for s in view["stops"]}
    assert by_seq[1]["pod_available"] and by_seq[1]["photo_count"] == 1
    assert by_seq[2]["delivered_items"] == {"SKU-2A": 9, "SKU-2B": 4}
    assert by_seq[2]["ordered_items"] == {"SKU-2A": 10, "SKU-2B": 4}
    assert by_seq[3]["status"] == "failed" and by_seq[3]["outcome_reason"] == "Outlet closed"


def test_direct_pod_endpoint_enforces_the_same_evidence_rules(api, db, world):
    _start(api, world)
    s1 = world["stops"][0]
    headers = _auth(world["driver"])
    api.patch(f"/api/v1/driver/stops/{s1.id}/outcome", json={"outcome": "delivered"}, headers=headers)
    r = api.post(f"/api/v1/driver/stops/{s1.id}/pod", json={"recipient_name": "Malini", "photo_url": "mock.jpg"}, headers=headers)
    assert r.status_code == 422
