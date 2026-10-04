from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator, computed_field
from app.models.order import OrderStatus
from app.models.reference import Depot


class OrderItemBase(BaseModel):
    sku: str
    item_name: str
    quantity: int
    unit_price: float


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemRead(OrderItemBase):
    id: int
    order_id: int
    quantity_sent: Optional[int] = None
    dispatcher_note: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class OrderBase(BaseModel):
    client_name: str
    destination_address: str
    status: OrderStatus = OrderStatus.DRAFT
    brand: Optional[str] = None
    district: Optional[str] = None
    temperature_zone: str = "Ambient"
    delivery_window: Optional[str] = None
    weight_kg: float = 0.0
    units: Optional[int] = None
    volume_m3: Optional[float] = None
    is_priority: bool = False
    is_late: bool = False
    operating_date: Optional[str] = None
    deferral_reason: Optional[str] = None
    allocation_id: Optional[int] = None
    depot: Depot = Depot.PELIYAGODA

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, v):
        if isinstance(v, str):
            v_upper = v.upper()
            if v_upper in OrderStatus.__members__:
                return OrderStatus[v_upper]
        return v


class OrderCreate(OrderBase):
    order_number: str
    total_amount: float = 0.0
    items: List[OrderItemCreate] = []


class OrderUpdate(BaseModel):
    client_name: Optional[str] = None
    destination_address: Optional[str] = None
    status: Optional[OrderStatus] = None
    brand: Optional[str] = None
    district: Optional[str] = None
    temperature_zone: Optional[str] = None
    delivery_window: Optional[str] = None
    weight_kg: Optional[float] = None
    units: Optional[int] = None
    volume_m3: Optional[float] = None
    is_priority: Optional[bool] = None
    is_late: Optional[bool] = None
    operating_date: Optional[str] = None
    deferral_reason: Optional[str] = None
    allocation_id: Optional[int] = None


class OrderRead(OrderBase):
    id: int
    order_number: str
    total_amount: float
    items: List[OrderItemRead] = []
    created_at: datetime
    updated_at: datetime
    estimated_arrival: Optional[datetime] = None

    @computed_field
    @property
    def order_units(self) -> int:
        if self.units is not None and self.units > 0:
            return self.units
        if self.items:
            return sum(item.quantity for item in self.items)
        return 0

    @computed_field
    @property
    def order_weight_kg(self) -> float:
        return self.weight_kg or 0.0

    @computed_field
    @property
    def order_volume_m3(self) -> float:
        return self.volume_m3 or 0.0

    @computed_field
    @property
    def temp_requirement(self) -> str:
        return self.temperature_zone or "Ambient"

    requires_van: bool = False

    model_config = ConfigDict(from_attributes=True)
