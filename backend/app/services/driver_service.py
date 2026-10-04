import json
import logging
import threading
from collections import deque
from typing import List, Optional, Tuple
from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.core.exceptions import WaypointLogisticsError
from app.models.delivery_run import DeliveryRun, RunOrderState, RunStatus, RunStop
from app.models.driver import DriverTrip, DeliveryStop, ProofOfDelivery, DriverTripStatus, DeliveryStopStatus, DriverAvailability
from app.models.allocation import AllocationStatus
from app.models.fleet import DriverProfile, VehicleStatus
from app.models.order import Order, OrderStatus
from app.models.shipment import DispatchTrip
from app.models.user import User
from app.schemas.driver import DeliveryStopRead, normalise_phone
from app.schemas.loader import GateOutRequest
from app.services import geo
from app.services.calendar_service import CalendarService
from app.services.loader_service import LoaderService
from app.services.order_service import TRANSITIONS, order_service

logger = logging.getLogger(__name__)

COLOMBO = ZoneInfo("Asia/Colombo")
# Runs the loader has signed off: the driver can collect them.
RELEASED_RUN_STATES = (RunStatus.READY_TO_DEPART, RunStatus.GATED_OUT)
# A run gated out without a driver trip is only picked up while it is this fresh.
GATED_OUT_PICKUP_WINDOW = timedelta(hours=24)
# Orders that are no longer on the current plan of a run.
OFF_PLAN_STATES = {RunOrderState.TAKE_OFF, RunOrderState.MOVED}
# Order statuses a departure or delivery never passes through on its way.
DETOUR_STATUSES = {OrderStatus.DEFERRED, OrderStatus.CANCELLED}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today_start(now: datetime) -> datetime:
    """Midnight today in Sri Lanka, as naive UTC like the stored columns."""
    midnight = datetime.combine(now.astimezone(COLOMBO).date(), time.min, tzinfo=COLOMBO)
    return midnight.astimezone(timezone.utc).replace(tzinfo=None)


def _hhmm(value: datetime) -> str:
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(COLOMBO).strftime("%H:%M")


def get_today_trips(db: Session, driver_id: int) -> List[DriverTrip]:
    """Today's trips, a trip still under way from an earlier day, and trips
    finished today. Released loader runs become trips here first."""
    _sync_runs(db, driver_id)
    today = _today_start(_now())
    return db.query(DriverTrip).filter(
        DriverTrip.driver_id == driver_id,
        or_(
            DriverTrip.assigned_date >= today,
            DriverTrip.status == DriverTripStatus.STARTED,
            DriverTrip.completed_at >= today,
        )
    ).order_by(DriverTrip.id).all()


# ---- Loader runs -------------------------------------------------------------
# The dispatcher's DispatchTrip names the driver (driver_profiles.id) and the
# loader's run hangs off it (delivery_runs.dispatch_trip_id). Once the loader
# signs the run off, its stops are copied into a DriverTrip, so the phone keeps
# a stable record offline and the loader's tables are not edited by the driver.

def _released_runs(db: Session, profile: DriverProfile, now: datetime) -> List[DeliveryRun]:
    """Signed-off runs on this driver's dispatch trips. A trip with no driver
    named falls back to the vehicle the driver is assigned to."""
    yours = [DispatchTrip.driver_id == profile.id]
    if profile.assigned_vehicle_id is not None:
        yours.append(and_(DispatchTrip.driver_id.is_(None), DeliveryRun.vehicle_id == profile.assigned_vehicle_id))
    gated_out_since = (now - GATED_OUT_PICKUP_WINDOW).replace(tzinfo=None)
    return db.query(DeliveryRun).join(
        DispatchTrip, DeliveryRun.dispatch_trip_id == DispatchTrip.id
    ).filter(
        or_(*yours),
        or_(
            DeliveryRun.status == RunStatus.READY_TO_DEPART,
            and_(DeliveryRun.status == RunStatus.GATED_OUT, DeliveryRun.departs_at >= gated_out_since),
        ),
    ).order_by(DeliveryRun.departs_at, DeliveryRun.trip_number).all()


