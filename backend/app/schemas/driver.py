from typing import List, Optional, Annotated, Literal
from datetime import date, datetime, timezone
from pydantic import BaseModel, ConfigDict, PlainSerializer, field_validator
from app.models.driver import DriverTripStatus, DeliveryStopStatus, IssueType, IssueStatus, SOSStatus

# Columns are stored as naive UTC (no DB timezone column, to avoid a migration
# on the shared Neon DB). Stamp UTC back on before serializing so clients don't
# misread the naive value as local time.
def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

UTCDateTime = Annotated[datetime, PlainSerializer(_as_utc, return_type=datetime)]


class ProofOfDeliveryBase(BaseModel):
    recipient_name: str
    signature_data: Optional[str] = None
    photo_url: Optional[str] = None
    notes: Optional[str] = None

class ProofOfDeliveryCreate(ProofOfDeliveryBase):
    pass

class ProofOfDeliveryRead(ProofOfDeliveryBase):
    id: int
    stop_id: int
    created_at: UTCDateTime
    model_config = ConfigDict(from_attributes=True)


class DeliveryStopBase(BaseModel):
    sequence: int
    address: str
    customer_name: str
    customer_phone: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    notes: Optional[str] = None
    status: DeliveryStopStatus = DeliveryStopStatus.PENDING

class DeliveryStopCreate(DeliveryStopBase):
    shipment_id: Optional[int] = None

class DeliveryStopRead(DeliveryStopBase):
    id: int
    driver_trip_id: int
    shipment_id: Optional[int]
    arrived_at: Optional[UTCDateTime]
    completed_at: Optional[UTCDateTime]
    created_at: UTCDateTime
    pod: Optional[ProofOfDeliveryRead] = None
    model_config = ConfigDict(from_attributes=True)


class StopOrderItem(BaseModel):
    sku: str
    item_name: str
    quantity: int


class StopOrderInfo(BaseModel):
    order_number: str
    brand: Optional[str] = None
    temperature_zone: Optional[str] = None
    delivery_window: Optional[str] = None
    units: Optional[int] = None
    weight_kg: Optional[float] = None
    volume_m3: Optional[float] = None
    notes: Optional[str] = None
    on_truck: bool = True  # False: on the plan but the loader didn't load it
    items: List[StopOrderItem] = []


class DeliveryStopDetail(DeliveryStopRead):
    """A stop plus the orders being delivered there (for the at-stop screens)."""
    total_stops: int
    trip_status: DriverTripStatus
    order: Optional[StopOrderInfo] = None  # the first of `orders`
    orders: List[StopOrderInfo] = []


class DriverTripBase(BaseModel):
    status: DriverTripStatus = DriverTripStatus.ASSIGNED

class DriverTripCreate(DriverTripBase):
    dispatch_trip_id: int

class DriverTripSummary(DriverTripBase):
    id: int
    driver_id: int
    dispatch_trip_id: int
    assigned_date: UTCDateTime
    started_at: Optional[UTCDateTime]
    completed_at: Optional[UTCDateTime]
    created_at: UTCDateTime
    planned_departure: Optional[UTCDateTime] = None  # the dispatcher's departure time
    run_code: Optional[str] = None  # e.g. RUN-0067, as the dispatcher and loader call it
    vehicle_number: Optional[str] = None  # the truck, e.g. VEH005

    # Can add fields like stop_count or completed_stops via computed fields if needed
    model_config = ConfigDict(from_attributes=True)

class DriverTripDetail(DriverTripSummary):
    stops: List[DeliveryStopRead] = []
    last_window_closes: Optional[str] = None  # "HH:MM", latest outlet window end on the run


class IssueReportBase(BaseModel):
    issue_type: IssueType
    description: str
    photo_url: Optional[str] = None

class IssueReportCreate(IssueReportBase):
    stop_id: Optional[int] = None
    client_action_id: Optional[str] = None  # the phone's id: a report sent again is saved once

class IssueReportRead(IssueReportBase):
    id: int
    driver_trip_id: int
    stop_id: Optional[int]
    status: IssueStatus
    created_at: UTCDateTime
    model_config = ConfigDict(from_attributes=True)

class DispatcherIssueRead(IssueReportRead):
    """A driver's report on the dispatcher's list."""
    driver_name: Optional[str] = None
    trip_code: Optional[str] = None
    stop_sequence: Optional[int] = None
    stop_name: Optional[str] = None

class IssueStatusUpdate(BaseModel):
    status: IssueStatus


class SOSAlertBase(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    message: Optional[str] = None

class SOSAlertCreate(SOSAlertBase):
    driver_trip_id: Optional[int] = None

class SOSAlertRead(SOSAlertBase):
    id: int
    driver_id: int
    driver_trip_id: Optional[int]
    status: SOSStatus
    triggered_at: UTCDateTime
    acknowledged_at: Optional[UTCDateTime]
    model_config = ConfigDict(from_attributes=True)


class SyncAction(BaseModel):
    action_id: str  # Unique ID from client to prevent duplicate processing
    action_type: str  # 'arrive', 'outcome', 'pod', 'complete', 'issue'
    stop_id: Optional[int] = None
    trip_id: Optional[int] = None
    payload: dict = {}
    client_timestamp: datetime

class SyncConflict(BaseModel):
    action_id: str
    stop_id: Optional[int]
    reason: str
    server_state: dict

class SyncResult(BaseModel):
    processed_count: int
    conflicts: List[SyncConflict]

# ---- Profile ---------------------------------------------------------------------
# The driver keeps phone and licence up to date; the vehicle is the depot's to set.

LicenseType = Literal["Light", "Heavy"]  # Light: vans. Heavy: trucks.


def normalise_phone(value: str) -> Optional[str]:
    """A Sri Lankan number as 0XXXXXXXXX (spaces, dashes or +94 allowed), else None."""
    number = "".join(ch for ch in value if ch not in " -()")
    if number.startswith("+94"):
        number = "0" + number[3:]
    return number if len(number) == 10 and number.isdigit() and number.startswith("0") else None


class DriverVehicleInfo(BaseModel):
    code: str
    vehicle_type: str
    temperature_mode: str
    depot_name: str


class DriverProfileRead(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = None
    license_type: Optional[str] = None
    complete: bool  # phone and licence saved, so dispatch can assign the driver
    vehicle: Optional[DriverVehicleInfo] = None  # usual truck, set by the depot
    todays_vehicle: Optional[str] = None  # truck on the driver's current trip


class DriverProfileUpdate(BaseModel):
    phone: str
    license_type: LicenseType

    @field_validator("phone")
    @classmethod
    def sri_lankan_number(cls, value: str) -> str:
        number = normalise_phone(value)
        if number is None:
            raise ValueError("Enter a Sri Lankan phone number, like 0771234567.")
        return number


# ---- Ready for tomorrow ------------------------------------------------------------

class DriverReadyRead(BaseModel):
    for_date: date  # the next working day the "I'm ready" is for
    confirmed: bool
    confirmed_at: Optional[UTCDateTime] = None
    open: bool  # before the 4 PM cutoff, when dispatch plans the next day


class DriverAvailabilityRead(BaseModel):
    """One driver who said they can take a run that day (for the dispatcher)."""
    driver_id: int  # users.id
    driver_profile_id: Optional[int] = None  # driver_profiles.id, what allocations use
    full_name: str
    phone: Optional[str] = None
    vehicle_code: Optional[str] = None  # the truck admin assigned, if any
    confirmed_at: UTCDateTime
