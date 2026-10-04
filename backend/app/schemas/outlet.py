from datetime import datetime, time
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from app.models.reference import Brand, Depot, DockType


class ContactInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    role: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None

    @model_validator(mode="after")
    def reachable(self):
        if not self.phone and not self.email:
            raise ValueError("A contact needs a phone number or email")
        return self


class WindowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weekday: int = Field(ge=0, le=6)
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def ordered(self):
        if self.opens_at >= self.closes_at:
            raise ValueError("Closing time must be after opening time on the same day")
        return self


class OutletFields(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(default="", max_length=500)
    district: str = Field(min_length=1, max_length=100)
    brand: Brand
    depot: Depot
    dock_type: DockType
    van_only: bool = False
    active: bool = True
    delivery_restrictions: str | None = Field(default=None, max_length=2000)
    parking_constraint: str | None = Field(default="normal", max_length=50)
    mall_window: str | None = Field(default=None, max_length=50)
    window_start: time | None = None
    window_end: time | None = None
    store_manager: str | None = None
    store_manager_phone: str | None = None
    contacts: list[ContactInput] = Field(default_factory=list, max_length=20)
    receiving_windows: list[WindowInput] = Field(default_factory=list, max_length=21)

    @field_validator("window_start", "window_end", mode="before")
    @classmethod
    def parse_time(cls, v):
        if isinstance(v, str) and v.strip():
            parts = v.strip().split(":")
            return time(int(parts[0]), int(parts[1]))
        return v

    @field_validator("receiving_windows")
    @classmethod
    def unique_windows(cls, windows):
        keys = [(window.weekday, window.opens_at, window.closes_at) for window in windows]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate receiving windows are not allowed")
        for day in range(7):
            schedule = sorted((window.opens_at, window.closes_at) for window in windows if window.weekday == day)
            if any(previous[1] > current[0] for previous, current in zip(schedule, schedule[1:])):
                raise ValueError("Receiving windows cannot overlap")
        return windows


class OutletCreate(OutletFields):
    pass


class OutletUpdate(OutletFields):
    expected_updated_at: datetime | None = None


class ContactRead(ContactInput):
    id: int
    model_config = ConfigDict(from_attributes=True)


class WindowRead(WindowInput):
    id: int
    model_config = ConfigDict(from_attributes=True)


class OutletRead(OutletFields):
    id: int
    address: str | None = None
    active: bool | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    window_start: time | None = None
    window_end: time | None = None
    parking_constraint: str | None = None
    mall_window: str | None = None
    store_manager: str | None = None
    store_manager_user_id: int | None = None
    store_manager_phone: str | None = None
    contacts: list[ContactRead] = Field(default_factory=list)
    receiving_windows: list[WindowRead] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)