def _current_run_stops(db: Session, run: DeliveryRun) -> List[RunStop]:
    return db.query(RunStop).filter(
        RunStop.run_id == run.id,
        RunStop.plan_version == run.current_plan_version,
    ).order_by(RunStop.stop_sequence).all()


def _run_for_trip(db: Session, trip: DriverTrip) -> Optional[DeliveryRun]:
    return db.query(DeliveryRun).filter(DeliveryRun.dispatch_trip_id == trip.dispatch_trip_id).first()


def _run_stop_for(db: Session, stop: DeliveryStop) -> Tuple[Optional[DeliveryRun], Optional[RunStop]]:
    run = _run_for_trip(db, stop.driver_trip)
    if run is None:
        return None, None
    run_stop = db.query(RunStop).filter(
        RunStop.run_id == run.id,
        RunStop.plan_version == run.current_plan_version,
        RunStop.stop_sequence == stop.sequence,
    ).first()
    return run, run_stop


def _orders_at(run: DeliveryRun, run_stop: RunStop, loaded_only: bool = False) -> List[Order]:
    """Orders for this stop on the current plan; loaded_only keeps the ones on the truck."""
    rows = [
        row for row in run_stop.orders
        if row.plan_version == run.current_plan_version and row.state not in OFF_PLAN_STATES
    ]
    return [row.order for row in rows if not loaded_only or row.state == RunOrderState.LOADED]


def _stop_note(run_stop: RunStop) -> str:
    outlet = run_stop.outlet
    parts = [outlet.dock_type.value.replace("_", " ").capitalize()]
    if outlet.van_only:
        parts.append("van only")
    if outlet.window_start and outlet.window_end:
        parts.append(f"window {outlet.window_start:%H:%M}-{outlet.window_end:%H:%M}")
    return " · ".join(parts)


def _copy_stops(db: Session, trip: DriverTrip, run_stops: List[RunStop]) -> None:
    for run_stop in run_stops:
        outlet = run_stop.outlet
        latitude, longitude = geo.approx_outlet_location(outlet.code, outlet.district, outlet.depot.value)
        db.add(DeliveryStop(
            driver_trip_id=trip.id,
            sequence=run_stop.stop_sequence,
            address=f"{outlet.code} · {outlet.district}",
            customer_name=outlet.name,
            latitude=latitude,
            longitude=longitude,
            notes=_stop_note(run_stop),
            status=DeliveryStopStatus.PENDING,
        ))


def _stops_match(trip: DriverTrip, run_stops: List[RunStop]) -> bool:
    copied = sorted((stop.sequence, stop.customer_name) for stop in trip.stops)
    planned = [(run_stop.stop_sequence, run_stop.outlet.name) for run_stop in run_stops]
    return copied == planned


def _untouched(trip: DriverTrip) -> bool:
    return all(stop.status == DeliveryStopStatus.PENDING and stop.pod is None for stop in trip.stops)


def _sync_runs(db: Session, driver_id: int) -> None:
    """Make a DriverTrip for each signed-off run of this driver. Running it again
    changes nothing, except that a trip not yet started follows a plan change.

    The phone often asks for today's trips twice at once, so the check-then-create
    is serialised: a lock in this process, and a row lock on the dispatch trip
    across processes (Postgres)."""
    with _sync_lock:
        _sync_runs_locked(db, driver_id)


_sync_lock = threading.Lock()


def _sync_runs_locked(db: Session, driver_id: int) -> None:
    profile = db.query(DriverProfile).filter(DriverProfile.user_id == driver_id).first()
    if profile is None:
        return
    now = _now()
    today = _today_start(now)
    for run in _released_runs(db, profile, now):
        db.query(DispatchTrip).filter(DispatchTrip.id == run.dispatch_trip_id).with_for_update().first()
        trip = db.query(DriverTrip).filter(
            DriverTrip.dispatch_trip_id == run.dispatch_trip_id
        ).order_by(DriverTrip.id.desc()).first()
        if trip is not None and trip.driver_id != driver_id:
            continue  # collected by another driver
        run_stops = _current_run_stops(db, run)
        if trip is None:
            trip = DriverTrip(
                driver_id=driver_id,
                dispatch_trip_id=run.dispatch_trip_id,
                status=DriverTripStatus.ASSIGNED,
                assigned_date=today,
            )
            db.add(trip)
            db.flush()
            _copy_stops(db, trip, run_stops)
        elif trip.status == DriverTripStatus.ASSIGNED:
            # Still waiting at the depot: keep it on today's list, on the latest plan.
            if trip.assigned_date is None or trip.assigned_date < today:
                trip.assigned_date = today
            if _untouched(trip) and not _stops_match(trip, run_stops):
                trip.stops.clear()
                db.flush()
                _copy_stops(db, trip, run_stops)
    db.commit()  # also releases the row locks


