"""Driver API shapes.

Datetimes leave the API as UTC ("…Z"); the phone shows them in Colombo time.
Window times (window_start / window_end) are Colombo wall-clock "HH:MM", as in
outlets.csv.
"""
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.driver import IssueStatus, IssueType, SOSStatus

StopOutcome = Literal["delivered", "partial", "failed"]
RunState = Literal["being_loaded", "ready", "in_progress", "completed"]
SyncActionType = Literal[
    "arrive", "outcome", "pod", "complete_stop", "issue", "complete_trip", "checkin", "sos", "ready_tomorrow",
]


# ---- Shared pieces -----------------------------------------------------------

class VehicleRef(BaseModel):
    code: str
    type: str
    temperature_mode: str
    depot: Optional[str] = None


class PlaceRef(BaseModel):
    name: str
    latitude: float
    longitude: float


class OutletRef(BaseModel):
    code: str
    name: str
    district: str
    brand: str
    dock_type: str
    van_only: bool
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class RunRef(BaseModel):
    code: str
    trip_number: int
    brand: str
    district: str
    wave: Optional[str] = None
    departs_at: Optional[datetime] = None
    plan_version: int


# ---- Profile and run list ----------------------------------------------------

class DriverMe(BaseModel):
    id: int
    full_name: str
    email: str
    role: str
    driver_code: str
    phone: Optional[str] = None
    license_type: Optional[str] = None
    vehicle: Optional[VehicleRef] = None
    depot: Optional[PlaceRef] = None


class RunCard(BaseModel):
    """One trip on the driver's home screen."""

    code: str
    trip_id: Optional[int] = None
    trip_number: int = 1
    brand: Optional[str] = None
    district: Optional[str] = None
    wave: Optional[str] = None
    departs_at: Optional[datetime] = None
    depot: Optional[str] = None
    loader_status: Optional[str] = None
    state: RunState
    stop_count: int = 0
    stops_done: int = 0
    has_chilled: bool = False
    checked_in: bool = False
    vehicle: Optional[VehicleRef] = None


# ---- Trip and stops ----------------------------------------------------------

class StopOrder(BaseModel):
    order_number: str
    temperature: str
    units: Optional[int] = None
    weight_kg: Optional[float] = None
    volume_m3: Optional[float] = None
    on_truck: bool
    loader_state: Optional[str] = None


class PodSummary(BaseModel):
    recipient_name: str
    has_signature: bool
    has_photo: bool
    created_at: datetime


class StopTiming(BaseModel):
    """Arrival against the outlet's window (brief p15): an early vehicle waits
    for the window to open; arriving after it closes is late."""

    status: Literal["early", "on_time", "late"]
    minutes: int = 0


class DriverStop(BaseModel):
    id: int
    sequence: int
    status: str
    name: str
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_approximate: bool = True
    outlet: Optional[OutletRef] = None
    eta: Optional[datetime] = None
    handling_minutes: Optional[int] = None
    departed_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    timing: Optional[StopTiming] = None
    orders: List[StopOrder] = []
    note: Optional[str] = None
    removed_reason: Optional[str] = None
    pod: Optional[PodSummary] = None


class TripCounts(BaseModel):
    total: int
    done: int
    delivered: int
    partial: int
    failed: int
    removed: int
    pod: int


class SheetStop(BaseModel):
    """A stop on the run sheet, before the trip starts."""

    sequence: int
    name: str
    outlet: Optional[OutletRef] = None
    eta: Optional[datetime] = None
    handling_minutes: Optional[int] = None
    latitude: float
    longitude: float
    location_approximate: bool = True
    orders: List[StopOrder] = []


class RunSheet(BaseModel):
    """The digital run sheet: what the driver will carry and where, before departure."""

    code: str
    state: RunState
    trip_id: Optional[int] = None
    loader_status: str
    released_at: Optional[datetime] = None
    run: RunRef
    vehicle: Optional[VehicleRef] = None
    depot: PlaceRef
    stops: List[SheetStop]


class DriverTripView(BaseModel):
    id: int
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    checked_in_at: Optional[datetime] = None
    run: Optional[RunRef] = None
    vehicle: Optional[VehicleRef] = None
    depot: Optional[PlaceRef] = None
    stops: List[DriverStop]
    counts: TripCounts
    open_issues: int = 0


# ---- Writes ------------------------------------------------------------------

class TimestampIn(BaseModel):
    """When the driver actually did it. Offline records carry the tap time."""

    client_timestamp: Optional[datetime] = None


class ArrivalIn(TimestampIn):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class OutcomeIn(TimestampIn):
    outcome: StopOutcome
    reason: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=500)
    # Partial deliveries: units actually handed over, per order number.
    delivered_units: Dict[str, int] = {}


class PodIn(TimestampIn):
    recipient_name: str = Field(min_length=1, max_length=255)
    signature_data: Optional[str] = None
    photo_url: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class IssueIn(TimestampIn):
    issue_type: IssueType
    category: Optional[str] = Field(default=None, max_length=60)
    description: str = Field(min_length=1, max_length=1800)
    stop_id: Optional[int] = None
    photo_url: Optional[str] = None


class IssueReportRead(BaseModel):
    id: int
    driver_trip_id: int
    stop_id: Optional[int] = None
    issue_type: IssueType
    description: str
    status: IssueStatus
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SOSAlertCreate(BaseModel):
    driver_trip_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    message: Optional[str] = Field(default=None, max_length=500)


class SOSAlertRead(BaseModel):
    id: int
    driver_id: int
    driver_trip_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    message: Optional[str] = None
    status: SOSStatus
    triggered_at: datetime
    acknowledged_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ---- Offline sync ------------------------------------------------------------

class SyncAction(BaseModel):
    action_id: str = Field(min_length=1, max_length=64)
    action_type: SyncActionType
    stop_id: Optional[int] = None
    trip_id: Optional[int] = None
    payload: Dict[str, Any] = {}
    client_timestamp: datetime


class SyncActionResult(BaseModel):
    action_id: str
    status: Literal["applied", "conflict", "failed"]
    code: Optional[str] = None
    message: Optional[str] = None
    server_state: Optional[Dict[str, Any]] = None


class SyncResult(BaseModel):
    processed_count: int
    results: List[SyncActionResult]


class ConflictRecord(BaseModel):
    """What the driver recorded offline for a stop the plan has since removed."""

    outcome: Optional[StopOutcome] = None
    reason: Optional[str] = Field(default=None, max_length=300)
    arrived_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    pod: Optional[PodIn] = None


class ResolveIn(BaseModel):
    resolution: Literal["keep_record", "flag_review"]
    record: Optional[ConflictRecord] = None


class DeferIn(BaseModel):
    reason: str = Field(default="Store asked to move the delivery", min_length=1, max_length=300)


# ---- Availability and monitoring --------------------------------------------

class AvailabilityRead(BaseModel):
    for_date: date
    confirmed: bool
    confirmed_at: Optional[datetime] = None


class MonitorRow(BaseModel):
    trip_id: int
    run_code: str
    driver_name: str
    vehicle_code: Optional[str] = None
    status: str
    stops_done: int
    stop_count: int
    last_update: Optional[datetime] = None
    open_issues: int
    open_sos: int
