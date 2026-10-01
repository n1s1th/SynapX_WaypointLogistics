"""Driver workflow: collect the released run, deliver it stop by stop, sync offline records.

Hand-off from the loader. The loader signs a run off as ready_to_depart ("Signed off ·
driver can collect"). Starting the trip is the gate-out: the run becomes gated_out and
is the driver's from then on (docs/loader/API_CONTRACT.md). The run's stops are copied
into delivery_stops at that moment, so the driver's record stays stable offline and the
loader's tables are never edited after gate-out.

Link to the dispatcher. The trip hangs off a dispatch_trips row (the seam the loader left
in delivery_runs.dispatch_trip_id). Its status, stops_completed, updated_at and event log
move with the driver, so the dispatcher's delivery-run screens show progress without
changes on their side. Driver events use status "ok" or "warning" only: the dispatcher's
shortfall dialog reads "error" events as loading shortfalls.

Orders and the store. Order statuses follow docs/store-manager-contract.md: dispatched
when the vehicle leaves, delivered when the driver records a delivery (or partial
delivery). A stop that fails keeps its orders dispatched and raises an issue for the
dispatcher instead, because the contract has no way back from dispatched. The order
service notifies the store about delivered orders; this service sends eta_updated.

Offline. Every write is idempotent: repeating it returns the current state, so an action
replayed by POST /driver/sync is never applied twice. A stop the dispatcher removed
after departure (status rescheduled) refuses new records with 409 STOP_REMOVED, which
the phone shows as a conflict for the driver to resolve.
"""
from __future__ import annotations

import logging
import math
from collections import deque
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.exceptions import WaypointLogisticsError
from app.models.delivery_run import DeliveryRun, RunOrderState, RunStatus, RunStop, RunStopOrder
from app.models.driver import (
    DeliveryStop,
    DeliveryStopStatus,
    DriverAvailability,
    DriverTrip,
    DriverTripStatus,
    IssueReport,
    IssueStatus,
    IssueType,
    ProofOfDelivery,
    SOSAlert,
    SOSStatus,
)
from app.models.fleet import DriverProfile, Vehicle
from app.models.notification import NotificationType
from app.models.order import Order, OrderStatus
from app.models.reference import Outlet, TemperatureClass
from app.models.shipment import DispatchTrip
from app.models.user import User
from app.schemas.driver import IssueIn, OutcomeIn, PodIn, ResolveIn, SOSAlertCreate, SyncAction
from app.services import geo
from app.services.calendar_service import calendar_service
from app.services.notification_service import notification_service
from app.services.order_service import TRANSITIONS, order_service

logger = logging.getLogger(__name__)

COLOMBO = ZoneInfo("Asia/Colombo")

DONE_OUTCOMES = {DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL, DeliveryStopStatus.FAILED}
DELIVERED_OUTCOMES = {DeliveryStopStatus.DELIVERED, DeliveryStopStatus.PARTIAL}
OUTCOMES = {
    "delivered": DeliveryStopStatus.DELIVERED,
    "partial": DeliveryStopStatus.PARTIAL,
    "failed": DeliveryStopStatus.FAILED,
}
# A finished trip stays on the home screen this long, for the day's summary.
COMPLETED_VISIBLE_FOR = timedelta(hours=18)
MAX_SIGNATURE_CHARS = 400_000
MAX_PHOTO_CHARS = 2_500_000
# Order statuses a gate-out or delivery never passes through on its way.
DETOUR_STATUSES = {OrderStatus.DEFERRED, OrderStatus.CANCELLED}
DEPOT_LABELS = {"peliyagoda": "Peliyagoda", "kandy": "Kandy"}


# ---- Time --------------------------------------------------------------------
# The database stores naive UTC; the API sends aware UTC; the phone shows Colombo time.

def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _when(client_timestamp: Optional[datetime], now: datetime) -> datetime:
    """When the driver actually did it: the tap time from an offline record,
    never in the future (a phone clock running fast)."""
    stamp = _naive_utc(client_timestamp)
    if stamp is None or stamp > now:
        return now
    return stamp


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _iso(value: Optional[datetime]) -> Optional[str]:
    aware = _aware(value)
    return aware.isoformat() if aware else None


def _local(value: datetime) -> datetime:
    return _aware(value).astimezone(COLOMBO)


def _hhmm(value: Optional[datetime]) -> Optional[str]:
    return _local(value).strftime("%H:%M") if value else None


def _clock(value: Optional[time]) -> Optional[str]:
    return value.strftime("%H:%M") if value else None


# ---- Errors ------------------------------------------------------------------
# Same envelope as the rest of the API: {"detail": {"code", "message", ...}}.

def _error(status_code: int, code: str, message: str, **details: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **details})


def _not_found(code: str, message: str) -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, code, message)


def _conflict(code: str, message: str, **details: Any) -> HTTPException:
    return _error(status.HTTP_409_CONFLICT, code, message, **details)


def _invalid(code: str, message: str, **details: Any) -> HTTPException:
    return _error(422, code, message, **details)


# ---- Lookups -----------------------------------------------------------------

def _profile(db: Session, user: User) -> Optional[DriverProfile]:
    return db.execute(select(DriverProfile).where(DriverProfile.user_id == user.id)).scalars().first()


def _vehicle(db: Session, profile: Optional[DriverProfile]) -> Optional[Vehicle]:
    if profile is None or profile.assigned_vehicle_id is None:
        return None
    return db.get(Vehicle, profile.assigned_vehicle_id)


def _vehicle_ref(vehicle: Optional[Vehicle]) -> Optional[Dict[str, Any]]:
    if vehicle is None:
        return None
    return {
        "code": vehicle.code,
        "type": vehicle.vehicle_type,
        "temperature_mode": vehicle.temperature_mode,
        "depot": vehicle.depot_name,
    }


def _place(place: geo.Place) -> Dict[str, Any]:
    return {"name": place.name, "latitude": place.latitude, "longitude": place.longitude}


def _depot_label(depot: Optional[str]) -> str:
    return DEPOT_LABELS.get((depot or "").lower(), "the depot")


def _run_by_code(db: Session, code: str) -> DeliveryRun:
    run = db.execute(select(DeliveryRun).where(DeliveryRun.code == code)).scalars().first()
    if run is None:
        raise _not_found("RUN_NOT_FOUND", f"Run {code} not found.")
    return run


def _run_for_trip(db: Session, trip: DriverTrip) -> Optional[DeliveryRun]:
    return (
        db.execute(select(DeliveryRun).where(DeliveryRun.dispatch_trip_id == trip.dispatch_trip_id))
        .scalars()
        .first()
    )