# ---- Dispatcher and store updates ---------------------------------------------

def _log(trip: DriverTrip, event: str, note: str, level: str = "ok") -> None:
    """Add a line to the dispatcher's run log. Only "ok" or "warning": the
    dispatcher reads "error" events as loading shortfalls."""
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is None:
        return
    now = _now()
    events = list(dispatch_trip.loading_events or [])
    events.append({"event": event, "time": _hhmm(now), "note": note, "status": level})
    dispatch_trip.loading_events = events
    dispatch_trip.updated_at = now


def _sync_progress(trip: DriverTrip) -> None:
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is None:
        return
    terminal = {DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.FAILED, DeliveryStopStatus.RESCHEDULED}
    dispatch_trip.stop_count = len(trip.stops)
    dispatch_trip.stops_completed = sum(
        1 for stop in trip.stops
        if stop.status in terminal and (stop.completed_at is not None or stop.status == DeliveryStopStatus.FAILED)
    )


def _status_path(current: OrderStatus, target: OrderStatus) -> Optional[List[OrderStatus]]:
    """Shortest legal walk through the order lifecycle, never via deferred/cancelled."""
    if current == target:
        return []
    queue = deque([(current, [])])
    seen = {current}
    while queue:
        state, path = queue.popleft()
        for following in sorted(TRANSITIONS.get(state, set()), key=lambda s: s.value):
            if following in seen:
                continue
            if following == target:
                return path + [following]
            if following in DETOUR_STATUSES:
                continue
            seen.add(following)
            queue.append((following, path + [following]))
    return None


def _advance_order(db: Session, order_id: int, target: OrderStatus) -> None:
    """Move an order to target through the order service, which checks every
    step and notifies the store. A refused step leaves the order where it is:
    the driver's record is already saved."""
    order = db.get(Order, order_id)
    if order is None:
        return
    for step in _status_path(order.status, target) or []:
        try:
            order_service.update_order_status(db, order_id, step)
        except WaypointLogisticsError as exc:
            logger.warning("Order %s stayed at %s: %s", order.order_number, order.status, exc)
            db.rollback()
            return


