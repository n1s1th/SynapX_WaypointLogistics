from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.models.driver import DriverTripStatus, DeliveryStopStatus, IssueType, IssueStatus, SOSStatus


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
    delivered_items: Optional[Dict[str, int]] = None
    captured_at: Optional[datetime] = None
    created_at: datetime
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
    outcome_reason: Optional[str] = None
    arrived_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
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
    items: List[StopOrderItem] = []


class PodRequirements(BaseModel):
    """What must be captured before the server accepts a stop (enforced server-side too)."""
    recipient_name: bool
    signature: bool
    min_photos: int
    max_photos: int
    delivered_quantities: str
    failure_reason: bool


class DeliveryStopWithOrder(DeliveryStopRead):
    """A stop with everything the phone needs to work it offline."""
    order: Optional[StopOrderInfo] = None
    pod_requirements: PodRequirements


class DeliveryStopDetail(DeliveryStopWithOrder):
    """A stop plus the order being delivered there (for the at-stop screens)."""
    total_stops: int
    trip_status: DriverTripStatus


class DriverTripBase(BaseModel):
    status: DriverTripStatus = DriverTripStatus.ASSIGNED

class DriverTripCreate(DriverTripBase):
    dispatch_trip_id: int

class DriverTripSummary(DriverTripBase):
    id: int
    driver_id: int
    dispatch_trip_id: int
    assigned_date: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    
    # Can add fields like stop_count or completed_stops via computed fields if needed
    model_config = ConfigDict(from_attributes=True)

class DriverTripDetail(DriverTripSummary):
    stops: List[DeliveryStopWithOrder] = []


class IssueReportBase(BaseModel):
    issue_type: IssueType
    description: str
    photo_url: Optional[str] = None

class IssueReportCreate(IssueReportBase):
    stop_id: Optional[int] = None

class IssueReportRead(IssueReportBase):
    id: int
    driver_trip_id: int
    stop_id: Optional[int]
    status: IssueStatus
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


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
    triggered_at: datetime
    acknowledged_at: Optional[datetime]
    model_config = ConfigDict(from_attributes=True)


class SyncAction(BaseModel):
    # Generated once per tap on the phone and reused on every retry (idempotency key)
    action_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    # 'arrive' | 'deliver' | 'issue' | 'complete_trip' (legacy: 'outcome' | 'pod' | 'complete')
    action_type: str = Field(max_length=32)
    stop_id: Optional[int] = None
    trip_id: Optional[int] = None
    payload: Dict[str, Any] = {}
    # When it happened on the phone; the server records its own receipt time separately
    client_timestamp: datetime

class SyncConflict(BaseModel):
    action_id: str
    stop_id: Optional[int]
    reason: str
    server_state: dict

class SyncEventResult(BaseModel):
    action_id: str
    status: str  # applied | conflict | rejected
    duplicate: bool = False  # True when this action_id was already processed
    code: Optional[str] = None
    message: Optional[str] = None
    trip_id: Optional[int] = None
    stop_id: Optional[int] = None
    server_state: Optional[Dict[str, Any]] = None
    received_at: datetime
    reviewed: bool = False
    review_note: Optional[str] = None

class SyncResult(BaseModel):
    processed_count: int
    conflicts: List[SyncConflict]
    results: List[SyncEventResult] = []

