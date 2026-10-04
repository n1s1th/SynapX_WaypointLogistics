"""Bridge the route provider to persisted dispatcher and Loader plans."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.fleet import Vehicle
from app.models.order import Order
from app.models.reference import Depot
from app.models.shipment import DispatchTrip
from app.services.route_planning import RoutePlan, route_planning_service


def aware_utc(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def stop_sequence(route: dict) -> list[dict]:
    """Compatibility shape for existing Dispatcher/Driver stop consumers."""
    return [
        {**stop, "id": stop["outlet_code"], "eta": stop["arrival_at"] or "",
         "sla_ok": stop["window_status"] == "PASS", "sla_note": stop["window_status"].replace("_", " ")}
        for stop in route["arrivals"]
    ]


def route_for_trip(db: Session, trip: DispatchTrip, *, order: list[str] | None = None,
                   departure: datetime | None = None) -> RoutePlan:
    from app.services.loader_service import loader_service

    dock_run = loader_service.run_for_dispatch_trip(db, trip.id)
    orders = ([row.order for row in loader_service._active_rows(db, dock_run).values()] if dock_run else
              db.query(Order).filter(Order.allocation_id == trip.allocation_id).order_by(Order.id).all()
              if trip.allocation_id else [])
    vehicle = db.get(Vehicle, trip.vehicle_id) if trip.vehicle_id else None
    try:
        depot = Depot((trip.depot_name or "").strip().lower())
        return route_planning_service.plan(db, orders, depot, aware_utc(departure or trip.departure_time), vehicle, order)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "ROUTE_INPUT_INVALID", "message": str(exc)}) from exc


def current_stop_codes(db: Session, trip: DispatchTrip) -> list[str]:
    from app.services.loader_service import loader_service

    dock_run = loader_service.run_for_dispatch_trip(db, trip.id)
    if dock_run:
        active = {row.run_stop.outlet.code for row in loader_service._active_rows(db, dock_run).values()}
        return [stop.outlet.code for stop in sorted(loader_service.current_stops(db, dock_run), key=lambda s: s.stop_sequence)
                if stop.outlet.code in active]
    codes = [entry.get("outlet_code") if isinstance(entry, dict) else entry for entry in trip.stop_sequence or []]
    return list(dict.fromkeys(code for code in codes if code))


def preview_routes(db: Session, trip: DispatchTrip, stop_order: list[str] | None = None) -> dict:
    from app.services.loader_service import loader_service

    codes = current_stop_codes(db, trip)
    current = route_for_trip(db, trip, order=codes or None)
    proposed = route_for_trip(db, trip, order=stop_order)
    # A heuristic should never suggest a route that scores worse than current.
    from app.services.route_planning import InternalRouteProvider
    if stop_order is None and InternalRouteProvider._score(current) < InternalRouteProvider._score(proposed):
        proposed = current
    dock_run = loader_service.run_for_dispatch_trip(db, trip.id)
    return {"current": current.as_dict(), "proposed": proposed.as_dict(),
            "base_version": dock_run.current_plan_version if dock_run else 0,
            "current_route_fingerprint": current.route_fingerprint}


def require_feasible(route: RoutePlan):
    if not route.route_feasible:
        raise HTTPException(status_code=422, detail={
            "code": "ROUTE_INFEASIBLE", "message": "Route cannot be applied. Resolve failed or unknown constraints first.",
            "violations": route.violations, "route": route.as_dict(),
        })


def persist_trip_route(db: Session, trip: DispatchTrip, route: RoutePlan):
    from app.services.loader_service import loader_service

    trip.route_plan = route.as_dict()
    trip.stop_sequence = stop_sequence(trip.route_plan)
    trip.stop_count = route.stop_count
    last = route.arrivals[-1] if route.arrivals else None
    trip.estimated_arrival = (datetime.fromisoformat(last["depart_at"]).astimezone(timezone.utc).replace(tzinfo=None)
                              if last and last["depart_at"] else None)
    dock_run = loader_service.run_for_dispatch_trip(db, trip.id)
    if dock_run:
        loader_service.apply_route_timing(db, dock_run, trip.route_plan)