def get_trip_detail(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = db.query(DriverTrip).filter(
        DriverTrip.id == trip_id,
        DriverTrip.driver_id == driver_id
    ).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found or not assigned to you")
    return trip


def get_trip_view(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    """The trip for the trip screen, with when the last outlet window closes."""
    trip = get_trip_detail(db, trip_id, driver_id)
    run = _run_for_trip(db, trip)
    ends = [rs.outlet.window_end for rs in _current_run_stops(db, run) if rs.outlet.window_end] if run else []
    trip.last_window_closes = f"{max(ends):%H:%M}" if ends else None
    return trip


def start_trip(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = get_trip_detail(db, trip_id, driver_id)
    # Idempotent: already started → just return it (handles "Resume Trip" button)
    if trip.status == DriverTripStatus.STARTED:
        return trip
    if trip.status != DriverTripStatus.ASSIGNED:
        raise HTTPException(status_code=400, detail=f"Cannot start trip with status {trip.status}")

    driver = db.get(User, driver_id)
    run = _run_for_trip(db, trip)
    if run is not None:
        # Leaving with a loader run is the gate-out: the run leaves the loader's queue.
        if run.status not in RELEASED_RUN_STATES:
            raise HTTPException(
                status_code=409,
                detail=f"{run.code} is still at the dock ({run.status.value.replace('_', ' ')}). "
                       "Wait for the loader to mark it ready to depart.",
            )
        LoaderService.gate_out(db, run, GateOutRequest(client_action_id=uuid4(), by=driver.full_name))

    trip.status = DriverTripStatus.STARTED
    trip.started_at = _now()
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is not None:
        dispatch_trip.status = "en_route"
        if dispatch_trip.departure_time is None:
            dispatch_trip.departure_time = trip.started_at
        if not dispatch_trip.driver_name or dispatch_trip.driver_name == "Unassigned":
            dispatch_trip.driver_name = driver.full_name
        _sync_progress(trip)
        _log(trip, "Left the gate", f"{driver.full_name} started the trip · {len(trip.stops)} stops")
    db.commit()

    # Order updates commit on their own, so they go after the trip is saved.
    if run is not None:
        for run_stop in _current_run_stops(db, run):
            for order in _orders_at(run, run_stop, loaded_only=True):
                _advance_order(db, order.id, OrderStatus.DISPATCHED)
    else:
        for stop in trip.stops:
            if stop.shipment and stop.shipment.order_id:
                _advance_order(db, stop.shipment.order_id, OrderStatus.DISPATCHED)
    db.refresh(trip)
    return trip


def complete_trip(db: Session, trip_id: int, driver_id: int) -> DriverTrip:
    trip = get_trip_detail(db, trip_id, driver_id)
    if trip.status != DriverTripStatus.STARTED:
        raise HTTPException(status_code=400, detail="Trip is not started")
    
    # Verify all stops are in terminal state
    terminal_states = [DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.FAILED, DeliveryStopStatus.RESCHEDULED]
    for stop in trip.stops:
        if stop.status not in terminal_states:
            raise HTTPException(status_code=400, detail=f"Stop {stop.id} is not in a terminal state")
            
    trip.status = DriverTripStatus.COMPLETED
    trip.completed_at = datetime.now(timezone.utc)
    _close_dispatch_trip(trip)
    db.commit()
    db.refresh(trip)
    return trip


def _free_truck(dispatch_trip: DispatchTrip) -> None:
    """Trip over: the dispatcher's allocation is done and the truck can be planned
    again (a second trip today, or tomorrow's), as completing it in Allocations
    does. A truck taken out of service meanwhile stays unavailable."""
    allocation = dispatch_trip.allocation
    if allocation is None or allocation.status in (AllocationStatus.COMPLETED, AllocationStatus.CANCELLED):
        return
    allocation.status = AllocationStatus.COMPLETED
    vehicle = allocation.vehicle
    if vehicle is not None and vehicle.status != VehicleStatus.UNAVAILABLE:
        vehicle.status = VehicleStatus.AVAILABLE


def _close_dispatch_trip(trip: DriverTrip) -> None:
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is None or dispatch_trip.status == "completed":
        return
    dispatch_trip.status = "completed"
    _free_truck(dispatch_trip)
    _sync_progress(trip)
    counts = {s: sum(1 for stop in trip.stops if stop.status == s) for s in DeliveryStopStatus}
    _log(
        trip,
        "Trip complete",
        f"{counts[DeliveryStopStatus.DELIVERED]} delivered · {counts[DeliveryStopStatus.PARTIAL]} partial · "
        f"{counts[DeliveryStopStatus.FAILED]} not delivered",
    )


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
    detail = DeliveryStopRead.model_validate(stop).model_dump()
    detail["total_stops"] = len(stop.driver_trip.stops)
    detail["trip_status"] = stop.driver_trip.status

    if stop.shipment and stop.shipment.order:
        orders = [_order_info(stop.shipment.order, on_truck=True)]
    else:
        # A stop copied from a loader run: every order the run drops here
        # (a Fresh outlet can get a dry and a chilled order on one stop).
        run, run_stop = _run_stop_for(db, stop)
        orders = []
        if run_stop is not None:
            loaded = {order.id for order in _orders_at(run, run_stop, loaded_only=True)}
            window = _outlet_window(run_stop)
            orders = [
                _order_info(order, on_truck=order.id in loaded, window=window)
                for order in _orders_at(run, run_stop)
            ]
    detail["orders"] = orders
    if orders:
        detail["order"] = orders[0]
    return detail


def _outlet_window(run_stop: RunStop) -> Optional[str]:
    outlet = run_stop.outlet
    if outlet.window_start is None or outlet.window_end is None:
        return None
    return f"{outlet.window_start:%H:%M}-{outlet.window_end:%H:%M}"


def _order_info(order: Order, on_truck: bool, window: Optional[str] = None) -> dict:
    # The loader's temperature class wins: temperature_zone defaults to "Ambient".
    if order.temperature_class is not None:
        temperature = order.temperature_class.value.capitalize()
    else:
        temperature = order.temperature_zone
    return {
        "order_number": order.order_number,
        "brand": order.brand,
        "temperature_zone": temperature,
        "delivery_window": order.delivery_window or window,
        "units": order.units,
        "weight_kg": order.weight_kg,
        "volume_m3": order.volume_m3,
        "notes": order.notes,
        "on_truck": on_truck,
        "items": [
            {"sku": i.sku, "item_name": i.item_name, "quantity": i.quantity_sent or i.quantity}
            for i in order.items
        ],
    }


def _tap_time(at: Optional[datetime]) -> datetime:
    """When the driver actually tapped: the phone's time for a record saved
    offline, never in the future (a phone clock running fast)."""
    now = _now()
    if at is None:
        return now
    at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    return min(at.astimezone(timezone.utc), now)


def record_arrival(db: Session, stop_id: int, driver_id: int, at: Optional[datetime] = None) -> DeliveryStop:
    stop = get_stop(db, stop_id, driver_id)
    # Idempotent: already arrived (or further) → return the stop as-is, so an
    # arrival replayed from the offline queue is never a conflict
    if stop.status != DeliveryStopStatus.PENDING:
        return stop

    stop.status = DeliveryStopStatus.ARRIVED
    stop.arrived_at = _tap_time(at)
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
    if outcome == DeliveryStopStatus.FAILED:
        # The orders stay dispatched; the dispatcher sees the failure in the run log.
        _log(stop.driver_trip, "Not delivered", f"Stop {stop.sequence} · {stop.customer_name}", "warning")
        _sync_progress(stop.driver_trip)
    db.commit()
    db.refresh(stop)
    return stop


def submit_pod(db: Session, stop_id: int, pod_data: dict, driver_id: int) -> ProofOfDelivery:
    stop = get_stop(db, stop_id, driver_id)
    if stop.status != DeliveryStopStatus.DELIVERED and stop.status != DeliveryStopStatus.PARTIAL:
        raise HTTPException(status_code=400, detail="Outcome must be delivered or partial before POD")
        
    # Idempotent: a retried submit (e.g. offline replay) returns the stored POD
    existing_pod = db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == stop.id).first()
    if existing_pod:
        return existing_pod

    # photo_url always holds a JSON array of URLs (a POD can have several photos)
    photo_url = pod_data.get("photo_url")
    if photo_url and not photo_url.startswith("["):
        photo_url = json.dumps([photo_url])

    pod = ProofOfDelivery(
        stop_id=stop.id,
        recipient_name=pod_data["recipient_name"],
        signature_data=pod_data.get("signature_data"),
        photo_url=photo_url,
        notes=pod_data.get("notes")
    )
    db.add(pod)
    
    # Auto complete the stop when POD is submitted
    stop.completed_at = datetime.now(timezone.utc)
    trip = stop.driver_trip
    db.flush()
    _sync_progress(trip)
    if stop.status == DeliveryStopStatus.PARTIAL:
        _log(trip, "Partly delivered", f"Stop {stop.sequence} · {stop.customer_name}", "warning")
    else:
        _log(trip, "Delivered", f"Stop {stop.sequence} · signed by {pod.recipient_name}")

    db.commit()

    # The store sees the order arrive; order updates commit on their own.
    run, run_stop = _run_stop_for(db, stop)
    if run_stop is not None:
        for order in _orders_at(run, run_stop, loaded_only=True):
            _advance_order(db, order.id, OrderStatus.DELIVERED)
    elif stop.shipment and stop.shipment.order_id:
        _advance_order(db, stop.shipment.order_id, OrderStatus.DELIVERED)
    db.refresh(pod)
    return pod


def complete_stop(db: Session, stop_id: int, driver_id: int) -> DeliveryStop:
    stop = get_stop(db, stop_id, driver_id)
    
    # If outcome is delivered, ensure POD exists
    if stop.status in [DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL]:
        if not stop.pod:
            raise HTTPException(status_code=400, detail="POD required before completing stop")
            
    if stop.status not in [DeliveryStopStatus.DELIVERED, DeliveryStopStatus.FAILED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.RESCHEDULED]:
        raise HTTPException(status_code=400, detail="Outcome must be set before completing stop")
        
    stop.completed_at = datetime.now(timezone.utc)
    db.commit()
    # A delivered (or partly delivered) stop tells the store its order arrived; it then confirms receipt.
    if stop.status in (DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL) and stop.shipment is not None:
        order_service.mark_order_delivered(db, stop.shipment.order_id)
    db.refresh(stop)
    return stop


from app.models.driver import IssueReport, IssueType, SOSAlert, IssueStatus, SOSStatus

ISSUE_LABELS = {
    IssueType.OUTLET_CLOSED: "Outlet closed",
    IssueType.ACCESS_DENIED: "Access denied",
    IssueType.ORDER_MISMATCH: "Order mismatch",
    IssueType.DAMAGED_GOODS: "Damaged goods",
    IssueType.WRONG_ADDRESS: "Wrong address",
    IssueType.CUSTOMER_UNAVAILABLE: "Customer unavailable",
    IssueType.VEHICLE_BREAKDOWN: "Vehicle breakdown",
    IssueType.TRAFFIC_DELAY: "Traffic delay",
    IssueType.OTHER: "Other",
}


def report_issue(db: Session, trip_id: int, issue_data: dict, driver_id: int) -> IssueReport:
    trip = get_trip_detail(db, trip_id, driver_id)

    # Idempotent: a report the phone sends again (offline replay, a dropped
    # connection) returns the one already saved
    client_action_id = issue_data.get("client_action_id")
    if client_action_id:
        existing = db.query(IssueReport).filter(IssueReport.client_action_id == client_action_id).first()
        if existing is not None:
            return existing

    stop = None
    stop_id = issue_data.get("stop_id")
    if stop_id:
        # Validate stop belongs to this trip
        stop = db.query(DeliveryStop).filter(
            DeliveryStop.id == stop_id,
            DeliveryStop.driver_trip_id == trip.id
        ).first()
        if not stop:
            raise HTTPException(status_code=400, detail="Stop does not belong to this trip")

    issue_type = IssueType(issue_data["issue_type"])
    issue = IssueReport(
        driver_trip_id=trip.id,
        stop_id=stop_id,
        issue_type=issue_type,
        description=issue_data["description"],
        photo_url=issue_data.get("photo_url"),
        client_action_id=client_action_id,
    )
    db.add(issue)
    # The dispatcher sees the report in the run log
    where = f"Stop {stop.sequence} · {stop.customer_name}" if stop else "Whole trip"
    _log(trip, "Problem reported", f"{ISSUE_LABELS[issue_type]} · {where} · {issue.description[:120]}", "warning")
    db.commit()
    db.refresh(issue)
    return issue


def get_trip_issues(db: Session, trip_id: int, driver_id: int) -> List[IssueReport]:
    trip = get_trip_detail(db, trip_id, driver_id)
    return sorted(trip.issues, key=lambda issue: issue.id, reverse=True)


def _dispatcher_issue(issue: IssueReport) -> dict:
    trip = issue.driver_trip
    return {
        "id": issue.id,
        "driver_trip_id": issue.driver_trip_id,
        "stop_id": issue.stop_id,
        "issue_type": issue.issue_type,
        "description": issue.description,
        "photo_url": issue.photo_url,
        "status": issue.status,
        "created_at": issue.created_at,
        "driver_name": trip.driver.full_name if trip.driver else None,
        "trip_code": trip.dispatch_trip.trip_code if trip.dispatch_trip else None,
        "stop_sequence": issue.stop.sequence if issue.stop else None,
        "stop_name": issue.stop.customer_name if issue.stop else None,
    }


def list_issues(db: Session, status: Optional[IssueStatus] = None, limit: int = 200) -> List[dict]:
    """Drivers' reports for the dispatcher, newest first."""
    query = db.query(IssueReport)
    if status is not None:
        query = query.filter(IssueReport.status == status)
    return [_dispatcher_issue(issue) for issue in query.order_by(IssueReport.id.desc()).limit(limit)]


def set_issue_status(db: Session, issue_id: int, status: IssueStatus) -> dict:
    """The dispatcher acknowledges or resolves a report; the driver sees it on their list."""
    issue = db.get(IssueReport, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Report not found")
    issue.status = status
    db.commit()
    db.refresh(issue)
    return _dispatcher_issue(issue)


def trigger_sos(db: Session, driver_id: int, sos_data: dict, at: Optional[datetime] = None) -> SOSAlert:
    trip_id = sos_data.get("driver_trip_id")
    if trip_id:
        # verify trip belongs to driver
        get_trip_detail(db, trip_id, driver_id)

    alert = SOSAlert(
        driver_id=driver_id,
        driver_trip_id=trip_id,
        latitude=sos_data.get("latitude"),
        longitude=sos_data.get("longitude"),
        message=sos_data.get("message"),
        triggered_at=_tap_time(at),  # an SOS sent from the offline queue keeps when it was pressed
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
        trip.completed_at = datetime.now(timezone.utc)
    _close_dispatch_trip(trip)
    if trip.dispatch_trip is not None and trip.dispatch_trip.actual_arrival is None:
        trip.dispatch_trip.actual_arrival = datetime.now(timezone.utc)
        _log(trip, "Back at depot", "Driver checked in")

    db.commit()
    db.refresh(trip)
    return trip


# ---- Profile -------------------------------------------------------------------
# An account made in Admin has a login but no driver_profiles row. Without one the
# driver gets no trips and dispatch can't pick them, so the driver adds phone and
# licence from the profile screen. The vehicle stays the depot's to set.

def get_profile(db: Session, driver_id: int) -> dict:
    user = db.get(User, driver_id)
    profile = db.query(DriverProfile).filter(DriverProfile.user_id == driver_id).first()
    vehicle = profile.vehicle if profile is not None else None
    current = db.query(DriverTrip).filter(
        DriverTrip.driver_id == driver_id,
        DriverTrip.status.in_([DriverTripStatus.ASSIGNED, DriverTripStatus.STARTED]),
    ).order_by(DriverTrip.id.desc()).first()
    return {
        "full_name": user.full_name,
        "email": user.email,
        "phone": profile.phone if profile is not None else None,
        "license_type": profile.license_type if profile is not None else None,
        "complete": bool(profile is not None and profile.phone and profile.license_type),
        "vehicle": {
            "code": vehicle.code,
            "vehicle_type": vehicle.vehicle_type,
            "temperature_mode": vehicle.temperature_mode,
            "depot_name": vehicle.depot_name,
        } if vehicle is not None else None,
        "todays_vehicle": current.dispatch_trip.vehicle_number
        if current is not None and current.dispatch_trip is not None else None,
    }


def update_profile(db: Session, driver_id: int, phone: str, license_type: str) -> dict:
    profile = db.query(DriverProfile).filter(DriverProfile.user_id == driver_id).first()
    if profile is None:
        db.add(DriverProfile(user_id=driver_id, phone=phone, license_type=license_type))
    else:
        # Saved once, the phone number stays: only the licence can change.
        if profile.phone and (normalise_phone(profile.phone) or profile.phone) != phone:
            raise HTTPException(status_code=400, detail="Your phone number can't be changed.")
        profile.phone = profile.phone or phone
        profile.license_type = license_type
    db.commit()
    return get_profile(db, driver_id)


# ---- Ready for tomorrow --------------------------------------------------------
# Before the 4 PM cutoff the driver says they can take a run on the next working
# day (calendar_days; a day not listed is a working day unless it is a Sunday),
# so the dispatcher plans around who is available. One row per driver per day.

READY_CUTOFF = time(16, 0)  # dispatch plans the next day's trips at 4 PM


def ready_day(db: Session, now: datetime) -> date:
    """The working day an "I'm ready" given now is for (now: Sri Lanka time)."""
    return CalendarService.get_next_operating_day(db, now.date())


def get_ready_tomorrow(db: Session, driver_id: int, now: datetime) -> dict:
    day = ready_day(db, now)
    row = db.query(DriverAvailability).filter(
        DriverAvailability.driver_id == driver_id, DriverAvailability.for_date == day,
    ).first()
    return {
        "for_date": day,
        "confirmed": row is not None,
        "confirmed_at": row.confirmed_at if row is not None else None,
        "open": now.time() < READY_CUTOFF,
    }


def confirm_ready_tomorrow(db: Session, driver_id: int, now: datetime) -> dict:
    """Saves the driver as available. Confirming again returns the first confirmation."""
    state = get_ready_tomorrow(db, driver_id, now)
    if state["confirmed"]:
        return state
    if not state["open"]:
        raise HTTPException(
            status_code=409,
            detail="It's after 4 PM, so dispatch has already planned the next day. Call dispatch if you can still drive.",
        )
    db.add(DriverAvailability(driver_id=driver_id, for_date=state["for_date"]))
    try:
        db.commit()
    except IntegrityError:  # a double tap saved it a moment ago
        db.rollback()
    return get_ready_tomorrow(db, driver_id, now)


def list_available_drivers(db: Session, day: date) -> List[dict]:
    """Drivers who said they can take a run on `day`, for the dispatcher."""
    rows = db.query(DriverAvailability, User).join(User, User.id == DriverAvailability.driver_id).filter(
        DriverAvailability.for_date == day,
    ).order_by(User.full_name).all()
    user_ids = [user.id for _, user in rows]
    profiles = {
        profile.user_id: profile
        for profile in db.query(DriverProfile).filter(DriverProfile.user_id.in_(user_ids)).all()
    } if user_ids else {}
    result = []
    for row, user in rows:
        profile = profiles.get(user.id)
        result.append({
            "driver_id": user.id,
            "driver_profile_id": profile.id if profile is not None else None,
            "full_name": user.full_name,
            "phone": profile.phone if profile is not None else None,
            "vehicle_code": profile.vehicle.code if profile is not None and profile.vehicle is not None else None,
            "confirmed_at": row.confirmed_at,
        })
    return result


def process_sync_batch(db: Session, actions: list, driver_id: int) -> dict:
    processed_count = 0
    conflicts = []
    
    for action in actions:
        try:
            if action.action_type == "arrive":
                record_arrival(db, action.stop_id, driver_id, at=action.client_timestamp)
            elif action.action_type == "outcome":
                record_outcome(db, action.stop_id, action.payload["outcome"], driver_id)
            elif action.action_type == "pod":
                submit_pod(db, action.stop_id, action.payload, driver_id)
            elif action.action_type == "complete":
                complete_stop(db, action.stop_id, driver_id)
            elif action.action_type == "issue":
                # The queue's id dedupes a report saved by an older app without one
                payload = {**action.payload, "client_action_id": action.payload.get("client_action_id") or action.action_id}
                report_issue(db, action.trip_id, payload, driver_id)
            elif action.action_type == "sos":
                trigger_sos(db, driver_id, action.payload, at=action.client_timestamp)

            processed_count += 1
            
        except HTTPException as e:
            # If a stop fails validation (e.g. already delivered), log as conflict
            conflicts.append({
                "action_id": action.action_id,
                "stop_id": action.stop_id,
                "reason": e.detail,
                "server_state": {"status": e.status_code}
            })
        except Exception as e:
            conflicts.append({
                "action_id": action.action_id,
                "stop_id": action.stop_id,
                "reason": str(e),
                "server_state": {}
            })
            
    return {
        "processed_count": processed_count,
        "conflicts": conflicts
    }


