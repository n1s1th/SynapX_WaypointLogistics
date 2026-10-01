from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class OutletSettingsRead(BaseModel):
    outlet_id: int
    outlet_code: str
    outlet_name: str
    brand: str
    district: str
    serving_depot: str
    store_manager: Optional[str] = None
    contact_phone: Optional[str] = None
    emergency_contact: Optional[str] = None
    window_start: str
    window_end: str
    dock_type: str
    vehicle_access: str
    parking: str
    driver_check_in_call: bool
    share_dock_gate_code: bool
    email_alerts_issues: bool
    sms_alerts_priority: bool
    is_verified: bool = True
    last_synced_at: Optional[datetime] = None

    model_config = {"from_attributes": True}



class OutletSettingsUpdate(BaseModel):
    contact_phone: Optional[str] = Field(None, max_length=50)
    emergency_contact: Optional[str] = Field(None, max_length=255)
    driver_check_in_call: Optional[bool] = None
    share_dock_gate_code: Optional[bool] = None
    email_alerts_issues: Optional[bool] = None
    sms_alerts_priority: Optional[bool] = None
