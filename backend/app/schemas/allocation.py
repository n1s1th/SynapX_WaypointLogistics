from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List
from app.models.allocation import AllocationStatus
from app.schemas.fleet import VehicleResponse, DriverProfileResponse
from app.schemas.order import OrderRead

class AllocationBase(BaseModel):
    vehicle_id: int
    run_id: Optional[str] = None
    load_percentage: float = 0.0
    volume_percentage: float = 0.0
    departure_time: Optional[datetime] = None
    status: AllocationStatus = AllocationStatus.DRAFT

class AllocationCreate(AllocationBase):
    pass

class AllocationUpdate(BaseModel):
    run_id: Optional[str] = None
    load_percentage: Optional[float] = None
    volume_percentage: Optional[float] = None
    departure_time: Optional[datetime] = None
    status: Optional[AllocationStatus] = None

class AllocationResponse(AllocationBase):
    id: int
    driver_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    
    # Optionally include nested models for the frontend board
    vehicle: Optional[VehicleResponse] = None
    driver: Optional[DriverProfileResponse] = None
    orders: List[OrderRead] = []
    
    model_config = ConfigDict(from_attributes=True)