def _trip_for_run(db: Session, run: DeliveryRun) -> Optional[DriverTrip]:
    if run.dispatch_trip_id is None:
        return None
    return (
        db.execute(
            select(DriverTrip)
            .where(DriverTrip.dispatch_trip_id == run.dispatch_trip_id)
            .order_by(DriverTrip.id.desc())
        )
        .scalars()
        .first()
    )


def _current_run_stops(db: Session, run: DeliveryRun) -> List[RunStop]:
    return list(
        db.execute(
            select(RunStop)
            .where(RunStop.run_id == run.id, RunStop.plan_version == run.current_plan_version)
            .order_by(RunStop.stop_sequence)
        ).scalars()
    )


def _rows(run_stop: RunStop, plan_version: int) -> List[RunStopOrder]:
    return [row for row in run_stop.orders if row.plan_version == plan_version]


def _orders_on_truck(run: Optional[DeliveryRun], run_stop: Optional[RunStop]) -> List[Order]:
    if run is None or run_stop is None:
        return []
    return [row.order for row in _rows(run_stop, run.current_plan_version) if row.state == RunOrderState.LOADED]


def _stop_context(db: Session, trip: DriverTrip) -> Tuple[Optional[DeliveryRun], Dict[int, RunStop]]:
    run = _run_for_trip(db, trip)
    if run is None:
        return None, {}
    return run, {run_stop.stop_sequence: run_stop for run_stop in _current_run_stops(db, run)}


def _trip(db: Session, user: User, trip_id: int) -> DriverTrip:
    trip = db.get(DriverTrip, trip_id)
    if trip is None or trip.driver_id != user.id:
        raise _not_found("TRIP_NOT_FOUND", "Trip not found or not assigned to you.")
    return trip


def _stop(db: Session, user: User, stop_id: Optional[int]) -> DeliveryStop:
    stop = db.get(DeliveryStop, stop_id) if stop_id is not None else None
    if stop is None or stop.driver_trip.driver_id != user.id:
        raise _not_found("STOP_NOT_FOUND", "Stop not found on your trips.")
    return stop


def _is_done(stop: DeliveryStop) -> bool:
    """Finished from the driver's side: removed by dispatch, or an outcome that is
    closed (a failed stop closes at once; a delivery closes with its proof)."""
    if stop.status == DeliveryStopStatus.RESCHEDULED:
        return True
    return stop.status in DONE_OUTCOMES and stop.completed_at is not None


def _stop_state(stop: DeliveryStop) -> Dict[str, Any]:
    """What the server holds for a stop, for a conflict the phone has to show."""
    return {
        "stop_id": stop.id,
        "sequence": stop.sequence,
        "name": stop.customer_name,
        "status": stop.status.value,
        "note": stop.notes,
        "arrived_at": _iso(stop.arrived_at),
        "completed_at": _iso(stop.completed_at),
    }


def _discard_pending(db: Session) -> None:
    """Drop what a refused action left unsaved. Each write validates before it changes
    anything, so usually there is nothing to drop; earlier actions are already committed."""
    if db.new or db.dirty or db.deleted:
        db.rollback()


def _require_active(trip: DriverTrip) -> None:
    if trip.status != DriverTripStatus.STARTED:
        raise _conflict(
            "TRIP_NOT_ACTIVE",
            f"This trip is {trip.status.value}; stops can only be recorded on a started trip.",
            trip_status=trip.status.value,
        )


def _require_not_removed(stop: DeliveryStop) -> None:
    if stop.status == DeliveryStopStatus.RESCHEDULED:
        raise _conflict(
            "STOP_REMOVED",
            stop.notes or "Dispatch removed this stop from your trip.",
            server_state=_stop_state(stop),
        )


# ---- Dispatcher link -----------------------------------------------------------

def _log(trip: DriverTrip, event: str, note: str, now: datetime, level: str = "ok") -> None:
    """Add a line to the dispatcher's run log and mark the run as recently heard from."""
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is None:
        return
    events = list(dispatch_trip.loading_events or [])
    events.append({"event": event, "time": _hhmm(now), "note": note, "status": level})
    dispatch_trip.loading_events = events
    dispatch_trip.updated_at = now


def _sync_progress(trip: DriverTrip, now: datetime) -> None:
    dispatch_trip = trip.dispatch_trip
    if dispatch_trip is None:
        return
    dispatch_trip.stop_count = len(trip.stops)
    dispatch_trip.stops_completed = sum(1 for stop in trip.stops if _is_done(stop))
    dispatch_trip.updated_at = now


def _link_dispatch_trip(
    db: Session,
    run: DeliveryRun,
    vehicle: Vehicle,
    user: User,
    profile: Optional[DriverProfile],
    run_stops: List[RunStop],
    now: datetime,
) -> DispatchTrip:
    """The dispatcher's row for this run: the one already linked, else the one with the
    same run code, else a new one."""
    dispatch_trip = db.get(DispatchTrip, run.dispatch_trip_id) if run.dispatch_trip_id else None
    if dispatch_trip is None:
        dispatch_trip = (
            db.execute(select(DispatchTrip).where(DispatchTrip.trip_code == run.code)).scalars().first()
        )
    depot = vehicle.depot_name or "peliyagoda"
    if dispatch_trip is None:
        dispatch_trip = DispatchTrip(
            trip_code=run.code,
            vehicle_id=vehicle.id,
            driver_id=profile.id if profile else None,
            vehicle_number=vehicle.code,
            driver_name=user.full_name,
            origin=_depot_label(depot),
            destination=f"{run.district} · {run.brand.value.title()}",
            depot_name=depot,
            status="en_route",
            departure_time=now,
            total_weight_kg=run.loaded_weight_kg or 0.0,
            total_volume_m3=run.loaded_volume_m3 or 0.0,
            stop_count=len(run_stops),
            stops_completed=0,
            stop_sequence=[run_stop.outlet.name for run_stop in run_stops],
            open_shortfalls=0,
            loading_events=[],
        )
        db.add(dispatch_trip)
        db.flush()
    else:
        dispatch_trip.status = "en_route"
        if dispatch_trip.departure_time is None:
            dispatch_trip.departure_time = now
        if not dispatch_trip.driver_name or dispatch_trip.driver_name == "Unassigned":
            dispatch_trip.driver_name = user.full_name
        if not dispatch_trip.stop_sequence:
            dispatch_trip.stop_sequence = [run_stop.outlet.name for run_stop in run_stops]
    run.dispatch_trip_id = dispatch_trip.id
    return dispatch_trip


# ---- Orders and the store ----------------------------------------------------

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
    """Move an order to target through the order service, which validates every
    step and notifies the store. A refused step leaves the order where it is: the
    driver's record is already saved, and the order can catch up later."""
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


