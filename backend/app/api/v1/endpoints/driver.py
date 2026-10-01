"""Driver API (/api/v1/driver).

The driver collects the run the loader released, records every stop, and syncs
what was recorded offline. Business rules live in app/services/driver_service.py.
"""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.models.user import User
from app.schemas.driver import (
    ArrivalIn,
    AvailabilityRead,
    DeferIn,
    DriverMe,
    DriverStop,
    DriverTripView,
    IssueIn,
    IssueReportRead,
    MonitorRow,
    OutcomeIn,
    PodIn,
    ResolveIn,
    RunCard,
    RunSheet,
    SOSAlertCreate,
    SOSAlertRead,
    SyncAction,
    SyncResult,
    TimestampIn,
)
from app.services.driver_service import driver_service

router = APIRouter()


# ---- Profile and trips ---------------------------------------------------------

@router.get("/me", response_model=DriverMe)
def read_current_driver(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """The signed-in driver with their assigned vehicle and depot."""
    return driver_service.me(db, current_user)


@router.get("/runs", response_model=List[RunCard])
def list_runs(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """The driver's open trips (being loaded, ready to collect, on the road) and
    ones finished in the last 18 hours."""
    return driver_service.list_runs(db, current_user)


@router.get("/runs/{code}", response_model=RunSheet)
def get_run_sheet(
    code: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """The run sheet before departure: stops in order, windows, docks, what each gets."""
    return driver_service.run_sheet(db, current_user, code)


@router.post("/runs/{code}/start", response_model=DriverTripView)
def start_run(
    code: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Collect a released run (gate-out). Repeating it returns the same trip."""
    trip = driver_service.start_run(db, current_user, code)
    return driver_service.trip_view(db, trip)


@router.get("/trips/{trip_id}", response_model=DriverTripView)
def get_trip(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    return driver_service.trip_view(db, driver_service.trip(db, current_user, trip_id))


@router.post("/trips/{trip_id}/start", response_model=DriverTripView)
def start_trip(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Start or resume a trip by id."""
    trip = driver_service.start_trip(db, current_user, trip_id)
    return driver_service.trip_view(db, trip)


@router.post("/trips/{trip_id}/complete", response_model=DriverTripView)
def complete_trip(
    trip_id: int,
    body: TimestampIn = TimestampIn(),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    trip = driver_service.complete_trip(db, current_user, trip_id, body.client_timestamp)
    return driver_service.trip_view(db, trip)


@router.post("/trips/{trip_id}/checkin", response_model=DriverTripView)
def depot_checkin(
    trip_id: int,
    body: TimestampIn = TimestampIn(),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Back at the depot."""
    trip = driver_service.check_in(db, current_user, trip_id, body.client_timestamp)
    return driver_service.trip_view(db, trip)


# ---- Stops ---------------------------------------------------------------------

@router.patch("/stops/{stop_id}/arrive", response_model=DriverStop)
def record_arrival(
    stop_id: int,
    body: ArrivalIn = ArrivalIn(),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    stop = driver_service.arrive(db, current_user, stop_id, body.client_timestamp)
    return driver_service.stop_view(db, stop)


@router.patch("/stops/{stop_id}/outcome", response_model=DriverStop)
def record_outcome(
    stop_id: int,
    body: OutcomeIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Delivered, partial (with units per order) or failed (with a reason)."""
    stop = driver_service.record_outcome(db, current_user, stop_id, body)
    return driver_service.stop_view(db, stop)


@router.post("/stops/{stop_id}/pod", response_model=DriverStop)
def submit_pod(
    stop_id: int,
    body: PodIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Proof of delivery: recipient plus signature and/or photo. Closes the stop."""
    stop = driver_service.submit_pod(db, current_user, stop_id, body)
    return driver_service.stop_view(db, stop)


@router.post("/stops/{stop_id}/complete", response_model=DriverStop)
def complete_stop(
    stop_id: int,
    body: TimestampIn = TimestampIn(),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    stop = driver_service.complete_stop(db, current_user, stop_id, body.client_timestamp)
    return driver_service.stop_view(db, stop)


@router.post("/stops/{stop_id}/resolve", response_model=DriverStop)
def resolve_conflict(
    stop_id: int,
    body: ResolveIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    """Answer a sync conflict: keep the offline record, or send it to the dispatcher."""
    stop = driver_service.resolve_conflict(db, current_user, stop_id, body)
    return driver_service.stop_view(db, stop)


# ---- Problems ------------------------------------------------------------------

@router.post("/trips/{trip_id}/issues", response_model=IssueReportRead)
def report_issue(
    trip_id: int,
    body: IssueIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    return driver_service.report_issue(db, current_user, trip_id, body)


@router.get("/trips/{trip_id}/issues", response_model=List[IssueReportRead])
def list_issues(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    return driver_service.list_issues(db, current_user, trip_id)


@router.post("/sos", response_model=SOSAlertRead)
def trigger_sos(
    body: SOSAlertCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    return driver_service.trigger_sos(db, current_user, body)


@router.get("/sos/{alert_id}", response_model=SOSAlertRead)
def get_sos(
    alert_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
):
    return driver_service.get_sos(db, current_user, alert_id)


# ---- Offline sync -----------------------------------------------------------------

@router.post("/sync", response_model=SyncResult)
def process_sync(
    actions: List[SyncAction],
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
    now: datetime = Depends(deps.get_now),
):
    """Apply records made offline, in the order they were made. Each action is
    reported as applied, conflict or failed; replays are safe."""
    return driver_service.process_sync(db, current_user, actions, now)


# ---- Ready for tomorrow ------------------------------------------------------------

@router.get("/ready-tomorrow", response_model=AvailabilityRead)
def get_availability(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
    now: datetime = Depends(deps.get_now),
):
    """Whether the driver has confirmed for the next operating day."""
    return driver_service.availability(db, current_user, now)


@router.post("/ready-tomorrow", response_model=AvailabilityRead)
def confirm_availability(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
    now: datetime = Depends(deps.get_now),
):
    """Tell dispatch the driver can take a run on the next operating day."""
    return driver_service.confirm_availability(db, current_user, now)


# ---- Dispatcher view -------------------------------------------------------------

@router.get("/monitor", response_model=List[MonitorRow])
def monitor(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_dispatcher_or_admin),
):
    """Driver trips on the road (and finished today), with open issues and SOS."""
    return driver_service.monitor(db)


# ---- Dev only ----------------------------------------------------------------------
# Simulates the dispatcher removing a stop after departure, to rehearse a sync
# conflict. Never mounted in production (same rule as /loader/dev).

dev_router = APIRouter(prefix="/dev", tags=["Driver · dev only"])


@dev_router.post("/runs/{code}/stops/{sequence}/defer", response_model=DriverTripView)
def dev_defer_stop(
    code: str,
    sequence: int,
    body: DeferIn = DeferIn(),
    db: Session = Depends(deps.get_db),
):
    trip = driver_service.dev_defer_stop(db, code, sequence, body.reason)
    return driver_service.trip_view(db, trip)


if settings.ENVIRONMENT != "production":
    router.include_router(dev_router)
