"""Single backend source for allocation hard constraints and their evidence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models.allocation import Allocation, AllocationStatus
from app.models.fleet import Vehicle, VehicleStatus
from app.models.order import Order
from app.models.reference import Brand, Depot, Dock
from app.services.calendar_service import calendar_service
from app.services.order_grouping import OrderGroup, order_grouping_service
from app.services.route_planning import COLOMBO, RoutePlan
from app.services.district_travel import district_travel
from app.services.service_allowance import allowances
from app.services.outlet_access import outlet_requires_van


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _local_day(value: datetime) -> date:
    return _aware_utc(value).astimezone(COLOMBO).date()


def _official_trip_minutes(group: OrderGroup) -> float | None:
    """Task 2B check_allocation.py: one allowance per whole order."""
    travel = district_travel().get((group.depot, (group.district or "").strip().casefold()))
    service = allowances()
    if not group.orders or travel is None or group.brand is None:
        return None
    minutes = []
    for order in group.orders:
        allowance = service.get((group.brand, order.outlet.dock_type)) if order.outlet else None
        if allowance is None:
            return None
        minutes.append(allowance)
    return travel.depot_to_district_freeflow_min + (len(group.orders) - 1) * travel.inter_stop_freeflow_min + sum(minutes)


@dataclass
class ConstraintReport:
    constraints: dict[str, dict]
    violations: list[dict]

    @property
    def eligible(self) -> bool:
        return not any(item["blocking"] for item in self.constraints.values())


@dataclass
class ConstraintFacts:
    allocations: list[Allocation]
    dock_exists: bool


class AllocationConstraintService:
    @staticmethod
    def validate(
        db: Session, group: OrderGroup, vehicle: Vehicle, departure_time: datetime | None,
        route: RoutePlan, *, existing_allocation_id: int | None = None,
        facts: ConstraintFacts | None = None,
    ) -> ConstraintReport:
        checks: dict[str, dict] = {}
        violations: list[dict] = []
        if facts is None:
            facts = ConstraintFacts(
                allocations=db.query(Allocation).options(selectinload(Allocation.orders).selectinload(Order.outlet)).filter(Allocation.vehicle_id == vehicle.id).all(),
                dock_exists=db.query(Dock.id).filter(Dock.depot == group.depot).first() is not None,
            )

        def add(name: str, state: str, message: str, *, blocking: bool | None = None, **evidence) -> None:
            blocks = state != "pass" if blocking is None else blocking
            checks[name] = {"status": state, "message": message, "blocking": blocks, **evidence}
            if blocks:
                violations.append({"constraint": name.upper(), "status": state, "message": message})

        if group.violations:
            message = "; ".join(item["message"] for item in group.violations)
            add("order_group", "fail", message, details=group.violations)
        else:
            add("order_group", "pass", "Selected orders form a valid group.")

        same_depot = vehicle.depot_name.strip().lower() == group.depot.value
        add("depot", "pass" if same_depot else "fail",
            "Vehicle and orders share the dispatcher depot." if same_depot else f"{vehicle.code} belongs to {vehicle.depot_name}, not {group.depot.value}.",
            vehicle_depot=vehicle.depot_name, order_depot=group.depot.value)

        other_holds = any(
            allocation.id != existing_allocation_id
            and allocation.status not in (AllocationStatus.COMPLETED, AllocationStatus.CANCELLED)
            for allocation in facts.allocations
        )
        held_here = existing_allocation_id is not None and vehicle.status in (VehicleStatus.ALLOCATED, VehicleStatus.LOADING)
        available = (vehicle.status == VehicleStatus.AVAILABLE or held_here) and not other_holds
        add("availability", "pass" if available else "fail",
            "Vehicle is available for this allocation." if available else f"{vehicle.code} is {vehicle.status.value.lower()}.",
            vehicle_status=vehicle.status.value)

        mode = (vehicle.temperature_mode or "").strip().lower()
        temp_known = group.required_temperature in {"ambient", "chilled"} and mode in {"ambient", "reefer"}
        temp_ok = temp_known and (group.required_temperature == "ambient" or mode == "reefer")
        add("temperature", "unknown" if not temp_known else ("pass" if temp_ok else "fail"),
            f"{vehicle.code} has {mode or 'unknown'} cooling; the group requires {group.required_temperature}.",
            required=group.required_temperature, vehicle_mode=mode)

        access_problems = []
        unknown_restrictions = []
        van_only_outlets = []
        for outlet in {order.outlet for order in group.orders if order.outlet is not None}:
            if outlet_requires_van(outlet):
                van_only_outlets.append(outlet.code)
                if vehicle.vehicle_type.strip().lower() != "van":
                    access_problems.append(outlet.code)
            if (outlet.parking_constraint or "normal").strip().lower() not in ("normal", "van_only") or (outlet.delivery_restrictions or "").strip():
                unknown_restrictions.append(outlet.code)
            if outlet.active is False:
                access_problems.append(outlet.code)
        if access_problems:
            message = f"{vehicle.code} cannot serve outlet(s): {', '.join(sorted(set(access_problems)))}."
            if van_only_outlets and vehicle.vehicle_type.strip().lower() != "van":
                message += f" Van required at {', '.join(sorted(van_only_outlets))}; {vehicle.vehicle_type} is not permitted."
            add("access", "fail", message, outlets=sorted(set(access_problems)), van_only_outlets=sorted(van_only_outlets))
        elif unknown_restrictions:
            add("access", "unknown", f"Outlet access rules need review: {', '.join(sorted(set(unknown_restrictions)))}.",
                outlets=sorted(set(unknown_restrictions)))
        else:
            add("access", "pass", "Van-only outlet requirements are met." if van_only_outlets else "Structured outlet access rules permit this vehicle.",
                van_only_outlets=sorted(van_only_outlets))

        for name, total, capacity, unit in (
            ("weight", group.total_weight_kg, vehicle.capacity_kg, "kg"),
            ("volume", group.total_volume_m3, vehicle.capacity_vol_m3, "m3"),
        ):
            state = "unknown" if total is None or capacity is None or capacity <= 0 else ("pass" if total <= capacity else "fail")
            add(name, state, f"Selected orders require {total if total is not None else 'unknown'} {unit}; {vehicle.code} supports {capacity} {unit}.",
                required=total, capacity=capacity, unit=unit)

        if group.operating_date is None:
            add("operating_date", "fail", "Orders need one valid operating date.")
        elif departure_time is None or departure_time.tzinfo is None:
            add("operating_date", "unknown", "Provide a timezone-aware departure time to validate the operating date.")
        elif _local_day(departure_time) != group.operating_date:
            add("operating_date", "fail", "Departure falls on a different Colombo operating date.",
                order_date=group.operating_date.isoformat(), departure_date=_local_day(departure_time).isoformat())
        elif not calendar_service.is_operating_day(db, group.operating_date):
            add("operating_date", "fail", f"{group.operating_date.isoformat()} is not an operating day.")
        else:
            add("operating_date", "pass", "Departure matches an operating day.", date=group.operating_date.isoformat())

        day = group.operating_date
        trips = None
        if day is not None:
            trips = sum(1 for allocation in facts.allocations
                        if allocation.id != existing_allocation_id
                        and allocation.status not in (AllocationStatus.CANCELLED, AllocationStatus.UNAVAILABLE)
                        and allocation.departure_time is not None
                        and _local_day(allocation.departure_time) == day)
        if trips is None:
            add("trips_today", "unknown", "Cannot count trips without an operating date.", maximum=settings.ALLOCATION_MAX_TRIPS_PER_DAY)
        else:
            allowed = trips < settings.ALLOCATION_MAX_TRIPS_PER_DAY
            add("trips_today", "pass" if allowed else "fail",
                f"{vehicle.code} has {trips} of {settings.ALLOCATION_MAX_TRIPS_PER_DAY} trips on {day.isoformat()}.",
                trips_on_date=trips, maximum=settings.ALLOCATION_MAX_TRIPS_PER_DAY)

        # Official Task 2B limits apply to cumulative same-day trips per vehicle:
        # Fresh uses the 270-minute pre-dawn budget; Style/Tech share 480 minutes.
        budget = 270 if group.brand == Brand.FRESH else 480
        projected_minutes = _official_trip_minutes(group)
        used_minutes = 0.0
        budget_known = day is not None and projected_minutes is not None
        for allocation in facts.allocations:
            if (allocation.id == existing_allocation_id
                or allocation.status in (AllocationStatus.CANCELLED, AllocationStatus.UNAVAILABLE)
                or not allocation.departure_time or _local_day(allocation.departure_time) != day):
                continue
            previous = order_grouping_service.from_orders(allocation.orders, group.depot)
            if previous.brand is None:
                budget_known = False
                continue
            if (previous.brand == Brand.FRESH) != (group.brand == Brand.FRESH):
                continue
            duration = _official_trip_minutes(previous)
            if duration is None:
                budget_known = False
            else:
                used_minutes += duration
        budget_ok = budget_known and used_minutes + projected_minutes <= budget + 1e-6
        add("trip_time_budget", "pass" if budget_ok else "fail",
            f"{used_minutes:g} min used + {projected_minutes:g} min planned / {budget} min daily budget."
            if budget_known else "Official trip-time budget cannot be verified from the available order/reference data.",
            used_minutes=used_minutes, projected_minutes=projected_minutes, maximum_minutes=budget)

        if route.missing_allowances:
            add("delivery_windows", "unknown", "Service allowance data is missing for " + ", ".join(route.missing_allowances) + ".",
                missing_allowances=route.missing_allowances)
        elif route.missing_windows:
            add("delivery_windows", "unknown", f"Missing usable receiving windows for {', '.join(route.missing_windows)}.",
                outlets=route.missing_windows)
        elif route.missing_districts:
            add("delivery_windows", "unknown", "District travel reference is missing for the selected depot/district.",
                missing_districts=route.missing_districts)
        elif route.window_feasible is None:
            add("delivery_windows", "unknown", "A departure time and district travel reference are required.")
        else:
            add("delivery_windows", "pass" if route.window_feasible else "fail",
                "All outlet windows can be met." if route.window_feasible else f"Cannot meet receiving windows at {', '.join(route.late_outlets)}.",
                late_outlets=route.late_outlets)

        exceeded = (vehicle.weekly_fuel_status or "").strip().casefold() == "exceeded quota"
        add("fuel", "fail" if exceeded else "unknown", "Exceeded quota" if exceeded else "Not verified",
            blocking=exceeded, quota_l=vehicle.weekly_fuel_quota_l, km_per_l=vehicle.km_per_l,
            weekly_fuel_status=vehicle.weekly_fuel_status, projected_liters=route.estimated_fuel_liters)

        driver = vehicle.driver
        add("route_feasibility", "pass" if route.route_feasible else "unknown" if route.window_feasible is None else "fail",
            "Route travel, service and access checks pass." if route.route_feasible else
            "; ".join(item["message"] for item in route.violations) or "Route could not be validated.")
        add("driver", "pass" if driver is not None else "unknown",
            "Assigned driver comes from the vehicle." if driver is not None else "Not assigned",
            blocking=False, driver_profile_id=driver.id if driver else None)
        add("dock", "pass" if facts.dock_exists else "fail",
            "A loading dock exists at the depot." if facts.dock_exists else "The vehicle's depot has no loading dock.")
        return ConstraintReport(constraints=checks, violations=violations)


allocation_constraint_service = AllocationConstraintService()
