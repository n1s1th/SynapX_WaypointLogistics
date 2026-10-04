from datetime import date, datetime, time
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.loader_issue import IssueStatus as LoaderIssueStatus, IssueType as LoaderIssueType
from app.models.order import OrderStatus
from app.schemas.order import OrderItemRead

TemperatureZone = Literal["Chilled", "Ambient"]


class GoodsRequestItem(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    item_name: str = Field(min_length=1, max_length=255)
    quantity: int = Field(gt=0, le=999)
    temperature_zone: TemperatureZone
    unit_price: float = Field(default=0.0, ge=0)


class GoodsRequestCreate(BaseModel):
    """A Store Manager goods request. Mixed chilled/ambient requests become one order per zone (Q1)."""

    # Optional for a signed-in store manager (their own outlet is used); admins and local dev send it.
    outlet_id: Optional[int] = None
    delivery_date: date
    is_priority: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)
    # Optional narrower window for this delivery; must sit inside the outlet's receiving window.
    # Leave both out to use the outlet's full window.
    window_start: Optional[time] = None
    window_end: Optional[time] = None
    items: List[GoodsRequestItem] = Field(min_length=1)


SHORTFALL_ISSUE_TYPES = {LoaderIssueType.SHORT, LoaderIssueType.MISSING, LoaderIssueType.WONT_FIT}
UNDECIDED = {LoaderIssueStatus.SENT, LoaderIssueStatus.SEEN}


class OrderShortfall(BaseModel):
    """Order-level shortfall from the loader's issues (loader_issues). The loader flags per order, not per item."""

    # under_review: the dispatcher hasn't decided yet, so there's no number to show.
    state: Literal["under_review", "confirmed"]
    units_short: Optional[int] = None
    units_total: Optional[int] = None
    reasons: List[str] = []


def summarise_shortfall(issues) -> Optional[OrderShortfall]:
    """None when nothing is short. Several issues on one order are added up."""
    shortfalls = [issue for issue in issues or [] if issue.issue_type in SHORTFALL_ISSUE_TYPES]
    if not shortfalls:
        return None
    reasons = sorted({issue.issue_type.value for issue in shortfalls})
    if any(issue.status in UNDECIDED for issue in shortfalls):
        return OrderShortfall(state="under_review", reasons=reasons)
    known = [issue.units_affected for issue in shortfalls if issue.units_affected is not None]
    units_short = sum(known) if known else None
    if units_short == 0:
        return None  # the dispatcher's decision covered it
    totals = [issue.units_total for issue in shortfalls if issue.units_total is not None]
    return OrderShortfall(
        state="confirmed", units_short=units_short, units_total=max(totals) if totals else None, reasons=reasons
    )


class OrderDelivery(BaseModel):
    """Who is bringing the order and where the trip is: from the Dispatcher's allocation and delivery run."""

    vehicle_code: Optional[str] = None
    vehicle_type: Optional[str] = None
    temperature_mode: Optional[str] = None
    driver_name: Optional[str] = None
    driver_phone: Optional[str] = None
    trip_code: Optional[str] = None
    # scheduled / en_route / completed / recalled; null until the Dispatcher creates the run
    trip_status: Optional[str] = None
    departure_time: Optional[datetime] = None
    estimated_arrival: Optional[datetime] = None
    actual_arrival: Optional[datetime] = None


def summarise_delivery(allocation) -> Optional[OrderDelivery]:
    """None until the Dispatcher allocates the order to a vehicle."""
    if allocation is None:
        return None
    trips = sorted(allocation.dispatch_trips or [], key=lambda trip: trip.id)
    trip = trips[-1] if trips else None
    vehicle = allocation.vehicle
    driver = allocation.driver
    driver_name = (trip.driver_name if trip else None) or (driver.user.full_name if driver and driver.user else None)
    return OrderDelivery(
        vehicle_code=(trip.vehicle_number if trip else None) or (vehicle.code if vehicle else None),
        vehicle_type=vehicle.vehicle_type if vehicle else None,
        temperature_mode=vehicle.temperature_mode if vehicle else None,
        driver_name=driver_name,
        driver_phone=driver.phone if driver else None,
        trip_code=trip.trip_code if trip else None,
        trip_status=trip.status if trip else None,
        departure_time=(trip.departure_time if trip else None) or allocation.departure_time,
        estimated_arrival=trip.estimated_arrival if trip else None,
        actual_arrival=trip.actual_arrival if trip else None,
    )


class StoreOrderRead(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    outlet_id: Optional[int] = None
    brand: Optional[str] = None
    temperature_zone: str
    operating_date: Optional[str] = None
    delivery_window: Optional[str] = None
    is_priority: bool
    units: Optional[int] = None
    weight_kg: float
    total_amount: float
    notes: Optional[str] = None
    submitted_at: Optional[datetime] = None
    cutoff_at: Optional[datetime] = None
    deferral_reason: Optional[str] = None
    deferral_count: int
    items: List[OrderItemRead] = []
    shortfall: Optional[OrderShortfall] = Field(default=None, validation_alias="loader_issues")
    delivery: Optional[OrderDelivery] = Field(default=None, validation_alias="allocation")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("delivery", mode="before")
    @classmethod
    def delivery_from_allocation(cls, value):
        return value if value is None or isinstance(value, (dict, OrderDelivery)) else summarise_delivery(value)

    @field_validator("shortfall", mode="before")
    @classmethod
    def shortfall_from_issues(cls, value):
        return summarise_shortfall(value) if isinstance(value, list) else value


class OrderStatusUpdate(BaseModel):
    """Contract: order_service.update_order_status — called by the Loader/Driver/Dispatcher flows."""

    status: OrderStatus

    @field_validator("status", mode="before")
    @classmethod
    def accept_lowercase(cls, value):
        return value.upper() if isinstance(value, str) else value


class OrderDeferral(BaseModel):
    """Dispatcher defers an order to a later operating day and says why."""

    reason: str = Field(min_length=1, max_length=255)
    new_delivery_date: Optional[date] = None


class OperatingDaysRead(BaseModel):
    """Delivery dates the Store Manager can pick (Figma 03c date picker)."""

    operating_days: List[date]
    earliest_default: date
    earliest_high_priority: date
