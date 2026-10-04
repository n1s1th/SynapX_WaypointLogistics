from datetime import date
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field, field_validator


class OrderSelection(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=100)

    @field_validator("order_ids")
    @classmethod
    def unique_ids(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values) or len(values) != len(set(values)):
            raise ValueError("Supply distinct positive order IDs")
        return values


class RecommendationRequest(OrderSelection):
    departure_time: AwareDatetime | None = None


class ConfirmAllocationRequest(OrderSelection):
    vehicle_id: int = Field(gt=0)
    departure_time: AwareDatetime
    route_fingerprint: str | None = None


class ConstraintCheck(BaseModel):
    status: Literal["pass", "fail", "unknown"]
    message: str
    blocking: bool
    model_config = {"extra": "allow"}


class ConstraintViolation(BaseModel):
    constraint: str
    status: Literal["fail", "unknown"] = "fail"
    message: str
    model_config = {"extra": "allow"}


class OrderGroupRead(BaseModel):
    order_ids: list[int]
    depot: str
    brand: str | None
    district: str | None
    operating_date: str | None
    total_weight_kg: float | None
    total_volume_m3: float | None
    required_temperature: str
    outlet_count: int
    required_vehicle_type: Literal["van"] | None = None
    van_only_outlets: list[str] = Field(default_factory=list)


class RouteSummary(BaseModel):
    route_feasible: bool
    estimated_fuel_liters: float | None
    total_travel_minutes: float | None
    total_service_minutes: float | None
    warnings: list[str]
    violations: list[dict[str, Any]]
    input_fingerprint: str
    route_fingerprint: str
    departure_time: str | None
    stop_count: int
    ordered_outlet_codes: list[str]
    estimated_distance_km: float | None
    estimated_duration_minutes: float | None
    scheduled_elapsed_minutes: float | None
    window_feasible: bool | None
    source: str
    missing_districts: list[str]
    missing_windows: list[str]
    missing_allowances: list[str]
    late_outlets: list[str]
    arrivals: list[dict[str, Any]]


class VehicleRecommendation(BaseModel):
    vehicle_id: int
    vehicle_code: str
    eligible: bool
    recommendation_score: int | None
    recommendation_level: Literal["BEST_MATCH", "GOOD_MATCH", "LOW_MATCH", "INELIGIBLE"]
    score_factors: dict[str, float]
    constraints: dict[str, ConstraintCheck]
    route_summary: RouteSummary
    reasons: list[str]


class RecommendationResponse(BaseModel):
    order_group: OrderGroupRead
    group_violations: list[dict[str, Any]]
    vehicles: list[VehicleRecommendation]


class FuelWeekUpsert(BaseModel):
    liters_used: float = Field(ge=0, allow_inf_nan=False)
    source: str = Field(min_length=2, max_length=100)


class FuelWeekRead(FuelWeekUpsert):
    vehicle_id: int
    week_start: date


