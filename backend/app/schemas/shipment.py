from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from app.models.shipment import ShipmentStatus


class DispatchTripBase(BaseModel):
    trip_code: str
    vehicle_number: str
    driver_name: str
    origin: str
    destination: str
    depot_name: Optional[str] = None


class DispatchTripCreate(DispatchTripBase):
    allocation_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    driver_id: Optional[int] = None
    status: Optional[str] = "scheduled"
    departure_time: Optional[datetime] = None
    estimated_arrival: Optional[datetime] = None
    total_weight_kg: float = 0.0
    total_volume_m3: float = 0.0
    stop_count: int = 0
    stops_completed: int = 0
    stop_sequence: Optional[List[Any]] = None
    open_shortfalls: int = 0
    loading_events: Optional[List[Dict[str, Any]]] = None


class DispatchTripRead(DispatchTripBase):
    id: int
    allocation_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    driver_id: Optional[int] = None
    status: str
    departure_time: Optional[datetime] = None
    estimated_arrival: Optional[datetime] = None
    actual_arrival: Optional[datetime] = None
    total_weight_kg: float = 0.0
    total_volume_m3: float = 0.0
    stop_count: int = 0
    stops_completed: int = 0
    stop_sequence: Optional[List[Any]] = None
    open_shortfalls: int = 0
    loading_events: Optional[List[Dict[str, Any]]] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class DeliveryRunResponse(DispatchTripRead):
    loader: Optional[Dict[str, Any]] = None


class DeliveryRunUpdate(BaseModel):
    status: Optional[str] = None
    stops_completed: Optional[int] = None
    stop_sequence: Optional[List[Any]] = None
    actual_arrival: Optional[datetime] = None
    departure_time: Optional[datetime] = None
    open_shortfalls: Optional[int] = None
    loading_events: Optional[List[Dict[str, Any]]] = None


class ShipmentBase(BaseModel):
    tracking_number: str
    order_id: int
    dispatch_trip_id: Optional[int] = None
    status: ShipmentStatus = ShipmentStatus.PENDING
    current_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ShipmentCreate(ShipmentBase):
    pass


class ShipmentUpdate(BaseModel):
    status: Optional[ShipmentStatus] = None
    current_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    dispatch_trip_id: Optional[int] = None


class ShipmentRead(ShipmentBase):
    id: int
    last_updated: datetime
    dispatch_trip: Optional[DispatchTripRead] = None

    model_config = ConfigDict(from_attributes=True)


class LoadingEventIn(BaseModel):
    event: str
    time: str         # "HH:mm"
    note: str = ""
    status: str = "ok"   # ok | error | warning | pending
