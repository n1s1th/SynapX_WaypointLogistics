import json
import os
import re
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.driver import (
    DriverTrip, DeliveryStop, ProofOfDelivery, DriverTripStatus, DeliveryStopStatus,
    DriverSyncEvent, SyncEventStatus, IssueType,
)
from app.models.order import OrderStatus
from app.models.shipment import DispatchTrip, ShipmentStatus
from app.schemas.driver import DeliveryStopRead

COLOMBO = ZoneInfo("Asia/Colombo")

# Where driver photo uploads are written; app/main.py serves this folder at /static/uploads
UPLOAD_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "static", "uploads")
)
UPLOAD_URL_PREFIX = "/static/uploads/"
_UPLOAD_NAME = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp|gif)$")

TERMINAL_STOP_STATES = [
    DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL,
    DeliveryStopStatus.FAILED, DeliveryStopStatus.RESCHEDULED,
]

# What a driver must capture before a delivered/partial stop is accepted.
# Sent to the phone with every stop so offline capture enforces the same rules.
POD_REQUIREMENTS = {
    "recipient_name": True,
    "signature": True,
    "min_photos": 1,
    "max_photos": 3,
    "delivered_quantities": "partial",  # required for partial, implied for full
    "failure_reason": True,             # failed / refused need a reason
}
MAX_SIGNATURE_CHARS = 700_000
REFUSED_REASON = "Refused by outlet"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_today_trips(db: Session, driver_id: int) -> List[DriverTrip]:
    # Fresh runs start at 03:30 Colombo time, which is still "yesterday" in UTC,
    # so accept either calendar date. A started trip stays listed until it is
    # completed, even across midnight, so an offline driver never loses it.
    today_utc = _now().date()
    today_local = datetime.now(COLOMBO).date()
    return db.query(DriverTrip).filter(
        DriverTrip.driver_id == driver_id,
        or_(
            DriverTrip.assigned_date.in_([today_utc, today_local]),
            DriverTrip.status == DriverTripStatus.STARTED,
        ),
    ).order_by(DriverTrip.id).all()


