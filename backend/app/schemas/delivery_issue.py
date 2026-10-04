from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class DeliveryIssueBase(BaseModel):
    order_id: Optional[int] = None
    order_number: Optional[str] = None
    outlet_id: Optional[int] = None
    issue_type: str
    title: str
    affected_item: Optional[str] = None
    sku: Optional[str] = None
    expected_units: Optional[int] = None
    received_units: Optional[int] = None
    description: str
    photo_url: Optional[str] = Field(default=None, max_length=2_000_000)
    photo_name: Optional[str] = None
    photo_size: Optional[str] = None
    reported_by: Optional[str] = "Sarah Jenkins (Store Manager)"
    driver_name: Optional[str] = None
    vehicle_id: Optional[str] = None
    claimed_amount: Optional[str] = None


class DeliveryIssueCreate(DeliveryIssueBase):
    pass


class DeliveryIssueUpdate(BaseModel):
    issue_type: Optional[str] = None
    title: Optional[str] = None
    affected_item: Optional[str] = None
    sku: Optional[str] = None
    expected_units: Optional[int] = None
    received_units: Optional[int] = None
    description: Optional[str] = None
    photo_url: Optional[str] = Field(default=None, max_length=2_000_000)
    photo_name: Optional[str] = None
    photo_size: Optional[str] = None
    status: Optional[str] = None
    resolution_notes: Optional[str] = None
    claimed_amount: Optional[str] = None


class DeliveryIssueRead(DeliveryIssueBase):
    id: int
    status: str
    resolution_notes: Optional[str] = None
    reported_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
