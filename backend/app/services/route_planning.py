"""Replaceable route planning boundary using the official district reference."""

from __future__ import annotations

import re
import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.fleet import Vehicle
from app.models.reference import Brand, Depot, Outlet
from app.services.district_travel import DistrictTravel, district_travel
from app.services.service_allowance import allowances
from app.services.outlet_access import outlet_requires_van

COLOMBO = ZoneInfo("Asia/Colombo")
WINDOW = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\s*$")


@dataclass
class RoutePlan:
    stop_count: int
    ordered_outlet_codes: list[str] = field(default_factory=list)
    estimated_distance_km: float | None = None
    estimated_duration_minutes: float | None = None
    scheduled_elapsed_minutes: float | None = None
    window_feasible: bool | None = None
    source: str = "district_travel.csv"
    missing_districts: list[str] = field(default_factory=list)
    missing_windows: list[str] = field(default_factory=list)
    missing_allowances: list[str] = field(default_factory=list)
    late_outlets: list[str] = field(default_factory=list)
    arrivals: list[dict] = field(default_factory=list)
    route_feasible: bool = False
    estimated_fuel_liters: float | None = None
    total_travel_minutes: float | None = None
    total_service_minutes: float | None = None
    warnings: list[str] = field(default_factory=list)
    violations: list[dict] = field(default_factory=list)
    input_fingerprint: str = ""
    route_fingerprint: str = ""
    departure_time: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class RouteStopInput:
    outlet_code: str
    name: str
    district: str
    windows: tuple[tuple[datetime, datetime], ...]
    service_minutes: float | None
    handling_minutes: float
    access_status: str = "pass"
    access_reason: str = ""


@dataclass(frozen=True)
class RoutePlanRequest:
    depot: Depot
    departure_time: datetime | None
    stops: tuple[RouteStopInput, ...]
    travel: dict[str, DistrictTravel]
    vehicle_id: int | None = None
    km_per_l: float | None = None
    input_warnings: tuple[str, ...] = ()


class RouteProvider(Protocol):
    def plan(self, request: RoutePlanRequest, stop_order: list[str] | None = None) -> RoutePlan: ...


def _parse_window(label: str | None) -> tuple[time, time] | None:
    if not label:
        return None
    match = WINDOW.fullmatch(label)
    if match is None:
        return None
    values = [int(part) for part in match.groups()]
    try:
        start, end = time(values[0], values[1]), time(values[2], values[3])
    except ValueError:
        return None
    return (start, end) if start < end else None


def _windows_for(outlet: Outlet, orders: list[Order], operating_day: date) -> list[tuple[time, time]]:
    """Intersect outlet receiving hours, selected order windows and mall hours."""
    day_windows = [
        (row.opens_at, row.closes_at) for row in outlet.receiving_windows
        if row.weekday == operating_day.weekday() and row.opens_at < row.closes_at
    ]
    if not day_windows and not outlet.receiving_windows and outlet.window_start and outlet.window_end and outlet.window_start < outlet.window_end:
        day_windows = [(outlet.window_start, outlet.window_end)]
    if not day_windows:
        return []
    if outlet.window_start and outlet.window_end and outlet.window_start < outlet.window_end:
        day_windows = [
            (max(start, outlet.window_start), min(end, outlet.window_end))
            for start, end in day_windows if max(start, outlet.window_start) < min(end, outlet.window_end)
        ]
    requested = [_parse_window(order.delivery_window) for order in orders if order.delivery_window]
    if any(window is None for window in requested):
        return []
    mall = _parse_window(outlet.mall_window) if outlet.mall_window else None
    if outlet.mall_window and mall is None:
        return []
    for requirement in [*requested, *([mall] if mall else [])]:
        if requirement is None:
            continue
        day_windows = [
            (max(start, requirement[0]), min(end, requirement[1]))
            for start, end in day_windows if max(start, requirement[0]) < min(end, requirement[1])
        ]
    return sorted(day_windows)