def get_trip_detail(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = db.query(DriverTrip).filter(
        DriverTrip.id == trip_id,
        DriverTrip.driver_id == driver_id
    ).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    return trip


def _order_view(stop: DeliveryStop) -> Optional[Dict[str, Any]]:
    order = stop.shipment.order if stop.shipment else None
    if not order:
        return None
    return {
        "order_number": order.order_number,
        "brand": order.brand,
        "temperature_zone": order.temperature_zone,
        "delivery_window": order.delivery_window,
        "units": order.units,
        "weight_kg": order.weight_kg,
        "volume_m3": order.volume_m3,
        "notes": order.notes,
        "items": [
            {"sku": i.sku, "item_name": i.item_name, "quantity": i.quantity_sent or i.quantity}
            for i in order.items
        ],
    }


def _stop_view(stop: DeliveryStop) -> Dict[str, Any]:
    """Everything the phone needs to work a stop offline."""
    view = DeliveryStopRead.model_validate(stop).model_dump()
    view["order"] = _order_view(stop)
    view["pod_requirements"] = POD_REQUIREMENTS
    return view


def get_trip_view(db: Session, trip_id: int, driver_id: int) -> Dict[str, Any]:
    """Trip with every stop's order and POD requirements, for the phone's offline cache."""
    trip = get_trip_detail(db, trip_id, driver_id)
    return {
        "id": trip.id,
        "driver_id": trip.driver_id,
        "dispatch_trip_id": trip.dispatch_trip_id,
        "status": trip.status,
        "assigned_date": trip.assigned_date,
        "started_at": trip.started_at,
        "completed_at": trip.completed_at,
        "created_at": trip.created_at,
        "stops": [_stop_view(s) for s in sorted(trip.stops, key=lambda s: s.sequence)],
    }


def _sync_dispatch_progress(trip: DriverTrip) -> None:
    """Mirror driver progress onto the dispatcher's delivery run (dispatch_trips)."""
    run = trip.dispatch_trip
    if not run:
        return
    run.stop_count = len(trip.stops)
    run.stops_completed = sum(1 for s in trip.stops if s.status in TERMINAL_STOP_STATES)
    if trip.status == DriverTripStatus.STARTED and run.status in ("scheduled", "ready"):
        run.status = "en_route"
        run.departure_time = run.departure_time or trip.started_at
    elif trip.status == DriverTripStatus.COMPLETED:
        run.status = "completed"
        run.actual_arrival = run.actual_arrival or trip.completed_at


def start_trip(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = get_trip_detail(db, trip_id, driver_id)
    # Idempotent: already started → just return it (handles "Resume Trip" button)
    if trip.status == DriverTripStatus.STARTED:
        return trip
    if trip.status != DriverTripStatus.ASSIGNED:
        raise HTTPException(status_code=400, detail=f"Cannot start trip with status {trip.status}")

    trip.status = DriverTripStatus.STARTED
    trip.started_at = _now()
    _sync_dispatch_progress(trip)
    db.commit()
    db.refresh(trip)
    return trip


def _unresolved_stops(trip: DriverTrip) -> List[DeliveryStop]:
    return [s for s in trip.stops if s.status not in TERMINAL_STOP_STATES]


def complete_trip(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = get_trip_detail(db, trip_id, driver_id)
    if trip.status != DriverTripStatus.STARTED:
        raise HTTPException(status_code=400, detail="Trip is not started")

    # Verify all stops are in terminal state
    for stop in _unresolved_stops(trip):
        raise HTTPException(status_code=400, detail=f"Stop {stop.id} is not in a terminal state")

    trip.status = DriverTripStatus.COMPLETED
    trip.completed_at = _now()
    _sync_dispatch_progress(trip)
    db.commit()
    db.refresh(trip)
    return trip


def get_stop(db: Session, stop_id: int, driver_id: int) -> DeliveryStop:
    stop = db.query(DeliveryStop).join(DriverTrip).filter(
        DeliveryStop.id == stop_id,
        DriverTrip.driver_id == driver_id
    ).first()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    return stop


def get_stop_detail(db: Session, stop_id: int, driver_id: int) -> dict:
    """Stop fields plus the order (and its items) delivered at this stop."""
    stop = get_stop(db, stop_id, driver_id)
    detail = _stop_view(stop)
    detail["total_stops"] = len(stop.driver_trip.stops)
    detail["trip_status"] = stop.driver_trip.status
    return detail


def record_arrival(db: Session, stop_id: int, driver_id: int) -> DeliveryStop:
    stop = get_stop(db, stop_id, driver_id)
    # Idempotent: if already arrived, just return the stop as-is
    if stop.status == DeliveryStopStatus.ARRIVED:
        return stop
    if stop.status != DeliveryStopStatus.PENDING:
        raise HTTPException(status_code=400, detail="Stop is not pending")

    stop.status = DeliveryStopStatus.ARRIVED
    stop.arrived_at = _now()
    db.commit()
    db.refresh(stop)
    return stop


def record_outcome(db: Session, stop_id: int, outcome: DeliveryStopStatus, driver_id: int) -> DeliveryStop:
    stop = get_stop(db, stop_id, driver_id)
    outcome = DeliveryStopStatus(outcome)
    valid_outcomes = [DeliveryStopStatus.DELIVERED, DeliveryStopStatus.FAILED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.RESCHEDULED]
    if outcome not in valid_outcomes:
        raise HTTPException(status_code=400, detail="Invalid outcome")

    # Idempotent; the driver may also change the outcome until POD is submitted
    if stop.status == outcome:
        return stop
    if stop.pod is not None:
        raise HTTPException(status_code=400, detail="Proof of delivery already submitted for this stop")

    stop.status = outcome
    _sync_dispatch_progress(stop.driver_trip)
    db.commit()
    db.refresh(stop)
    return stop


# ─── Proof-of-delivery evidence ──────────────────────────────────────────────

class EvidenceError(ValueError):
    """Required POD evidence is missing or invalid."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _photo_urls(raw: Any) -> List[str]:
    """Accept a list, a JSON array string or a single URL; return a list."""
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(u) for u in raw]
    if isinstance(raw, str) and raw.startswith("["):
        try:
            return [str(u) for u in json.loads(raw)]
        except ValueError:
            raise EvidenceError("PHOTO_INVALID", "Photo list is not valid.")
    return [str(raw)]


def _check_photo_stored(url: str) -> None:
    """A photo URL must point at a file this server actually saved."""
    name = url[len(UPLOAD_URL_PREFIX):] if url.startswith(UPLOAD_URL_PREFIX) else ""
    if not _UPLOAD_NAME.match(name) or not os.path.isfile(os.path.join(UPLOAD_DIR, name)):
        raise EvidenceError("PHOTO_NOT_UPLOADED", "A delivery photo has not reached the server yet.")


def validate_pod_evidence(pod_data: Dict[str, Any]) -> Dict[str, Any]:
    """Enforce POD_REQUIREMENTS. Returns cleaned values; raises EvidenceError."""
    recipient = (pod_data.get("recipient_name") or "").strip()
    if not recipient:
        raise EvidenceError("RECIPIENT_REQUIRED", "Recipient name is required.")
    if len(recipient) > 255:
        raise EvidenceError("RECIPIENT_INVALID", "Recipient name is too long.")

    signature = pod_data.get("signature_data") or ""
    if not signature.startswith("data:image/"):
        raise EvidenceError("SIGNATURE_REQUIRED", "Recipient signature is required.")
    if len(signature) > MAX_SIGNATURE_CHARS:
        raise EvidenceError("SIGNATURE_INVALID", "Signature image is too large.")

    photos = _photo_urls(pod_data.get("photo_urls", pod_data.get("photo_url")))
    if len(photos) < POD_REQUIREMENTS["min_photos"]:
        raise EvidenceError("PHOTO_REQUIRED", "At least one delivery photo is required.")
    if len(photos) > POD_REQUIREMENTS["max_photos"]:
        raise EvidenceError("PHOTO_INVALID", f"At most {POD_REQUIREMENTS['max_photos']} photos are allowed.")
    for url in photos:
        _check_photo_stored(url)

    return {"recipient_name": recipient, "signature_data": signature, "photos": photos}


def submit_pod(db: Session, stop_id: int, pod_data: dict, driver_id: int) -> ProofOfDelivery:
    stop = get_stop(db, stop_id, driver_id)
    if stop.status != DeliveryStopStatus.DELIVERED and stop.status != DeliveryStopStatus.PARTIAL:
        raise HTTPException(status_code=400, detail="Outcome must be delivered or partial before POD")

    # Idempotent: a retried submit (e.g. offline replay) returns the stored POD
    existing_pod = db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == stop.id).first()
    if existing_pod:
        return existing_pod

    try:
        evidence = validate_pod_evidence(pod_data)
    except EvidenceError as e:
        raise HTTPException(status_code=422, detail=str(e))

    pod = ProofOfDelivery(
        stop_id=stop.id,
        recipient_name=evidence["recipient_name"],
        signature_data=evidence["signature_data"],
        photo_url=json.dumps(evidence["photos"]),
        notes=pod_data.get("notes")
    )
    db.add(pod)

    # Auto complete the stop when POD is submitted
    stop.completed_at = _now()
    _sync_dispatch_progress(stop.driver_trip)

    db.commit()
    db.refresh(pod)
    _mark_order_delivered(db, stop)
    return pod


def complete_stop(db: Session, stop_id: int, driver_id: int) -> DeliveryStop:
    stop = get_stop(db, stop_id, driver_id)

    # If outcome is delivered, ensure POD exists
    if stop.status in [DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL]:
        if not stop.pod:
            raise HTTPException(status_code=400, detail="POD required before completing stop")

    if stop.status not in TERMINAL_STOP_STATES:
        raise HTTPException(status_code=400, detail="Outcome must be set before completing stop")

    stop.completed_at = _now()
    db.commit()
    db.refresh(stop)
    return stop


def _mark_order_delivered(db: Session, stop: DeliveryStop) -> None:
    """Tell the store through the existing order flow (DISPATCHED → DELIVERED + notification).

    Runs after the delivery is committed; an order not yet DISPATCHED is left
    alone (the order flow owns its own transitions).
    """
    from app.services.order_service import OrderService

    order = stop.shipment.order if stop.shipment else None
    if not order or order.status != OrderStatus.DISPATCHED:
        return
    try:
        OrderService.update_order_status(db, order.id, OrderStatus.DELIVERED)
    except Exception:  # noqa: BLE001 - the delivery itself is already saved
        db.rollback()


from app.models.driver import IssueReport, SOSAlert, IssueStatus, SOSStatus

def report_issue(db: Session, trip_id: int, issue_data: dict, driver_id: int) -> IssueReport:
    trip = get_trip_detail(db, trip_id, driver_id)

    stop_id = issue_data.get("stop_id")
    if stop_id:
        # Validate stop belongs to this trip
        stop = db.query(DeliveryStop).filter(
            DeliveryStop.id == stop_id,
            DeliveryStop.driver_trip_id == trip.id
        ).first()
        if not stop:
            raise HTTPException(status_code=400, detail="Stop does not belong to this trip")

    issue = IssueReport(
        driver_trip_id=trip.id,
        stop_id=stop_id,
        issue_type=issue_data["issue_type"],
        description=issue_data["description"],
        photo_url=issue_data.get("photo_url")
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return issue


def get_trip_issues(db: Session, trip_id: int, driver_id: int) -> List[IssueReport]:
    trip = get_trip_detail(db, trip_id, driver_id)
    return trip.issues


def trigger_sos(db: Session, driver_id: int, sos_data: dict) -> SOSAlert:
    trip_id = sos_data.get("driver_trip_id")
    if trip_id:
        # verify trip belongs to driver
        get_trip_detail(db, trip_id, driver_id)

    alert = SOSAlert(
        driver_id=driver_id,
        driver_trip_id=trip_id,
        latitude=sos_data.get("latitude"),
        longitude=sos_data.get("longitude"),
        message=sos_data.get("message")
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


def get_sos(db: Session, alert_id: int, driver_id: int) -> SOSAlert:
    alert = db.query(SOSAlert).filter(
        SOSAlert.id == alert_id,
        SOSAlert.driver_id == driver_id
    ).first()
    if not alert:
        raise HTTPException(status_code=404, detail="SOS Alert not found")
    return alert


def depot_checkin(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = get_trip_detail(db, trip_id, driver_id)
    if trip.status == DriverTripStatus.ASSIGNED:
        raise HTTPException(status_code=400, detail="Trip hasn't started yet")

    if trip.status != DriverTripStatus.COMPLETED:
        trip.status = DriverTripStatus.COMPLETED
        trip.completed_at = _now()
        _sync_dispatch_progress(trip)

    db.commit()
    db.refresh(trip)
    return trip


# ─── Offline sync ────────────────────────────────────────────────────────────
#
# Every write captured on the phone (online or offline) reaches the server as a
# sync event with a client-generated action_id. Each event is applied in its
# own transaction together with its ledger row, so either both are saved or
# neither is. A replayed action_id returns the stored result and is never
# applied twice — including when the first request committed but its response
# was lost. Business rules are re-checked here; the phone is never trusted.

class SyncConflict(Exception):
    """The plan changed under the driver (reassigned trip, removed stop, ...)."""

    def __init__(self, code: str, message: str, server_state: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.server_state = server_state


class SyncRejected(Exception):
    """The event itself is invalid (missing evidence, bad quantities, ...)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _event_time(client_timestamp: Optional[datetime], received: datetime) -> datetime:
    """When it happened on the phone, but never in the future of the server clock."""
    if client_timestamp is None:
        return received
    ts = client_timestamp if client_timestamp.tzinfo else client_timestamp.replace(tzinfo=timezone.utc)
    return min(ts.astimezone(timezone.utc), received)


def _stop_state(stop: DeliveryStop) -> Dict[str, Any]:
    return {
        "stop_id": stop.id,
        "sequence": stop.sequence,
        "customer_name": stop.customer_name,
        "status": stop.status.value,
        "outcome_reason": stop.outcome_reason,
        "has_pod": stop.pod is not None,
        "completed_at": stop.completed_at.isoformat() if stop.completed_at else None,
    }


def _trip_for_event(db: Session, driver_id: int, trip_id: Optional[int]) -> DriverTrip:
    if not trip_id:
        raise SyncRejected("TRIP_REQUIRED", "The record is missing its trip.")
    trip = db.query(DriverTrip).filter(DriverTrip.id == trip_id).first()
    if not trip:
        raise SyncRejected("TRIP_NOT_FOUND", "This trip no longer exists.")
    if trip.driver_id != driver_id:
        # Never applied; kept as a conflict so a dispatcher can review it.
        raise SyncConflict("TRIP_REASSIGNED", "This trip is now assigned to another driver.")
    return trip


def _stop_for_event(db: Session, trip: DriverTrip, stop_id: Optional[int]) -> DeliveryStop:
    if not stop_id:
        raise SyncRejected("STOP_REQUIRED", "The record is missing its stop.")
    stop = db.query(DeliveryStop).filter(DeliveryStop.id == stop_id).first()
    if not stop:
        raise SyncConflict("STOP_REMOVED", "This stop was removed from the plan.")
    if stop.driver_trip_id != trip.id:
        raise SyncConflict("STOP_MOVED", "This stop was moved to a different trip.")
    if stop.status == DeliveryStopStatus.RESCHEDULED:
        raise SyncConflict("STOP_REMOVED", "Dispatch removed this stop from your run.", _stop_state(stop))
    return stop


def _require_started(trip: DriverTrip) -> None:
    if trip.status == DriverTripStatus.ASSIGNED:
        raise SyncRejected("TRIP_NOT_STARTED", "Start the trip online before recording deliveries.")
    if trip.status == DriverTripStatus.COMPLETED:
        raise SyncConflict("TRIP_ALREADY_COMPLETED", "This trip was already completed.")


def _delivered_items(order: Optional[Any], outcome: str, raw: Any) -> Optional[Dict[str, int]]:
    """Validate units handed over against what was ordered."""
    items = list(order.items) if order else []
    if not items:
        return None
    ordered = {i.sku: (i.quantity_sent or i.quantity) for i in items}
    if raw in (None, {}) and outcome == "delivered":
        return dict(ordered)
    if not isinstance(raw, dict) or not raw:
        raise SyncRejected("QUANTITIES_REQUIRED", "Enter the units delivered for each item.")
    unknown = set(raw) - set(ordered)
    if unknown:
        raise SyncRejected("QUANTITY_INVALID", f"Unknown item {sorted(unknown)[0]}.")
    missing = set(ordered) - set(raw)
    if missing:
        raise SyncRejected("QUANTITIES_REQUIRED", f"Enter the units delivered for {sorted(missing)[0]}.")
    cleaned: Dict[str, int] = {}
    for sku, value in raw.items():
        if isinstance(value, bool) or not isinstance(value, int):
            raise SyncRejected("QUANTITY_INVALID", f"Units for {sku} must be a whole number.")
        if value < 0 or value > ordered[sku]:
            raise SyncRejected("QUANTITY_INVALID", f"Units for {sku} must be between 0 and {ordered[sku]}.")
        cleaned[sku] = value
    short = any(cleaned[s] < ordered[s] for s in ordered)
    if outcome == "delivered" and short:
        raise SyncRejected("QUANTITY_MISMATCH", "Some items are short — record a partial delivery instead.")
    if outcome == "partial":
        if not short:
            raise SyncRejected("QUANTITY_MISMATCH", "Every item was delivered in full — record a full delivery instead.")
        if sum(cleaned.values()) == 0:
            raise SyncRejected("QUANTITY_MISMATCH", "Nothing was delivered — record a failed delivery instead.")
    return cleaned


def _apply_arrive(db: Session, driver_id: int, action, event_at: datetime) -> Dict[str, Any]:
    trip = _trip_for_event(db, driver_id, action.trip_id)
    _require_started(trip)
    stop = _stop_for_event(db, trip, action.stop_id)
    if stop.status == DeliveryStopStatus.PENDING:
        stop.status = DeliveryStopStatus.ARRIVED
        stop.arrived_at = event_at
    # Arriving again, or after the outcome was saved, changes nothing
    return _stop_state(stop)


def _apply_deliver(db: Session, driver_id: int, action, event_at: datetime) -> Dict[str, Any]:
    """Outcome + quantities + proof of delivery for one stop, all or nothing."""
    payload = action.payload or {}
    trip = _trip_for_event(db, driver_id, action.trip_id)
    _require_started(trip)
    stop = _stop_for_event(db, trip, action.stop_id)

    if stop.status in TERMINAL_STOP_STATES:
        raise SyncConflict(
            "STOP_ALREADY_RESOLVED",
            f"Stop {stop.sequence} was already recorded as {stop.status.value} on the server.",
            _stop_state(stop),
        )

    outcome = payload.get("outcome")
    if outcome not in ("delivered", "partial", "failed", "refused"):
        raise SyncRejected("INVALID_OUTCOME", "Unknown delivery outcome.")

    order = stop.shipment.order if stop.shipment else None
    stop.arrived_at = stop.arrived_at or event_at

    if outcome in ("failed", "refused"):
        reason = (payload.get("reason") or "").strip()
        if outcome == "refused":
            reason = f"{REFUSED_REASON}: {reason}" if reason else REFUSED_REASON
        if not reason:
            raise SyncRejected("REASON_REQUIRED", "Say why the delivery failed.")
        stop.status = DeliveryStopStatus.FAILED
        stop.outcome_reason = reason[:255]
        stop.completed_at = event_at
        db.add(IssueReport(
            driver_trip_id=trip.id,
            stop_id=stop.id,
            issue_type=IssueType.CUSTOMER_UNAVAILABLE if outcome == "refused" else IssueType.OTHER,
            description=f"Stop {stop.sequence} not delivered — {reason}"[:2000],
        ))
    else:
        try:
            evidence = validate_pod_evidence(payload)
        except EvidenceError as e:
            raise SyncRejected(e.code, str(e))
        delivered = _delivered_items(order, outcome, payload.get("delivered_items"))
        stop.status = DeliveryStopStatus.DELIVERED if outcome == "delivered" else DeliveryStopStatus.PARTIAL
        stop.completed_at = event_at
        db.add(ProofOfDelivery(
            stop_id=stop.id,
            recipient_name=evidence["recipient_name"],
            signature_data=evidence["signature_data"],
            photo_url=json.dumps(evidence["photos"]),
            notes=(payload.get("notes") or None),
            delivered_items=delivered,
            captured_at=event_at,
        ))
        if stop.shipment:
            stop.shipment.status = ShipmentStatus.DELIVERED

    db.flush()
    db.refresh(stop)
    _sync_dispatch_progress(trip)
    return _stop_state(stop)


def _apply_issue(db: Session, driver_id: int, action, event_at: datetime) -> Dict[str, Any]:
    payload = action.payload or {}
    trip = _trip_for_event(db, driver_id, action.trip_id)
    stop_id = payload.get("stop_id") or action.stop_id
    if stop_id:
        _stop_for_event(db, trip, stop_id)
    try:
        issue_type = IssueType(payload.get("issue_type"))
    except ValueError:
        raise SyncRejected("INVALID_ISSUE_TYPE", "Unknown issue type.")
    description = (payload.get("description") or "").strip()
    if not description:
        raise SyncRejected("DESCRIPTION_REQUIRED", "Describe the issue.")
    issue = IssueReport(
        driver_trip_id=trip.id,
        stop_id=stop_id,
        issue_type=issue_type,
        description=description[:2000],
        photo_url=payload.get("photo_url") or next(iter(payload.get("photo_urls") or []), None),
        created_at=event_at,
    )
    db.add(issue)
    db.flush()
    return {"issue_id": issue.id, "trip_id": trip.id}


def _apply_complete_trip(db: Session, driver_id: int, action, event_at: datetime) -> Dict[str, Any]:
    trip = _trip_for_event(db, driver_id, action.trip_id)
    if trip.status == DriverTripStatus.ASSIGNED:
        raise SyncRejected("TRIP_NOT_STARTED", "This trip was never started.")
    if trip.status != DriverTripStatus.COMPLETED:
        unresolved = _unresolved_stops(trip)
        if unresolved:
            names = ", ".join(f"stop {s.sequence}" for s in sorted(unresolved, key=lambda s: s.sequence))
            raise SyncRejected("STOPS_UNRESOLVED", f"The server still has {names} open.")
        trip.status = DriverTripStatus.COMPLETED
        trip.completed_at = event_at
        _sync_dispatch_progress(trip)
    return {"trip_id": trip.id, "status": trip.status.value}


def _apply_legacy(db: Session, driver_id: int, action) -> Dict[str, Any]:
    """Actions queued by the previous app version (separate outcome/pod/complete)."""
    try:
        if action.action_type == "outcome":
            stop = record_outcome(db, action.stop_id, action.payload["outcome"], driver_id)
        elif action.action_type == "pod":
            submit_pod(db, action.stop_id, action.payload, driver_id)
            stop = get_stop(db, action.stop_id, driver_id)
        else:
            stop = complete_stop(db, action.stop_id, driver_id)
    except HTTPException as e:
        raise SyncRejected("LEGACY_REJECTED", str(e.detail))
    except (KeyError, ValueError):
        raise SyncRejected("INVALID_PAYLOAD", "The record is incomplete.")
    return _stop_state(stop)


_APPLIERS = {
    "arrive": _apply_arrive,
    "deliver": _apply_deliver,
    "issue": _apply_issue,
    "complete_trip": _apply_complete_trip,
}


def _payload_summary(action) -> Dict[str, Any]:
    """What the driver recorded, without signature or photo data (for review)."""
    payload = action.payload or {}
    summary = {k: payload[k] for k in ("outcome", "reason", "recipient_name", "delivered_items", "notes", "issue_type") if k in payload}
    photos = payload.get("photo_urls", payload.get("photo_url"))
    summary["photo_count"] = len(photos) if isinstance(photos, list) else (1 if photos else 0)
    summary["has_signature"] = bool(payload.get("signature_data"))
    return summary


def _event_result(event: DriverSyncEvent, duplicate: bool) -> Dict[str, Any]:
    return {
        "action_id": event.client_action_id,
        "status": event.status,
        "duplicate": duplicate,
        "code": event.code,
        "message": event.message,
        "trip_id": event.trip_id,
        "stop_id": event.stop_id,
        "server_state": event.result,
        "received_at": event.received_at,
        "reviewed": event.reviewed_at is not None,
        "review_note": event.review_note,
    }


def process_sync_event(db: Session, action, driver_id: int) -> Dict[str, Any]:
    # 1. Replay: the same tap arriving again gets the stored answer
    existing = db.query(DriverSyncEvent).filter(DriverSyncEvent.client_action_id == action.action_id).first()
    if existing:
        if existing.driver_id != driver_id:
            return {
                "action_id": action.action_id, "status": SyncEventStatus.REJECTED.value, "duplicate": False,
                "code": "ACTION_ID_TAKEN", "message": "This record id belongs to another driver.",
                "trip_id": action.trip_id, "stop_id": action.stop_id, "server_state": None,
                "received_at": _now(), "reviewed": False, "review_note": None,
            }
        return _event_result(existing, duplicate=True)

    received = _now()
    event_at = _event_time(action.client_timestamp, received)
    status_value, code, message, result = SyncEventStatus.APPLIED.value, None, None, None
    deliver_stop: Optional[DeliveryStop] = None

    # 2. Apply (no commit yet)
    try:
        if action.action_type in _APPLIERS:
            result = _APPLIERS[action.action_type](db, driver_id, action, event_at)
            if action.action_type == "deliver" and result.get("status") in ("delivered", "partial"):
                deliver_stop = db.query(DeliveryStop).filter(DeliveryStop.id == action.stop_id).first()
        elif action.action_type in ("outcome", "pod", "complete"):
            result = _apply_legacy(db, driver_id, action)
        else:
            raise SyncRejected("UNKNOWN_ACTION", f"Unknown record type '{action.action_type}'.")
    except SyncConflict as c:
        db.rollback()
        status_value, code, message, result = SyncEventStatus.CONFLICT.value, c.code, str(c), c.server_state
    except SyncRejected as r:
        db.rollback()
        status_value, code, message = SyncEventStatus.REJECTED.value, r.code, str(r)

    # 3. Ledger row in the same transaction as the change
    event = DriverSyncEvent(
        client_action_id=action.action_id,
        driver_id=driver_id,
        action_type=action.action_type[:32],
        trip_id=action.trip_id,
        stop_id=action.stop_id,
        status=status_value,
        code=code,
        message=(message or None) and message[:500],
        result=json.loads(json.dumps(result, default=str)) if result is not None else None,
        payload_summary=_payload_summary(action),
        client_timestamp=action.client_timestamp,
        received_at=received,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request with the same action_id won the race
        db.rollback()
        existing = db.query(DriverSyncEvent).filter(DriverSyncEvent.client_action_id == action.action_id).first()
        if existing and existing.driver_id == driver_id:
            return _event_result(existing, duplicate=True)
        raise

    # 4. Side effects that live in other modules, after our commit
    if deliver_stop is not None:
        _mark_order_delivered(db, deliver_stop)

    db.refresh(event)
    return _event_result(event, duplicate=False)


def process_sync_batch(db: Session, actions: list, driver_id: int) -> dict:
    """Apply each action independently; one failure never discards the others."""
    results = [process_sync_event(db, action, driver_id) for action in actions]
    return {
        "processed_count": sum(1 for r in results if r["status"] == SyncEventStatus.APPLIED.value),
        "conflicts": [
            {"action_id": r["action_id"], "stop_id": r["stop_id"], "reason": r["message"] or "", "server_state": r["server_state"] or {}}
            for r in results if r["status"] == SyncEventStatus.CONFLICT.value
        ],
        "results": results,
    }


# ─── Dispatcher view (server-confirmed data only) ────────────────────────────

def dispatch_deliveries(db: Session, dispatch_trip_id: int) -> Dict[str, Any]:
    """Driver progress for one delivery run, plus sync conflicts awaiting review."""
    trip = db.query(DriverTrip).filter(DriverTrip.dispatch_trip_id == dispatch_trip_id).order_by(DriverTrip.id.desc()).first()
    if not trip:
        return {"driver_trip_id": None, "trip_status": None, "stops": [], "conflicts": []}

    stops = []
    for s in sorted(trip.stops, key=lambda s: s.sequence):
        order = _order_view(s)
        pod = s.pod
        stops.append({
            "stop_id": s.id,
            "sequence": s.sequence,
            "customer_name": s.customer_name,
            "status": s.status.value,
            "outcome_reason": s.outcome_reason,
            "arrived_at": s.arrived_at,
            "completed_at": s.completed_at,
            "pod_available": pod is not None,
            "recipient_name": pod.recipient_name if pod else None,
            "photo_count": len(_photo_urls(pod.photo_url)) if pod and pod.photo_url else 0,
            "pod_received_at": pod.created_at if pod else None,
            "delivered_items": pod.delivered_items if pod else None,
            "ordered_items": {i["sku"]: i["quantity"] for i in order["items"]} if order else None,
        })

    conflicts = db.query(DriverSyncEvent).filter(
        DriverSyncEvent.trip_id == trip.id,
        DriverSyncEvent.status == SyncEventStatus.CONFLICT.value,
    ).order_by(DriverSyncEvent.received_at).all()

    return {
        "driver_trip_id": trip.id,
        "trip_status": trip.status.value,
        "started_at": trip.started_at,
        "completed_at": trip.completed_at,
        "stops": stops,
        "conflicts": [
            {
                "event_id": c.id,
                "action_type": c.action_type,
                "stop_id": c.stop_id,
                "code": c.code,
                "message": c.message,
                "driver_record": c.payload_summary,
                "server_state": c.result,
                "recorded_at": c.client_timestamp,
                "received_at": c.received_at,
                "reviewed_at": c.reviewed_at,
                "review_note": c.review_note,
            }
            for c in conflicts
        ],
    }


def review_sync_conflict(db: Session, event_id: int, reviewer_id: Optional[int], note: Optional[str]) -> DriverSyncEvent:
    """A dispatcher acknowledges a conflict. Nothing is applied automatically."""
    event = db.query(DriverSyncEvent).filter(
        DriverSyncEvent.id == event_id,
        DriverSyncEvent.status == SyncEventStatus.CONFLICT.value,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Conflict not found")
    if event.reviewed_at is None:
        event.reviewed_at = _now()
        event.reviewed_by_id = reviewer_id or None
        event.review_note = (note or "").strip()[:500] or None
        db.commit()
        db.refresh(event)
    return event
