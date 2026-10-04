"""Explainable candidate ranking, separate from hard feasibility."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models.allocation import Allocation
from app.models.fleet import Vehicle
from app.models.order import Order
from app.models.reference import Depot, Dock
from app.services.allocation_constraints import ConstraintFacts, allocation_constraint_service
from app.services.order_grouping import order_grouping_service
from app.services.route_planning import route_planning_service

SCORE_WEIGHTS = {
    "capacity_fit": 55,
    "trip_availability": 25,
    "route_fuel_efficiency": 20,
}


def _score(constraints: dict, best_km_per_l: float) -> tuple[int, dict]:
    weight = constraints["weight"]
    volume = constraints["volume"]
    trips = constraints["trips_today"]
    # 75% utilization is a useful planning target without rewarding overfill.
    utilization = max(weight["required"] / weight["capacity"], volume["required"] / volume["capacity"])
    capacity_fit = max(0.0, 1.0 - abs(utilization - 0.75) / 0.75)
    trip_availability = (settings.ALLOCATION_MAX_TRIPS_PER_DAY - trips["trips_on_date"]) / settings.ALLOCATION_MAX_TRIPS_PER_DAY
    # The same route is compared across vehicles by fuel economy, not by a
    # fabricated road-distance adjustment.
    km_per_l = constraints["fuel"].get("km_per_l") or 0.0
    route_efficiency = min(1.0, km_per_l / best_km_per_l) if best_km_per_l > 0 else 0.0
    factors = {
        "capacity_fit": round(capacity_fit, 3),
        "trip_availability": round(trip_availability, 3),
        "route_fuel_efficiency": round(route_efficiency, 3),
    }
    return round(sum(SCORE_WEIGHTS[name] * factors[name] for name in SCORE_WEIGHTS)), factors


class AllocationRecommendationService:
    @staticmethod
    def recommend(db: Session, order_ids: list[int], depot: Depot, departure_time: datetime | None) -> dict:
        group = order_grouping_service.load_selected(db, order_ids, depot)
        # Sequencing depends on windows/travel/service, not vehicle fuel economy.
        # Construct it once; evaluate that exact sequence for each vehicle.
        shared_route = route_planning_service.plan(db, group.orders, depot, departure_time)
        vehicles = db.query(Vehicle).options(selectinload(Vehicle.driver)).filter(
            Vehicle.depot_name == depot.value
        ).order_by(Vehicle.code).all()
        vehicle_ids = [vehicle.id for vehicle in vehicles]
        allocations_by_vehicle = {vehicle_id: [] for vehicle_id in vehicle_ids}
        if vehicle_ids:
            for allocation in db.query(Allocation).options(selectinload(Allocation.orders).selectinload(Order.outlet)).filter(Allocation.vehicle_id.in_(vehicle_ids)).all():
                allocations_by_vehicle[allocation.vehicle_id].append(allocation)
        dock_exists = db.query(Dock.id).filter(Dock.depot == depot).first() is not None
        best_km_per_l = max((vehicle.km_per_l for vehicle in vehicles if vehicle.km_per_l and vehicle.km_per_l > 0), default=0.0)
        candidates = []
        for vehicle in vehicles:
            route = route_planning_service.plan(db, group.orders, depot, departure_time, vehicle,
                                               shared_route.ordered_outlet_codes)
            facts = ConstraintFacts(allocations_by_vehicle[vehicle.id], dock_exists)
            report = allocation_constraint_service.validate(db, group, vehicle, departure_time, route, facts=facts)
            if report.eligible:
                score, factors = _score(report.constraints, best_km_per_l)
                level = "BEST_MATCH" if score >= 85 else ("GOOD_MATCH" if score >= 65 else "LOW_MATCH")
                reasons = ["All hard constraints pass", "Load fits vehicle weight and volume limits"]
            else:
                score, factors, level = None, {}, "INELIGIBLE"
                reasons = [item["message"] for item in report.violations]
            candidates.append({
                "vehicle_id": vehicle.id,
                "vehicle_code": vehicle.code,
                "eligible": report.eligible,
                "recommendation_score": score,
                "recommendation_level": level,
                "score_factors": factors,
                "constraints": report.constraints,
                "route_summary": route.as_dict(),
                "reasons": reasons,
            })
        candidates.sort(key=lambda item: (not item["eligible"], -(item["recommendation_score"] or -1), item["vehicle_code"]))
        return {"order_group": group.as_dict(), "group_violations": group.violations, "vehicles": candidates}


allocation_recommendation_service = AllocationRecommendationService()