class InternalRouteProvider:
    """Window-aware greedy construction with bounded adjacent-swap improvement.

    District data gives equal inter-stop costs within a district. It does not
    describe cross-district legs, road geometry, live traffic or a return trip.
    Missing evidence is reported, never replaced with invented travel values.
    """

    SOURCE = "internal-window-greedy-v1 / district_travel.csv / service_allowance.csv"
    RISK_MINUTES = 10

    @staticmethod
    def _leg(request: RoutePlanRequest, previous: RouteStopInput | None, stop: RouteStopInput):
        row = request.travel.get(stop.district)
        if row is None or (previous is not None and previous.district != stop.district):
            return None, None
        return ((row.depot_to_district_freeflow_min, row.depot_to_district_km)
                if previous is None else (row.inter_stop_freeflow_min, row.inter_stop_km))

    @staticmethod
    def _visit(stop: RouteStopInput, arrival: datetime):
        service = (stop.service_minutes or 0) + stop.handling_minutes
        for start, end in stop.windows:
            service_start = max(start, arrival)
            depart = service_start + timedelta(minutes=service)
            if depart <= end:
                return service_start, depart, start, end, True
        if stop.windows:
            start, end = stop.windows[-1]
            service_start = max(start, arrival)
            return service_start, service_start + timedelta(minutes=service), start, end, False
        return arrival, arrival + timedelta(minutes=service), None, None, False

    def _evaluate(self, request: RoutePlanRequest, stops: list[RouteStopInput]) -> RoutePlan:
        result = RoutePlan(stop_count=len(stops), ordered_outlet_codes=[s.outlet_code for s in stops],
                           source=self.SOURCE, warnings=list(request.input_warnings))
        result.input_fingerprint = hashlib.sha256(json.dumps(asdict(request), default=str, sort_keys=True).encode()).hexdigest()
        result.route_fingerprint = hashlib.sha256((result.input_fingerprint + "|" + "|".join(result.ordered_outlet_codes)).encode()).hexdigest()
        departure = request.departure_time
        if departure is not None and departure.tzinfo is not None:
            departure = departure.astimezone(COLOMBO)
            result.departure_time = departure.isoformat()
        else:
            departure = None
            result.warnings.append("A timezone-aware departure time is required.")
        current = departure
        previous = None
        travel_total = service_total = distance = 0.0
        travel_known = service_known = True
        for stop in stops:
            minutes, km = self._leg(request, previous, stop)
            if minutes is None:
                result.missing_districts.append(stop.district or "unspecified")
                travel_known = False
                current = None
            else:
                travel_total += minutes
                distance += km
            if stop.service_minutes is None:
                service_known = False
                result.missing_allowances.append(stop.outlet_code)
            else:
                service_total += stop.service_minutes + stop.handling_minutes
            if not stop.windows:
                result.missing_windows.append(stop.outlet_code)
            arrival = current + timedelta(minutes=minutes) if current is not None and minutes is not None else None
            start = end = service_start = depart = None
            missing = []
            if departure is None:
                missing.append("Departure time is missing.")
            if minutes is None:
                missing.append(f"No supported district travel estimate to {stop.district or 'this outlet'}.")
            if stop.service_minutes is None:
                missing.append("Service allowance is missing.")
            if not stop.windows:
                missing.append("No usable receiving window for this date and selected orders.")
            if arrival is None and not missing:
                missing.append("Arrival cannot be calculated after an unverified preceding stop.")
            window_status, reason, slack = "FAIL", " ".join(missing), None
            if arrival is not None and stop.service_minutes is not None and stop.windows:
                service_start, depart, start, end, feasible = self._visit(stop, arrival)
                slack = round((end - depart).total_seconds() / 60, 2)
                window_status = ("AT_RISK" if slack <= self.RISK_MINUTES else "PASS") if feasible else "FAIL"
                reason = (f"Service completes with only {slack:g} minutes of window margin." if window_status == "AT_RISK"
                          else "Service completes within the receiving window." if feasible
                          else "Travel and handling cannot complete before the receiving window closes.")
                if not feasible:
                    result.late_outlets.append(stop.outlet_code)
                elif window_status == "AT_RISK":
                    result.warnings.append(f"{stop.outlet_code}: only {slack:g} minutes of window margin.")
            if window_status == "FAIL":
                result.violations.append({"outlet_code": stop.outlet_code, "constraint": "DELIVERY_WINDOW", "message": reason})
            if stop.access_status != "pass":
                result.violations.append({"outlet_code": stop.outlet_code, "constraint": "ACCESS", "message": stop.access_reason})
            result.arrivals.append({
                "outlet_code": stop.outlet_code, "name": stop.name,
                "arrival_at": arrival.isoformat() if arrival else None,
                "service_start_at": service_start.isoformat() if service_start else None,
                "window_start": start.isoformat() if start else None,
                "window_end": end.isoformat() if end else None,
                "service_minutes": stop.service_minutes, "handling_minutes": stop.handling_minutes,
                "depart_at": depart.isoformat() if depart else None,
                "window_status": window_status, "within_window": window_status != "FAIL",
                "slack_minutes": slack, "travel_minutes": minutes, "travel_distance_km": km,
                "access_status": stop.access_status, "reason": reason,
            })
            current, previous = depart, stop
        result.missing_districts = sorted(set(result.missing_districts))
        result.total_travel_minutes = round(travel_total, 2) if travel_known and stops else None
        result.total_service_minutes = round(service_total, 2) if service_known and stops else None
        if travel_known and stops:
            result.estimated_distance_km = round(distance, 2)
            if request.km_per_l is not None and request.km_per_l > 0:
                result.estimated_fuel_liters = round(distance / request.km_per_l, 2)
            else:
                result.warnings.append("Vehicle fuel efficiency is unavailable; fuel cannot be estimated.")
        if travel_known and service_known and stops:
            result.estimated_duration_minutes = round(travel_total + service_total, 2)
        if current is not None and departure is not None:
            result.scheduled_elapsed_minutes = round((current - departure).total_seconds() / 60, 2)
        unknown = not stops or departure is None or result.missing_districts or result.missing_windows or result.missing_allowances
        result.window_feasible = None if unknown else not result.late_outlets
        result.route_feasible = result.window_feasible is True and not result.violations and not request.input_warnings
        result.warnings.append("District estimates; no exact road legs, live traffic or return-to-depot leg.")
        return result

    @staticmethod
    def _score(result: RoutePlan):
        return (sum(s["window_status"] == "FAIL" for s in result.arrivals),
                sum(s["window_status"] == "AT_RISK" for s in result.arrivals),
                result.scheduled_elapsed_minutes if result.scheduled_elapsed_minutes is not None else float("inf"),
                result.estimated_distance_km if result.estimated_distance_km is not None else float("inf"))

    def plan(self, request: RoutePlanRequest, stop_order: list[str] | None = None) -> RoutePlan:
        by_code = {stop.outlet_code: stop for stop in request.stops}
        if stop_order is not None:
            if len(stop_order) != len(by_code) or set(stop_order) != set(by_code):
                raise ValueError("Stop order must contain every active outlet exactly once.")
            return self._evaluate(request, [by_code[code] for code in stop_order])
        remaining = sorted(request.stops, key=lambda stop: stop.outlet_code)
        current, previous, ordered = request.departure_time, None, []
        if current is None or current.tzinfo is None:
            return self._evaluate(request, remaining)
        while remaining:
            def rank(stop):
                minutes, _ = self._leg(request, previous, stop)
                if minutes is None or stop.service_minutes is None or not stop.windows:
                    return (2, len(remaining), float("inf"), float("inf"), float("inf"), stop.outlet_code)
                _, depart, _, end, fits = self._visit(stop, current + timedelta(minutes=minutes))
                # Look ahead: avoid consuming another stop's last viable window.
                endangered = 0
                for other in remaining:
                    if other is stop or not other.windows:
                        continue
                    next_minutes, _ = self._leg(request, stop, other)
                    if next_minutes is None or not self._visit(other, depart + timedelta(minutes=next_minutes))[4]:
                        endangered += 1
                slack = (end - depart).total_seconds() / 60
                urgency = slack if slack <= 30 else float("inf")
                return (0 if fits else 1, endangered, urgency,
                        (depart - current).total_seconds(), end.timestamp(), stop.outlet_code)
            selected = min(remaining, key=rank)
            ordered.append(selected)
            remaining.remove(selected)
            minutes, _ = self._leg(request, previous, selected)
            if minutes is not None:
                current = self._visit(selected, current + timedelta(minutes=minutes))[1]
            previous = selected
        best = self._evaluate(request, ordered)
        # Strictly improving adjacent swaps; bounded work, stable tie breaking.
        for _ in range(2):
            improved = False
            for index in range(len(ordered) - 1):
                candidate = ordered.copy()
                candidate[index], candidate[index + 1] = candidate[index + 1], candidate[index]
                evaluated = self._evaluate(request, candidate)
                if self._score(evaluated) < self._score(best):
                    ordered, best, improved = candidate, evaluated, True
            if not improved:
                break
        return best


