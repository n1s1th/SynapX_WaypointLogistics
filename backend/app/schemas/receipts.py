from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ReceiptCreateRequest(BaseModel):
    order_id: int
    outlet_id: int
    units_received: Optional[int] = None
    weight_received_kg: Optional[float] = None
    has_issues: bool = False
    issue_type: Optional[str] = None  # short_delivery | damaged | wrong_items | other
    issue_description: Optional[str] = None
    confirmed_at: datetime
    synced_from_offline: bool = False


class ReceiptSyncRequest(BaseModel):
    receipts: list[ReceiptCreateRequest]


class ReceiptResponse(BaseModel):
    id: int
    order_id: int
    outlet_id: int
    units_received: Optional[int] = None
    weight_received_kg: Optional[float] = None
    has_issues: bool
    issue_type: Optional[str] = None
    issue_description: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    synced_from_offline: bool

    model_config = ConfigDict(from_attributes=True)


class ReceiptSyncResponse(BaseModel):
    synced: int
    skipped: int
