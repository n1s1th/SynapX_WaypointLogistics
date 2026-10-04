import os
import uuid
from datetime import date, datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, status, UploadFile, File, HTTPException, Query
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.schemas.auth import UserRead
from app.schemas.driver import (
    DriverTripSummary, DriverTripDetail, DeliveryStopRead, DeliveryStopDetail, ProofOfDeliveryCreate, ProofOfDeliveryRead,
    DriverProfileRead, DriverProfileUpdate, DriverReadyRead, DriverAvailabilityRead,
)
from app.services import driver_service
from app.models.driver import DeliveryStopStatus
from pydantic import BaseModel

router = APIRouter()

# --- Group A: Profile & Trips ---

@router.get("/me", response_model=UserRead)
def read_current_driver(current_user: User = Depends(deps.require_driver)):
    """Returns current driver profile."""
    return current_user

@router.get("/profile", response_model=DriverProfileRead)
def read_driver_profile(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Phone, licence and vehicle. `complete` stays false until the driver saves
    phone and licence: dispatch can't assign the driver before that."""
    return driver_service.get_profile(db, current_user.id)

@router.put("/profile", response_model=DriverProfileRead)
def update_driver_profile(
    profile_in: DriverProfileUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Saves the driver's phone and licence type. The vehicle is set by the depot."""
    return driver_service.update_profile(db, current_user.id, profile_in.phone, profile_in.license_type)

@router.get("/ready-tomorrow", response_model=DriverReadyRead)
def read_ready_tomorrow(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
    now: datetime = Depends(deps.get_now),
):
    """Whether the driver said they can take a run on the next working day."""
    return driver_service.get_ready_tomorrow(db, current_user.id, now)

@router.post("/ready-tomorrow", response_model=DriverReadyRead)
def confirm_ready_tomorrow(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver),
    now: datetime = Depends(deps.get_now),
):
    """The driver taps I'm ready: available for a run on the next working day.
    Closes at 4 PM; tapping again changes nothing."""
    return driver_service.confirm_ready_tomorrow(db, current_user.id, now)

@router.get("/availability", response_model=List[DriverAvailabilityRead])
def list_driver_availability(
    day: Optional[date] = Query(None, alias="date", description="YYYY-MM-DD; default the next working day"),
    db: Session = Depends(deps.get_db),
    _user: User = Depends(deps.require_dispatcher_or_admin),
    now: datetime = Depends(deps.get_now),
):
    """For the dispatcher: drivers who said they're ready for a day."""
    return driver_service.list_available_drivers(db, day or driver_service.ready_day(db, now))

@router.get("/trips/today", response_model=List[DriverTripSummary])
def get_today_trips(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Returns list of DriverTrip records for today."""
    return driver_service.get_today_trips(db, current_user.id)

@router.get("/trips/{trip_id}", response_model=DriverTripDetail)
def get_trip_detail(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Returns single DriverTrip with full stop list."""
    return driver_service.get_trip_view(db, trip_id, current_user.id)


# --- Group B: Trip Actions ---

@router.post("/trips/{trip_id}/start", response_model=DriverTripSummary)
def start_trip(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Sets DriverTrip.status = "started", started_at = now()"""
    return driver_service.start_trip(db, trip_id, current_user.id)

@router.get("/stops/{stop_id}", response_model=DeliveryStopDetail)
def get_stop_detail(
    stop_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Returns a stop with the order (items, window, temperature) delivered there."""
    return driver_service.get_stop_detail(db, stop_id, current_user.id)


@router.patch("/stops/{stop_id}/arrive", response_model=DeliveryStopRead)
def record_arrival(
    stop_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Sets DeliveryStop.status = "arrived", arrived_at = now()"""
    return driver_service.record_arrival(db, stop_id, current_user.id)


class OutcomeUpdate(BaseModel):
    outcome: DeliveryStopStatus

@router.patch("/stops/{stop_id}/outcome", response_model=DeliveryStopRead)
def record_outcome(
    stop_id: int,
    outcome_data: OutcomeUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Sets DeliveryStop.status to outcome value."""
    return driver_service.record_outcome(db, stop_id, outcome_data.outcome, current_user.id)


@router.post("/stops/{stop_id}/pod", response_model=ProofOfDeliveryRead)
def submit_pod(
    stop_id: int,
    pod_in: ProofOfDeliveryCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Creates ProofOfDelivery record and completes stop if needed."""
    return driver_service.submit_pod(db, stop_id, pod_in.model_dump(), current_user.id)


@router.post("/stops/{stop_id}/complete", response_model=DeliveryStopRead)
def complete_stop(
    stop_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Sets stop.completed_at = now()"""
    return driver_service.complete_stop(db, stop_id, current_user.id)


@router.post("/trips/{trip_id}/complete", response_model=DriverTripSummary)
def complete_trip(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Sets DriverTrip.status = "completed", completed_at = now()"""
    return driver_service.complete_trip(db, trip_id, current_user.id)


# --- Group C: Issue Reporting ---
from app.schemas.driver import IssueReportCreate, IssueReportRead


# --- Photo Upload ---
UPLOAD_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "static", "uploads")
)
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

@router.post("/upload/photo")
async def upload_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(deps.require_driver)
):
    """Accepts a multipart image upload, saves to disk, returns its public URL."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    save_path = os.path.join(UPLOAD_DIR, filename)

    with open(save_path, "wb") as f:
        f.write(contents)

    return {"photo_url": f"/static/uploads/{filename}"}

@router.post("/trips/{trip_id}/issues", response_model=IssueReportRead)
def report_issue(
    trip_id: int,
    issue_in: IssueReportCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Creates IssueReport linked to driver_trip (and optionally stop)."""
    return driver_service.report_issue(db, trip_id, issue_in.model_dump(), current_user.id)


@router.get("/trips/{trip_id}/issues", response_model=List[IssueReportRead])
def get_trip_issues(
    trip_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Lists all issues for a trip."""
    return driver_service.get_trip_issues(db, trip_id, current_user.id)


# --- Group E: SOS Emergency ---
from app.schemas.driver import SOSAlertCreate, SOSAlertRead

@router.post("/sos", response_model=SOSAlertRead)
def trigger_sos(
    sos_in: SOSAlertCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Creates SOSAlert record."""
    return driver_service.trigger_sos(db, current_user.id, sos_in.model_dump())


@router.get("/sos/{alert_id}", response_model=SOSAlertRead)
def get_sos(
    alert_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Check SOS alert status."""
    return driver_service.get_sos(db, alert_id, current_user.id)


# --- Group F: Depot Check-in ---
class DepotCheckin(BaseModel):
    trip_id: int
    notes: str = None

@router.post("/depot/checkin", response_model=DriverTripSummary)
def depot_checkin(
    checkin_data: DepotCheckin,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Marks driver as returned to depot, sets DriverTrip completed if not already."""
    return driver_service.depot_checkin(db, checkin_data.trip_id, current_user.id)


# --- Group D: Offline Sync ---
from app.schemas.driver import SyncAction, SyncResult

@router.post("/sync", response_model=SyncResult)
def process_sync(
    actions: List[SyncAction],
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_driver)
):
    """Batch processes offline actions and returns conflicts."""
    return driver_service.process_sync_batch(db, actions, current_user.id)