class RoutePlanningService:
    """ORM adapter plus provider boundary shared by allocations and dispatch."""

    def __init__(self, provider: RouteProvider | None = None):
        self.provider = provider or InternalRouteProvider()

    def plan(self, db: Session, orders: list[Order], depot: Depot, departure_time: datetime | None,
             vehicle: Vehicle | None = None, stop_order: list[str] | None = None) -> RoutePlan:
        by_outlet: dict[int, list[Order]] = {}
        outlets: dict[int, Outlet] = {}
        warnings = []
        for order in sorted(orders, key=lambda item: item.id):
            if order.outlet is None:
                warnings.append(f"{order.order_number} has no outlet.")
            else:
                outlets[order.outlet.id] = order.outlet
                by_outlet.setdefault(order.outlet.id, []).append(order)
        table = {district: row for (row_depot, district), row in district_travel().items() if row_depot == depot}
        allowance_table = allowances()
        local = departure_time.astimezone(COLOMBO) if departure_time is not None and departure_time.tzinfo else None
        stops = []
        for outlet in sorted(outlets.values(), key=lambda item: item.code):
            orders_here = by_outlet[outlet.id]
            windows = _windows_for(outlet, orders_here, local.date()) if local else []
            services = []
            for order in orders_here:
                try:
                    brand = Brand(order.brand.strip().lower()) if order.brand else outlet.brand
                except ValueError:
                    brand = outlet.brand
                services.append(allowance_table.get((brand, outlet.dock_type)))
            district = (outlet.district or "").strip().casefold()
            travel = table.get(district)
            access, access_reason = "pass", ""
            if outlet.active is False or outlet.depot != depot:
                access, access_reason = "fail", "Outlet is inactive or belongs to another depot."
            elif vehicle and outlet_requires_van(outlet) and vehicle.vehicle_type.strip().lower() != "van":
                access, access_reason = "fail", "Van required for outlet access."
            elif (outlet.delivery_restrictions or "").strip() or (outlet.parking_constraint or "normal").strip().lower() not in ("normal", "van_only"):
                access, access_reason = "unknown", "Outlet access restrictions require structured rules."
            stops.append(RouteStopInput(
                outlet_code=outlet.code, name=outlet.name, district=district,
                windows=tuple((datetime.combine(local.date(), start, COLOMBO), datetime.combine(local.date(), end, COLOMBO)) for start, end in windows),
                service_minutes=sum(services) if all(value is not None for value in services) else None,
                # Official per-order inter-stop allowance: extra orders at one
                # outlet add handling (inside the window), not extra kilometres.
                handling_minutes=travel.inter_stop_freeflow_min * (len(orders_here) - 1) if travel else 0,
                access_status=access, access_reason=access_reason,
            ))
        used_districts = {stop.district for stop in stops}
        request = RoutePlanRequest(depot=depot, departure_time=local, stops=tuple(stops),
                                   travel={key: value for key, value in table.items() if key in used_districts},
                                   vehicle_id=vehicle.id if vehicle else None,
                                   km_per_l=float(vehicle.km_per_l) if vehicle and vehicle.km_per_l is not None else None, input_warnings=tuple(warnings))
        return self.provider.plan(request, stop_order)


route_planning_service = RoutePlanningService()