def _notify_departure(db: Session, run: DeliveryRun, run_stops: List[RunStop], left_at: datetime) -> None:
    depot = _depot_label(run.vehicle.depot_name if run.vehicle else None)
    for run_stop in run_stops:
        for order in _orders_on_truck(run, run_stop):
            _advance_order(db, order.id, OrderStatus.DISPATCHED)
            try:
                notification_service.send(
                    db,
                    run_stop.outlet_id,
                    NotificationType.ETA_UPDATED,
                    {
                        "order_id": order.id,
                        "order_number": order.order_number,
                        "eta": _hhmm(run_stop.eta),
                        "note": (
                            f"{run.code} left {depot} at {_hhmm(left_at)}. "
                            f"Stop {run_stop.stop_sequence} of {len(run_stops)}."
                        ),
                    },
                )
            except Exception:  # a missed notification must not undo the departure
                logger.exception("ETA notification for %s failed", order.order_number)
                db.rollback()


# ---- Views ---------------------------------------------------------------------

def _timing(stop: DeliveryStop, run_stop: Optional[RunStop]) -> Optional[Dict[str, Any]]:
    """Arrival against the outlet's window (brief p15): early means the vehicle waits
    for the window to open; arriving after it closes is late."""
    outlet = run_stop.outlet if run_stop else None
    if stop.arrived_at is None or outlet is None:
        return None
    arrival = _local(stop.arrived_at)
    if outlet.window_end is not None:
        closes = datetime.combine(arrival.date(), outlet.window_end, tzinfo=COLOMBO)
        if arrival > closes:
            return {"status": "late", "minutes": int((arrival - closes).total_seconds() // 60)}
    if outlet.window_start is not None:
        opens = datetime.combine(arrival.date(), outlet.window_start, tzinfo=COLOMBO)
        if arrival < opens:
            return {"status": "early", "minutes": math.ceil((opens - arrival).total_seconds() / 60)}
    return {"status": "on_time", "minutes": 0}


def _temperature(order: Order) -> str:
    if order.temperature_class is not None:
        return order.temperature_class.value
    return "chilled" if (order.temperature_zone or "").lower() == "chilled" else "ambient"


def _outlet_ref(outlet: Outlet) -> Dict[str, Any]:
    return {
        "code": outlet.code,
        "name": outlet.name,
        "district": outlet.district,
        "brand": outlet.brand.value,
        "dock_type": outlet.dock_type.value,
        "van_only": bool(outlet.van_only),
        "window_start": _clock(outlet.window_start),
        "window_end": _clock(outlet.window_end),
    }


def _order_rows(run: Optional[DeliveryRun], run_stop: Optional[RunStop]) -> List[Dict[str, Any]]:
    """What the stop gets. Orders the loader flagged or moved are listed as not on the truck."""
    if run is None or run_stop is None:
        return []
    return [
        {
            "order_number": row.order.order_number,
            "temperature": _temperature(row.order),
            "units": row.units,
            "weight_kg": row.weight_kg,
            "volume_m3": row.volume_m3,
            "on_truck": row.state == RunOrderState.LOADED,
            "loader_state": row.state.value,
        }
        for row in _rows(run_stop, run.current_plan_version)
    ]


def _run_ref(run: DeliveryRun) -> Dict[str, Any]:
    return {
        "code": run.code,
        "trip_number": run.trip_number,
        "brand": run.brand.value,
        "district": run.district,
        "wave": run.wave,
        "departs_at": _aware(run.departs_at),
        "plan_version": run.current_plan_version,
    }


def _stop_view(
    stop: DeliveryStop,
    run: Optional[DeliveryRun],
    run_stop: Optional[RunStop],
    departed_at: Optional[datetime],
) -> Dict[str, Any]:
    outlet = run_stop.outlet if run_stop else None
    pod = stop.pod
    removed = stop.status == DeliveryStopStatus.RESCHEDULED
    return {
        "id": stop.id,
        "sequence": stop.sequence,
        "status": stop.status.value,
        "name": outlet.name if outlet else stop.customer_name,
        "address": stop.address,
        "latitude": stop.latitude,
        "longitude": stop.longitude,
        "location_approximate": True,
        "outlet": _outlet_ref(outlet) if outlet else None,
        "eta": _aware(run_stop.eta) if run_stop else None,
        "handling_minutes": run_stop.handling_minutes if run_stop else None,
        "departed_at": _aware(departed_at),
        "arrived_at": _aware(stop.arrived_at),
        "completed_at": _aware(stop.completed_at),
        "timing": _timing(stop, run_stop),
        "orders": _order_rows(run, run_stop),
        "note": None if removed else stop.notes,
        "removed_reason": stop.notes if removed else None,
        "pod": (
            {
                "recipient_name": pod.recipient_name,
                "has_signature": bool(pod.signature_data),
                "has_photo": bool(pod.photo_url),
                "created_at": _aware(pod.created_at),
            }
            if pod
            else None
        ),
    }


def _counts(stops: Iterable[DeliveryStop]) -> Dict[str, int]:
    stops = list(stops)
    return {
        "total": len(stops),
        "done": sum(1 for stop in stops if _is_done(stop)),
        "delivered": sum(1 for stop in stops if stop.status == DeliveryStopStatus.DELIVERED),
        "partial": sum(1 for stop in stops if stop.status == DeliveryStopStatus.PARTIAL),
        "failed": sum(1 for stop in stops if stop.status == DeliveryStopStatus.FAILED),
        "removed": sum(1 for stop in stops if stop.status == DeliveryStopStatus.RESCHEDULED),
        "pod": sum(1 for stop in stops if stop.pod is not None),
    }


def _run_card(db: Session, run: DeliveryRun, trip: Optional[DriverTrip], vehicle: Optional[Vehicle]) -> Dict[str, Any]:
    run_stops = _current_run_stops(db, run)
    has_chilled = any(
        row.order.temperature_class == TemperatureClass.CHILLED
        for run_stop in run_stops
        for row in _rows(run_stop, run.current_plan_version)
    )
    if trip is not None:
        state = "completed" if trip.status == DriverTripStatus.COMPLETED else "in_progress"
        stop_count = len(trip.stops)
        stops_done = sum(1 for stop in trip.stops if _is_done(stop))
    else:
        state = "ready" if run.status in (RunStatus.READY_TO_DEPART, RunStatus.GATED_OUT) else "being_loaded"
        stop_count = len(run_stops)
        stops_done = 0
    dispatch_trip = trip.dispatch_trip if trip else None
    return {
        "code": run.code,
        "trip_id": trip.id if trip else None,
        "trip_number": run.trip_number,
        "brand": run.brand.value,
        "district": run.district,
        "wave": run.wave,
        "departs_at": _aware(run.departs_at),
        "depot": vehicle.depot_name if vehicle else None,
        "loader_status": run.status.value,
        "state": state,
        "stop_count": stop_count,
        "stops_done": stops_done,
        "has_chilled": has_chilled,
        "checked_in": bool(dispatch_trip and dispatch_trip.actual_arrival),
        "vehicle": _vehicle_ref(vehicle),
    }


def _unlinked_card(trip: DriverTrip) -> Dict[str, Any]:
    """A trip with no loader run behind it (made before the hand-off existed)."""
    dispatch_trip = trip.dispatch_trip
    if trip.status == DriverTripStatus.COMPLETED:
        state = "completed"
    elif trip.status == DriverTripStatus.STARTED:
        state = "in_progress"
    else:
        state = "ready"
    return {
        "code": dispatch_trip.trip_code if dispatch_trip else f"TRIP-{trip.id}",
        "trip_id": trip.id,
        "trip_number": 1,
        "brand": None,
        "district": dispatch_trip.destination if dispatch_trip else None,
        "wave": None,
        "departs_at": _aware(dispatch_trip.departure_time if dispatch_trip else trip.assigned_date),
        "depot": dispatch_trip.depot_name if dispatch_trip else None,
        "loader_status": None,
        "state": state,
        "stop_count": len(trip.stops),
        "stops_done": sum(1 for stop in trip.stops if _is_done(stop)),
        "has_chilled": False,
        "checked_in": bool(dispatch_trip and dispatch_trip.actual_arrival),
        "vehicle": None,
    }


def _outcome_note(
    outcome: DeliveryStopStatus,
    data: OutcomeIn,
    run: Optional[DeliveryRun],
    run_stop: Optional[RunStop],
) -> Optional[str]:
    parts: List[str] = []
    if outcome == DeliveryStopStatus.PARTIAL and data.delivered_units:
        planned = (
            {row.order.order_number: row.units for row in _rows(run_stop, run.current_plan_version)}
            if run is not None and run_stop is not None
            else {}
        )
        for number, units in sorted(data.delivered_units.items()):
            total = planned.get(number)
            parts.append(f"{number} {units}/{total} units" if total is not None else f"{number} {units} units")
    if data.reason:
        parts.append(f"Reason: {data.reason.strip()}")
    if data.note:
        parts.append(data.note.strip())
    return " · ".join(parts) or None


def _failure_issue_type(reason: Optional[str]) -> IssueType:
    text = (reason or "").lower()
    if any(word in text for word in ("closed", "no one", "nobody", "unavailable", "window")):
        return IssueType.CUSTOMER_UNAVAILABLE
    if "damage" in text:
        return IssueType.DAMAGED_GOODS
    if "address" in text or "location" in text:
        return IssueType.WRONG_ADDRESS
    if "breakdown" in text:
        return IssueType.VEHICLE_BREAKDOWN
    if "traffic" in text or "road" in text:
        return IssueType.TRAFFIC_DELAY
    return IssueType.OTHER


def _check_evidence(value: Optional[str], limit: int, field: str) -> Optional[str]:
    if not value:
        return None
    if not value.startswith("data:image/"):
        raise _invalid("INVALID_EVIDENCE", f"{field} must be an image captured on the phone.")
    if len(value) > limit:
        raise _invalid("EVIDENCE_TOO_LARGE", f"{field} is too large; retake it.")
    return value


class DriverService:
    # ---- Profile and run list ------------------------------------------------

    @staticmethod
    def me(db: Session, user: User) -> Dict[str, Any]:
        profile = _profile(db, user)
        vehicle = _vehicle(db, profile)
        role = user.role.value if hasattr(user.role, "value") else str(user.role)
        return {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": role,
            "driver_code": f"DRV-{user.id:04d}",
            "phone": profile.phone if profile else None,
            "license_type": profile.license_type if profile else None,
            "vehicle": _vehicle_ref(vehicle),
            "depot": _place(geo.depot_place(vehicle.depot_name)) if vehicle else None,
        }

    @staticmethod
    def list_runs(db: Session, user: User, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """The driver's open trips, plus ones finished in the last 18 hours.

        Not narrowed to one date (the loader queue isn't either): seeded demo days
        and a 03:30 Fresh departure the night before must both show.
        """
        now = now or _now()
        vehicle = _vehicle(db, _profile(db, user))
        cards: List[Dict[str, Any]] = []
        seen_trip_ids = set()

        def recently_relevant(trip: Optional[DriverTrip]) -> bool:
            if trip is None or trip.status != DriverTripStatus.COMPLETED or trip.completed_at is None:
                return True
            return trip.completed_at >= now - COMPLETED_VISIBLE_FOR

        if vehicle is not None:
            runs = db.execute(
                select(DeliveryRun)
                .where(DeliveryRun.vehicle_id == vehicle.id)
                .order_by(DeliveryRun.departs_at, DeliveryRun.trip_number)
            ).scalars()
            for run in runs:
                trip = _trip_for_run(db, run)
                if trip is not None and trip.driver_id != user.id:
                    continue
                if trip is not None:
                    seen_trip_ids.add(trip.id)
                if recently_relevant(trip):
                    cards.append(_run_card(db, run, trip, vehicle))

        own_trips = db.execute(select(DriverTrip).where(DriverTrip.driver_id == user.id)).scalars()
        for trip in own_trips:
            if trip.id in seen_trip_ids or not recently_relevant(trip):
                continue
            run = _run_for_trip(db, trip)
            cards.append(_run_card(db, run, trip, run.vehicle) if run else _unlinked_card(trip))

        far_future = datetime.max.replace(tzinfo=timezone.utc)
        cards.sort(key=lambda card: card["departs_at"] or far_future)
        return cards

    # ---- Trip ---------------------------------------------------------------

    @staticmethod
    def trip(db: Session, user: User, trip_id: int) -> DriverTrip:
        return _trip(db, user, trip_id)

    @staticmethod
    def trip_view(db: Session, trip: DriverTrip) -> Dict[str, Any]:
        run, run_stops = _stop_context(db, trip)
        dispatch_trip = trip.dispatch_trip
        if run is not None:
            vehicle = run.vehicle
        elif dispatch_trip is not None and dispatch_trip.vehicle_id is not None:
            vehicle = db.get(Vehicle, dispatch_trip.vehicle_id)
        else:
            vehicle = None
        depot = geo.depot_place(vehicle.depot_name if vehicle else (dispatch_trip.depot_name if dispatch_trip else None))

        stops = sorted(trip.stops, key=lambda stop: stop.sequence)
        views = []
        left_previous = trip.started_at
        for stop in stops:
            views.append(_stop_view(stop, run, run_stops.get(stop.sequence), left_previous))
            if stop.status != DeliveryStopStatus.RESCHEDULED:
                left_previous = stop.completed_at

        open_issues = db.execute(
            select(func.count(IssueReport.id)).where(
                IssueReport.driver_trip_id == trip.id, IssueReport.status == IssueStatus.OPEN
            )
        ).scalar_one()
        return {
            "id": trip.id,
            "status": trip.status.value,
            "started_at": _aware(trip.started_at),
            "completed_at": _aware(trip.completed_at),
            "checked_in_at": _aware(dispatch_trip.actual_arrival) if dispatch_trip else None,
            "run": _run_ref(run) if run else None,
            "vehicle": _vehicle_ref(vehicle),
            "depot": _place(depot),
            "stops": views,
            "counts": _counts(stops),
            "open_issues": open_issues,
        }

    @staticmethod
    def run_sheet(db: Session, user: User, code: str) -> Dict[str, Any]:
        """The digital run sheet: stops in order with windows, docks and what each gets.

        Readable before departure, so the driver can check the run at the depot
        (and the phone keeps a copy for the road)."""
        run = _run_by_code(db, code)
        trip = _trip_for_run(db, run)
        own_trip = trip is not None and trip.driver_id == user.id
        vehicle = _vehicle(db, _profile(db, user))
        if not own_trip and (vehicle is None or run.vehicle_id != vehicle.id):
            raise _error(status.HTTP_403_FORBIDDEN, "NOT_YOUR_RUN", f"{run.code} is not on your vehicle.")
        card = _run_card(db, run, trip if own_trip else None, run.vehicle)
        stops = []
        for run_stop in _current_run_stops(db, run):
            outlet = run_stop.outlet
            latitude, longitude = geo.approx_outlet_location(outlet.code, outlet.district, outlet.depot.value)
            stops.append(
                {
                    "sequence": run_stop.stop_sequence,
                    "name": outlet.name,
                    "outlet": _outlet_ref(outlet),
                    "eta": _aware(run_stop.eta),
                    "handling_minutes": run_stop.handling_minutes,
                    "latitude": latitude,
                    "longitude": longitude,
                    "location_approximate": True,
                    "orders": _order_rows(run, run_stop),
                }
            )
        return {
            "code": run.code,
            "state": card["state"],
            "trip_id": card["trip_id"],
            "loader_status": run.status.value,
            "released_at": _aware(run.released_at),
            "run": _run_ref(run),
            "vehicle": _vehicle_ref(run.vehicle),
            "depot": _place(geo.depot_place(run.vehicle.depot_name if run.vehicle else None)),
            "stops": stops,
        }

    @staticmethod
    def stop_view(db: Session, stop: DeliveryStop) -> Dict[str, Any]:
        view = DriverService.trip_view(db, stop.driver_trip)
        return next(item for item in view["stops"] if item["id"] == stop.id)

    @staticmethod
    def start_run(db: Session, user: User, code: str, now: Optional[datetime] = None) -> DriverTrip:
        """Collect a released run: the gate-out. Repeating it returns the same trip."""
        now = now or _now()
        run = _run_by_code(db, code)
        profile = _profile(db, user)
        vehicle = _vehicle(db, profile)
        if vehicle is None or run.vehicle_id != vehicle.id:
            raise _error(
                status.HTTP_403_FORBIDDEN,
                "NOT_YOUR_RUN",
                f"{run.code} is not on your vehicle.",
            )

        trip = _trip_for_run(db, run)
        if trip is not None:
            if trip.driver_id != user.id:
                raise _conflict("RUN_TAKEN", f"{run.code} was already collected by another driver.")
            return trip

        if run.status not in (RunStatus.READY_TO_DEPART, RunStatus.GATED_OUT):
            raise _conflict(
                "RUN_NOT_RELEASED",
                f"{run.code} is still at the dock ({run.status.value.replace('_', ' ')}). "
                "Wait for the loader to mark it ready to depart.",
                loader_status=run.status.value,
            )

        run_stops = _current_run_stops(db, run)
        dispatch_trip = _link_dispatch_trip(db, run, vehicle, user, profile, run_stops, now)
        run.status = RunStatus.GATED_OUT
        if run.gated_out_at is None:
            run.gated_out_at = now

        trip = DriverTrip(
            driver_id=user.id,
            dispatch_trip_id=dispatch_trip.id,
            status=DriverTripStatus.STARTED,
            assigned_date=run.departs_at,
            started_at=now,
        )
        db.add(trip)
        db.flush()
        for run_stop in run_stops:
            outlet = run_stop.outlet
            latitude, longitude = geo.approx_outlet_location(outlet.code, outlet.district, outlet.depot.value)
            db.add(
                DeliveryStop(
                    driver_trip_id=trip.id,
                    sequence=run_stop.stop_sequence,
                    address=f"{outlet.code} · {outlet.district}",
                    customer_name=outlet.name,
                    latitude=latitude,
                    longitude=longitude,
                    status=DeliveryStopStatus.PENDING,
                )
            )
        db.flush()
        _log(
            trip,
            "Left the gate",
            f"{user.full_name} collected {run.code} · {len(run_stops)} stops",
            now,
        )
        db.commit()

        # Orders and notifications commit on their own, so they go after the trip is safe.
        _notify_departure(db, run, run_stops, now)
        db.refresh(trip)
        return trip

    @staticmethod
    def start_trip(db: Session, user: User, trip_id: int, now: Optional[datetime] = None) -> DriverTrip:
        """Start (or resume) a trip by id. A trip already under way is returned as is."""
        now = now or _now()
        trip = _trip(db, user, trip_id)
        if trip.status != DriverTripStatus.ASSIGNED:
            return trip
        trip.status = DriverTripStatus.STARTED
        trip.started_at = now
        if trip.dispatch_trip is not None:
            trip.dispatch_trip.status = "en_route"
        _log(trip, "Left the gate", f"{user.full_name} started the trip", now)
        db.commit()
        db.refresh(trip)
        return trip

    # ---- Stops --------------------------------------------------------------

    @staticmethod
    def arrive(db: Session, user: User, stop_id: int, at: Optional[datetime] = None) -> DeliveryStop:
        now = _now()
        stop = _stop(db, user, stop_id)
        _require_not_removed(stop)
        if stop.status != DeliveryStopStatus.PENDING:
            return stop
        trip = stop.driver_trip
        _require_active(trip)
        stop.status = DeliveryStopStatus.ARRIVED
        stop.arrived_at = _when(at, now)
        _log(trip, "Arrived", f"Stop {stop.sequence} · {stop.customer_name}", now)
        db.commit()
        db.refresh(stop)
        return stop

    @staticmethod
    def record_outcome(db: Session, user: User, stop_id: int, data: OutcomeIn) -> DeliveryStop:
        now = _now()
        stop = _stop(db, user, stop_id)
        _require_not_removed(stop)
        outcome = OUTCOMES[data.outcome]
        if stop.status == outcome:
            return stop
        if stop.completed_at is not None:
            raise _conflict(
                "STOP_ALREADY_COMPLETED",
                f"Stop {stop.sequence} is already closed as {stop.status.value}.",
                server_state=_stop_state(stop),
            )
        trip = stop.driver_trip
        _require_active(trip)
        if outcome == DeliveryStopStatus.FAILED and not (data.reason or "").strip():
            raise _invalid("REASON_REQUIRED", "Say why the delivery could not be made.")

        run, run_stops = _stop_context(db, trip)
        run_stop = run_stops.get(stop.sequence)
        if data.delivered_units:
            planned = (
                {row.order.order_number: row.units for row in _rows(run_stop, run.current_plan_version)}
                if run is not None and run_stop is not None
                else {}
            )
            for number, units in data.delivered_units.items():
                if units < 0 or (number in planned and planned[number] is not None and units > planned[number]):
                    raise _invalid("INVALID_UNITS", f"{number}: delivered units must be between 0 and the planned amount.")

        at = _when(data.client_timestamp, now)
        if stop.arrived_at is None:
            stop.arrived_at = at
        stop.status = outcome
        stop.notes = _outcome_note(outcome, data, run, run_stop)
        if outcome == DeliveryStopStatus.FAILED:
            # Nothing to sign for: a failed stop closes straight away.
            stop.completed_at = at
            db.add(
                IssueReport(
                    driver_trip_id=trip.id,
                    stop_id=stop.id,
                    issue_type=_failure_issue_type(data.reason),
                    description=f"Stop {stop.sequence} {stop.customer_name}: not delivered. {stop.notes or ''}".strip(),
                )
            )
            _log(trip, "Not delivered", f"Stop {stop.sequence} · {stop.customer_name} · {data.reason}", now, "warning")
        elif outcome == DeliveryStopStatus.PARTIAL:
            db.add(
                IssueReport(
                    driver_trip_id=trip.id,
                    stop_id=stop.id,
                    issue_type=IssueType.OTHER,
                    description=f"Stop {stop.sequence} {stop.customer_name}: partial delivery. {stop.notes or ''}".strip(),
                )
            )
            _log(trip, "Partly delivered", f"Stop {stop.sequence} · {stop.customer_name}", now, "warning")
        else:
            _log(trip, "Delivered", f"Stop {stop.sequence} · {stop.customer_name}", now)
        _sync_progress(trip, now)
        db.commit()

        if outcome in DELIVERED_OUTCOMES:
            for order in _orders_on_truck(run, run_stop):
                _advance_order(db, order.id, OrderStatus.DELIVERED)
        db.refresh(stop)
        return stop

    @staticmethod
    def submit_pod(db: Session, user: User, stop_id: int, data: PodIn) -> DeliveryStop:
        now = _now()
        stop = _stop(db, user, stop_id)
        _require_not_removed(stop)
        if stop.pod is not None:
            return stop
        if stop.status not in DELIVERED_OUTCOMES:
            raise _conflict(
                "OUTCOME_REQUIRED",
                "Record the delivery as full or partial before adding proof of delivery.",
                server_state=_stop_state(stop),
            )
        trip = stop.driver_trip
        _require_active(trip)
        signature = _check_evidence(data.signature_data, MAX_SIGNATURE_CHARS, "The signature")
        photo = _check_evidence(data.photo_url, MAX_PHOTO_CHARS, "The photo")
        if not signature and not photo:
            raise _invalid("EVIDENCE_REQUIRED", "Add the recipient's signature or a photo of the delivered goods.")
        at = _when(data.client_timestamp, now)
        db.add(
            ProofOfDelivery(
                stop_id=stop.id,
                recipient_name=data.recipient_name.strip(),
                signature_data=signature,
                photo_url=photo,
                notes=data.notes,
                created_at=at,
            )
        )
        stop.completed_at = at
        _log(trip, "Proof of delivery", f"Stop {stop.sequence} · signed by {data.recipient_name.strip()}", now)
        db.flush()
        db.refresh(stop)
        _sync_progress(trip, now)
        db.commit()
        db.refresh(stop)
        return stop

    @staticmethod
    def complete_stop(db: Session, user: User, stop_id: int, at: Optional[datetime] = None) -> DeliveryStop:
        now = _now()
        stop = _stop(db, user, stop_id)
        if stop.completed_at is not None:
            return stop
        _require_not_removed(stop)
        if stop.status in DELIVERED_OUTCOMES and stop.pod is None:
            raise _conflict("POD_REQUIRED", "Add proof of delivery before closing this stop.")
        if stop.status not in DONE_OUTCOMES:
            raise _conflict("OUTCOME_REQUIRED", "Record what happened at this stop first.")
        trip = stop.driver_trip
        _require_active(trip)
        stop.completed_at = _when(at, now)
        _sync_progress(trip, now)
        db.commit()
        db.refresh(stop)
        return stop

    # ---- End of trip ------------------------------------------------------------

    @staticmethod
    def complete_trip(db: Session, user: User, trip_id: int, at: Optional[datetime] = None) -> DriverTrip:
        now = _now()
        trip = _trip(db, user, trip_id)
        if trip.status == DriverTripStatus.COMPLETED:
            return trip
        _require_active(trip)
        open_stops = sorted(stop.sequence for stop in trip.stops if not _is_done(stop))
        if open_stops:
            raise _conflict(
                "STOPS_OPEN",
                f"Finish stop {open_stops[0]} first ({len(open_stops)} still open).",
                open_stops=open_stops,
            )
        trip.status = DriverTripStatus.COMPLETED
        trip.completed_at = _when(at, now)
        _sync_progress(trip, now)
        if trip.dispatch_trip is not None:
            trip.dispatch_trip.status = "completed"
        counts = _counts(trip.stops)
        _log(
            trip,
            "Trip complete",
            f"{counts['delivered']} delivered · {counts['partial']} partial · {counts['failed']} not delivered",
            now,
        )
        db.commit()
        db.refresh(trip)
        return trip

    @staticmethod
    def check_in(db: Session, user: User, trip_id: int, at: Optional[datetime] = None) -> DriverTrip:
        """Back at the depot. Closes the trip first if every stop is done."""
        now = _now()
        trip = _trip(db, user, trip_id)
        if trip.status != DriverTripStatus.COMPLETED:
            trip = DriverService.complete_trip(db, user, trip_id, at)
        dispatch_trip = trip.dispatch_trip
        if dispatch_trip is not None and dispatch_trip.actual_arrival is None:
            dispatch_trip.actual_arrival = _when(at, now)
            _log(trip, "Back at depot", f"{user.full_name} checked in", now)
            db.commit()
            db.refresh(trip)
        return trip

    # ---- Problems -----------------------------------------------------------------

    @staticmethod
    def report_issue(db: Session, user: User, trip_id: int, data: IssueIn) -> IssueReport:
        now = _now()
        trip = _trip(db, user, trip_id)
        if data.stop_id is not None and not any(stop.id == data.stop_id for stop in trip.stops):
            raise _invalid("STOP_NOT_ON_TRIP", "That stop is not on this trip.")
        photo = _check_evidence(data.photo_url, MAX_PHOTO_CHARS, "The photo")
        description = data.description.strip()
        if data.category:
            description = f"[{data.category.strip()}] {description}"
        issue = IssueReport(
            driver_trip_id=trip.id,
            stop_id=data.stop_id,
            issue_type=data.issue_type,
            description=description,
            photo_url=photo,
            created_at=_when(data.client_timestamp, now),
        )
        db.add(issue)
        _log(trip, "Driver reported a problem", description[:120], now, "warning")
        db.commit()
        db.refresh(issue)
        return issue

    @staticmethod
    def list_issues(db: Session, user: User, trip_id: int) -> List[IssueReport]:
        trip = _trip(db, user, trip_id)
        return sorted(trip.issues, key=lambda issue: issue.created_at or datetime.min)

    @staticmethod
    def trigger_sos(db: Session, user: User, data: SOSAlertCreate, at: Optional[datetime] = None) -> SOSAlert:
        now = _now()
        trip = _trip(db, user, data.driver_trip_id) if data.driver_trip_id is not None else None
        alert = SOSAlert(
            driver_id=user.id,
            driver_trip_id=trip.id if trip else None,
            latitude=data.latitude,
            longitude=data.longitude,
            message=data.message,
            triggered_at=_when(at, now),
        )
        db.add(alert)
        if trip is not None:
            # "warning", not "error": the dispatcher reads "error" events as loading shortfalls.
            _log(trip, "SOS", (data.message or "Emergency alert")[:120], now, "warning")
        db.commit()
        db.refresh(alert)
        return alert

    @staticmethod
    def get_sos(db: Session, user: User, alert_id: int) -> SOSAlert:
        alert = db.get(SOSAlert, alert_id)
        if alert is None or alert.driver_id != user.id:
            raise _not_found("SOS_NOT_FOUND", "SOS alert not found.")
        return alert

    # ---- Ready for tomorrow -------------------------------------------------------

    @staticmethod
    def availability(db: Session, user: User, local_now: datetime) -> Dict[str, Any]:
        day = calendar_service.get_next_operating_day(db, local_now.date())
        try:
            row = (
                db.execute(
                    select(DriverAvailability).where(
                        DriverAvailability.driver_id == user.id, DriverAvailability.for_date == day
                    )
                )
                .scalars()
                .first()
            )
        except (ProgrammingError, OperationalError):
            db.rollback()
            raise _error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "AVAILABILITY_NOT_READY",
                "Availability isn't set up on this database yet (migration 0006_driver_availability).",
            )
        return {"for_date": day, "confirmed": row is not None, "confirmed_at": _aware(row.confirmed_at) if row else None}

    @staticmethod
    def confirm_availability(
        db: Session, user: User, local_now: datetime, at: Optional[datetime] = None
    ) -> Dict[str, Any]:
        current = DriverService.availability(db, user, local_now)
        if current["confirmed"]:
            return current
        row = DriverAvailability(driver_id=user.id, for_date=current["for_date"], confirmed_at=_when(at, _now()))
        db.add(row)
        db.commit()
        return {"for_date": row.for_date, "confirmed": True, "confirmed_at": _aware(row.confirmed_at)}

    # ---- Offline sync and conflicts ----------------------------------------------

    @staticmethod
    def process_sync(db: Session, user: User, actions: List[SyncAction], local_now: datetime) -> Dict[str, Any]:
        """Apply queued offline actions in the order they were recorded.

        Each action is reported on its own: applied, conflict (409: the server's
        state disagrees, e.g. dispatch removed the stop) or failed. Writes are
        idempotent, so an action that already landed answers "applied" again.
        """
        results = []
        for action in actions:
            try:
                DriverService._apply(db, user, action, local_now)
                results.append({"action_id": action.action_id, "status": "applied"})
            except HTTPException as exc:
                _discard_pending(db)
                detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
                server_state = detail.get("server_state")
                if server_state is None and action.stop_id is not None:
                    stop = db.get(DeliveryStop, action.stop_id)
                    if stop is not None and stop.driver_trip.driver_id == user.id:
                        server_state = _stop_state(stop)
                results.append(
                    {
                        "action_id": action.action_id,
                        "status": "conflict" if exc.status_code == status.HTTP_409_CONFLICT else "failed",
                        "code": detail.get("code"),
                        "message": detail.get("message"),
                        "server_state": server_state,
                    }
                )
            except ValidationError as exc:
                _discard_pending(db)
                results.append(
                    {
                        "action_id": action.action_id,
                        "status": "failed",
                        "code": "INVALID_PAYLOAD",
                        "message": exc.errors()[0].get("msg", "Invalid record") if exc.errors() else "Invalid record",
                    }
                )
            except WaypointLogisticsError as exc:
                _discard_pending(db)
                results.append(
                    {"action_id": action.action_id, "status": "failed", "code": exc.code, "message": exc.message}
                )
        applied = sum(1 for result in results if result["status"] == "applied")
        return {"processed_count": applied, "results": results}

    @staticmethod
    def _apply(db: Session, user: User, action: SyncAction, local_now: datetime) -> None:
        payload = {**action.payload, "client_timestamp": action.client_timestamp}
        kind = action.action_type
        if kind == "arrive":
            DriverService.arrive(db, user, action.stop_id, action.client_timestamp)
        elif kind == "outcome":
            DriverService.record_outcome(db, user, action.stop_id, OutcomeIn(**payload))
        elif kind == "pod":
            DriverService.submit_pod(db, user, action.stop_id, PodIn(**payload))
        elif kind == "complete_stop":
            DriverService.complete_stop(db, user, action.stop_id, action.client_timestamp)
        elif kind == "issue":
            DriverService.report_issue(db, user, action.trip_id, IssueIn(**payload))
        elif kind == "complete_trip":
            DriverService.complete_trip(db, user, action.trip_id, action.client_timestamp)
        elif kind == "checkin":
            DriverService.check_in(db, user, action.trip_id, action.client_timestamp)
        elif kind == "sos":
            DriverService.trigger_sos(db, user, SOSAlertCreate(**action.payload), action.client_timestamp)
        elif kind == "ready_tomorrow":
            DriverService.confirm_availability(db, user, local_now, action.client_timestamp)

    @staticmethod
    def resolve_conflict(db: Session, user: User, stop_id: int, data: ResolveIn) -> DeliveryStop:
        """The driver's answer to a stop dispatch removed while their record was offline.

        keep_record: the delivery happened, so the driver's record stands and dispatch
        is told. flag_review: the stop stays removed and dispatch decides.
        """
        now = _now()
        stop = _stop(db, user, stop_id)
        if stop.status != DeliveryStopStatus.RESCHEDULED:
            return stop
        trip = stop.driver_trip
        removed_because = stop.notes or "removed by dispatch"
        record = data.record

        if data.resolution == "flag_review":
            summary = f"recorded {record.outcome}" if record and record.outcome else "has an offline record"
            db.add(
                IssueReport(
                    driver_trip_id=trip.id,
                    stop_id=stop.id,
                    issue_type=IssueType.OTHER,
                    description=(
                        f"Sync conflict at stop {stop.sequence} {stop.customer_name}: the driver {summary}, "
                        f"but dispatch had removed the stop ({removed_because}). Needs dispatcher review."
                    ),
                )
            )
            _log(trip, "Conflict sent for review", f"Stop {stop.sequence} · {stop.customer_name}", now, "warning")
            db.commit()
            db.refresh(stop)
            return stop

        if record is None or record.outcome is None:
            raise _invalid("RECORD_REQUIRED", "Send the offline record to keep it.")
        outcome = OUTCOMES[record.outcome]
        if outcome == DeliveryStopStatus.FAILED and not (record.reason or "").strip():
            raise _invalid("REASON_REQUIRED", "Say why the delivery could not be made.")
        arrived = _when(record.arrived_at, now)
        stop.status = outcome
        stop.arrived_at = arrived
        kept = f"Kept the driver's record over a dispatch change ({removed_because})."
        stop.notes = f"{kept} Reason: {record.reason.strip()}" if record.reason else kept
        if record.pod is not None and outcome in DELIVERED_OUTCOMES:
            signature = _check_evidence(record.pod.signature_data, MAX_SIGNATURE_CHARS, "The signature")
            photo = _check_evidence(record.pod.photo_url, MAX_PHOTO_CHARS, "The photo")
            if stop.pod is None and (signature or photo):
                db.add(
                    ProofOfDelivery(
                        stop_id=stop.id,
                        recipient_name=record.pod.recipient_name.strip(),
                        signature_data=signature,
                        photo_url=photo,
                        notes=record.pod.notes,
                        created_at=_when(record.pod.client_timestamp, now),
                    )
                )
                stop.completed_at = _when(record.completed_at or record.pod.client_timestamp, now)
        if outcome == DeliveryStopStatus.FAILED:
            stop.completed_at = _when(record.completed_at, now)
        db.add(
            IssueReport(
                driver_trip_id=trip.id,
                stop_id=stop.id,
                issue_type=IssueType.OTHER,
                description=(
                    f"Sync conflict at stop {stop.sequence} {stop.customer_name}: the driver kept their "
                    f"{record.outcome} record although dispatch had removed the stop ({removed_because})."
                ),
            )
        )
        _log(trip, "Driver kept their record", f"Stop {stop.sequence} · {stop.customer_name}", now, "warning")
        _sync_progress(trip, now)
        db.commit()

        if outcome in DELIVERED_OUTCOMES:
            run, run_stops = _stop_context(db, trip)
            for order in _orders_on_truck(run, run_stops.get(stop.sequence)):
                _advance_order(db, order.id, OrderStatus.DELIVERED)
        db.refresh(stop)
        return stop

    # ---- Dispatcher-side --------------------------------------------------------------

    @staticmethod
    def monitor(db: Session, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Trips on the road (and finished in the last 18 hours), for the dispatcher."""
        now = now or _now()
        trips = db.execute(select(DriverTrip).where(DriverTrip.status != DriverTripStatus.ASSIGNED)).scalars()
        rows = []
        for trip in trips:
            if trip.status == DriverTripStatus.COMPLETED and trip.completed_at and trip.completed_at < now - COMPLETED_VISIBLE_FOR:
                continue
            dispatch_trip = trip.dispatch_trip
            open_issues = db.execute(
                select(func.count(IssueReport.id)).where(
                    IssueReport.driver_trip_id == trip.id, IssueReport.status == IssueStatus.OPEN
                )
            ).scalar_one()
            open_sos = db.execute(
                select(func.count(SOSAlert.id)).where(
                    SOSAlert.driver_trip_id == trip.id, SOSAlert.status == SOSStatus.TRIGGERED
                )
            ).scalar_one()
            rows.append(
                {
                    "trip_id": trip.id,
                    "run_code": dispatch_trip.trip_code if dispatch_trip else f"TRIP-{trip.id}",
                    "driver_name": trip.driver.full_name if trip.driver else "Unknown",
                    "vehicle_code": dispatch_trip.vehicle_number if dispatch_trip else None,
                    "status": trip.status.value,
                    "stops_done": sum(1 for stop in trip.stops if _is_done(stop)),
                    "stop_count": len(trip.stops),
                    "last_update": _aware(dispatch_trip.updated_at) if dispatch_trip else None,
                    "open_issues": open_issues,
                    "open_sos": open_sos,
                }
            )
        return rows

    @staticmethod
    def dev_defer_stop(db: Session, run_code: str, sequence: int, reason: str) -> DriverTrip:
        """Dev only: dispatch removes a stop after departure, to rehearse a sync conflict."""
        now = _now()
        run = _run_by_code(db, run_code)
        trip = _trip_for_run(db, run)
        if trip is None:
            raise _conflict("RUN_NOT_STARTED", f"{run.code} hasn't left the gate yet.")
        stop = next((item for item in trip.stops if item.sequence == sequence), None)
        if stop is None:
            raise _not_found("STOP_NOT_FOUND", f"{run.code} has no stop {sequence}.")
        if stop.status == DeliveryStopStatus.RESCHEDULED:
            return trip
        if stop.completed_at is not None:
            raise _conflict("STOP_ALREADY_DONE", f"Stop {sequence} is already finished.")
        stop.status = DeliveryStopStatus.RESCHEDULED
        stop.notes = f"Deferred by Dispatcher at {_hhmm(now)}: {reason.strip()}"
        _log(trip, "Stop deferred by dispatcher", f"Stop {sequence} · {stop.customer_name} · {reason.strip()}", now, "warning")
        _sync_progress(trip, now)
        db.commit()
        db.refresh(trip)
        return trip


driver_service = DriverService()
