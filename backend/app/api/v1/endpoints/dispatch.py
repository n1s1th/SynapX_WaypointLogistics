from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from app.api import deps
from app.models.shipment import DispatchTrip
from app.models.allocation import Allocation, AllocationStatus
from app.models.fleet import DriverProfile
from app.models.reference import Depot, Dock, Outlet
from app.schemas.shipment import DispatchTripCreate, DispatchTripRead, DeliveryRunResponse, DeliveryRunUpdate, LoadingEventIn
from app.models.order import Order, OrderItem
from app.services.loader_service import RunNotBuildableError, loader_service
from app.schemas.loader import DispatcherPlanRequest
from app.services.dispatch_route_planning import (
    aware_utc, current_stop_codes, persist_trip_route, preview_routes,
    require_feasible, route_for_trip, stop_sequence as route_stop_sequence,
)
from app.services.route_planning import RoutePlan, route_planning_service


class PlanSyncRequest(BaseModel):
    plan: DispatcherPlanRequest
    stop_sequence: Optional[List[Dict[str, Any]]] = None
    route_fingerprint: Optional[str] = None
    current_route_fingerprint: Optional[str] = None


class RoutePreviewRequest(BaseModel):
    stop_order: Optional[List[str]] = None
from app.models.order import Order, OrderItem, OrderStatus
from app.services.loader_service import loader_service
from app.services.order_service import order_service
from app.services.user_notification_service import notify_user

from app.services.order_service import order_service
router = APIRouter()

def _with_loader(db: Session, trips: List[DispatchTrip]) -> List[DeliveryRunResponse]:
    views = loader_service.dispatcher_view(db, [t.id for t in trips])
    out = []
    for t in trips:
        item = DeliveryRunResponse.model_validate(t)
        view = views.get(t.id)
        item.loader = view.model_dump(mode="json") if view else None
        if view is not None:
            item.open_shortfalls = view.open_shortfalls
            item.stops_completed = view.stops_completed
            item.stop_count = view.stop_count
        if view is not None and not item.stop_sequence:
            dock_run = loader_service.run_for_dispatch_trip(db, t.id)
            if dock_run is not None:
                item.stop_sequence = _dock_stop_sequence(db, dock_run)
                item.stop_count = len(item.stop_sequence)
        if view is None:
            item.loader_warning = next(
                (event.get("note") for event in reversed(t.loading_events or [])
                 if event.get("event") == "Dock run unavailable"),
                None,
            )
        out.append(item)
    return out


def _dock_stop_sequence(db: Session, dock_run) -> List[Dict[str, Any]]:
    return [
        {"id": stop.outlet.code, "outlet_code": stop.outlet.code,
         "name": stop.outlet.name, "eta": stop.eta.isoformat() if stop.eta else "",
         "sla_ok": False, "sla_note": "Window feasibility not evaluated"}
        for stop in sorted(loader_service.current_stops(db, dock_run), key=lambda stop: stop.stop_sequence)
    ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_sync_status(run: DispatchTrip) -> dict:
    """
    Derive driver sync health from the run's metadata.
    A real implementation would use a websocket heartbeat table;
    here we infer from the loading_events and updated_at timestamp.
    """
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    updated = run.updated_at

    # Make updated_at timezone-aware if it isn't
    if updated and updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)

    stale_threshold = timedelta(minutes=15)
    conflict_threshold = timedelta(minutes=30)

    if updated is None:
        sync_status = "unknown"
    elif now - updated > conflict_threshold:
        sync_status = "conflict"
    elif now - updated > stale_threshold:
        sync_status = "degraded"
    else:
        sync_status = "ok"

    last_update_mins = int((now - updated).total_seconds() / 60) if updated else None
    return {
        "sync_status": sync_status,
        "last_update_mins": last_update_mins,
    }


@router.get("/", response_model=List[DeliveryRunResponse])
def list_delivery_runs(
    status: Optional[str] = None,
    depot: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    depot_scope: Depot = Depends(deps.get_dispatcher_depot),
):
    query = db.query(DispatchTrip).filter(DispatchTrip.depot_name == depot_scope.value)
    if status:
        query = query.filter(DispatchTrip.status == status)
    if depot:
        query = query.filter(DispatchTrip.depot_name == depot)
    
    trips = query.offset(skip).limit(limit).all()
    return _with_loader(db, trips)


@router.get("/live")
def get_live_runs(
    db: Session = Depends(deps.get_db),
    depot_scope: Depot = Depends(deps.get_dispatcher_depot),
):
    """
    Returns all actively moving runs (en_route) enriched with sync health status.
    Used by the Live Tracking page to show real-time dispatcher visibility.
    """
    runs = (
        db.query(DispatchTrip)
        .filter(DispatchTrip.status.in_(["en_route", "scheduled", "ready"]))
        .filter(DispatchTrip.depot_name == depot_scope.value)
        .order_by(DispatchTrip.departure_time.asc())
        .all()
    )

    result = []
    for run in runs:
        sync = _compute_sync_status(run)
        result.append({
            "id": run.id,
            "trip_code": run.trip_code,
            "vehicle_number": run.vehicle_number,
            "driver_name": run.driver_name,
            "depot_name": run.depot_name,
            "origin": run.origin,
            "destination": run.destination,
            "status": run.status,
            "departure_time": run.departure_time.isoformat() if run.departure_time else None,
            "estimated_arrival": run.estimated_arrival.isoformat() if run.estimated_arrival else None,
            "stop_count": run.stop_count,
            "stops_completed": run.stops_completed,
            "stop_sequence": run.stop_sequence or [],
            "open_shortfalls": run.open_shortfalls,
            "loading_events": run.loading_events or [],
            "total_weight_kg": run.total_weight_kg,
            "total_volume_m3": run.total_volume_m3,
            "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            # Enriched fields
            "sync_status": sync["sync_status"],
            "last_update_mins": sync["last_update_mins"],
        })
    return result


@router.get("/docks", response_model=list[dict])
def list_docks(
    db: Session = Depends(deps.get_db),
    depot_scope: Depot = Depends(deps.get_dispatcher_depot),
):
    docks = db.query(Dock).filter(Dock.depot == depot_scope).all()
    return [{"id": d.id, "code": d.code, "name": d.name} for d in docks]


@router.get("/{id}", response_model=DeliveryRunResponse)
def get_delivery_run(
    id: int,
    db: Session = Depends(deps.get_db),
    depot_scope: Depot = Depends(deps.get_dispatcher_depot),
):
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id, DispatchTrip.depot_name == depot_scope.value).first()
    if not run:
        raise HTTPException(status_code=404, detail="Delivery run not found")
    return _with_loader(db, [run])[0]


@router.post("/", response_model=DeliveryRunResponse, status_code=status.HTTP_201_CREATED)
def create_delivery_run(
    trip_in: DispatchTripCreate,
    db: Session = Depends(deps.get_db),
    # current_user = Depends(deps.require_dispatcher_or_admin)
):
    trip = DispatchTrip(**trip_in.model_dump())
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


@router.patch("/{id}", response_model=DeliveryRunResponse)
def update_delivery_run(
    id: int,
    trip_in: DeliveryRunUpdate,
    db: Session = Depends(deps.get_db),
    # current_user = Depends(deps.require_dispatcher_or_admin)
):
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Delivery run not found")

    update_data = trip_in.model_dump(exclude_unset=True)
    if "stop_sequence" in update_data or "departure_time" in update_data:
        raise HTTPException(status_code=422, detail="Use the plan endpoint to validate route or departure changes.")
    if update_data.get("status") == "en_route" and run.allocation_id and not loader_service.run_for_dispatch_trip(db, run.id):
        raise HTTPException(status_code=409, detail="Send the run to a dock before publishing it")
    previous_status = run.status
    for field, value in update_data.items():
        setattr(run, field, value)

    # Store Manager integration: When run goes en_route
    if update_data.get("status") == "en_route":
        # 1. Set ETA if not already set
        if not run.estimated_arrival and run.departure_time:
            minutes_per_stop = 30
            eta_delta = timedelta(minutes=minutes_per_stop * max(run.stop_count or 1, 1))
            run.estimated_arrival = run.departure_time + eta_delta

        # 2. Update all orders for this allocation to DISPATCHED
        if run.allocation_id:
            orders = db.query(Order).filter(
                Order.allocation_id == run.allocation_id,
                Order.status.in_([OrderStatus.ALLOCATED, OrderStatus.PROCESSING, OrderStatus.READY_FOR_DISPATCH])
            ).all()
            for order in orders:
                # Fast-forward through missing physical states to satisfy the state machine
                if order.status == OrderStatus.ALLOCATED:
                    order_service.update_order_status(db, order.id, OrderStatus.PROCESSING, commit=False)
                if order.status == OrderStatus.PROCESSING:
                    order_service.update_order_status(db, order.id, OrderStatus.READY_FOR_DISPATCH, commit=False)
                if order.status == OrderStatus.READY_FOR_DISPATCH:
                    order_service.update_order_status(db, order.id, OrderStatus.DISPATCHED, commit=False)

    # Explicitly touch updated_at — onupdate lambda only fires on DB-level flush
    run.updated_at = datetime.now(timezone.utc)

    db.add(run)
    db.commit()

    # En route is handled above. A run closed straight to "completed" here means its stores got their goods.
    if run.status == "completed" and previous_status != "completed":
        order_service.mark_trip_delivered(db, run.allocation_id)

    db.refresh(run)
    return run


@router.post("/{id}/plan", response_model=DeliveryRunResponse)
def sync_delivery_plan(id: int, payload: PlanSyncRequest, db: Session = Depends(deps.get_db),
                       depot: Depot = Depends(deps.get_dispatcher_depot),
                       _=Depends(deps.require_dispatcher_or_admin)):
    """Publish the dock plan and update its dispatch trip in one transaction."""
    trip = db.query(DispatchTrip).filter(DispatchTrip.id == id, DispatchTrip.depot_name == depot.value).with_for_update().first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Delivery run not found")

    if payload.stop_sequence is not None:
        codes = [stop.get("outlet_code") for stop in payload.stop_sequence]
        if not codes or any(not code for code in codes) or codes != payload.plan.stop_order:
            raise HTTPException(status_code=422, detail="Stop sequence must match the outlet codes in the dock plan")

    with db.begin_nested():
        loader_run = loader_service.run_for_dispatch_trip(db, trip.id)
        if loader_run is not None:
            # Preserve Loader's lock, version/replay checks, reversal and acknowledgement.
            _, replayed = loader_service.publish_dispatcher_plan(db, loader_run, payload.plan)
            if replayed:
                return _with_loader(db, [trip])[0]
        elif payload.current_route_fingerprint:
            before = route_for_trip(db, trip, order=current_stop_codes(db, trip) or None)
            if before.route_fingerprint != payload.current_route_fingerprint:
                raise HTTPException(status_code=409, detail={"code": "ROUTE_STALE", "message": "Route changed. Refresh the preview."})
        if payload.plan.departs_at is not None:
            trip.departure_time = aware_utc(payload.plan.departs_at).astimezone(timezone.utc).replace(tzinfo=None)
        route = route_for_trip(db, trip, order=payload.plan.stop_order or current_stop_codes(db, trip) or None)
        require_feasible(route)
        if payload.route_fingerprint and route.route_fingerprint != payload.route_fingerprint:
            raise HTTPException(status_code=409, detail={"code": "ROUTE_STALE", "message": "Routing inputs changed. Review a fresh preview."})
        persist_trip_route(db, trip, route)
        trip.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(trip)
    return _with_loader(db, [trip])[0]


@router.post("/{id}/route-preview")
def preview_delivery_route(id: int, payload: RoutePreviewRequest, db: Session = Depends(deps.get_db),
                           depot: Depot = Depends(deps.get_dispatcher_depot),
                           _=Depends(deps.require_dispatcher_or_admin)):
    trip = db.query(DispatchTrip).filter(DispatchTrip.id == id, DispatchTrip.depot_name == depot.value).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Delivery run not found")
    return preview_routes(db, trip, payload.stop_order)


@router.post("/from-allocation/{allocation_id}", response_model=DeliveryRunResponse, status_code=status.HTTP_201_CREATED)
def create_run_from_allocation(
    allocation_id: int,
    dock_code: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    # current_user = Depends(deps.require_dispatcher_or_admin)
):
    """
    Dispatch an allocation: atomically creates a DispatchTrip (Delivery Run)
    from an existing allocation and marks the allocation as DISPATCHED.
    Idempotent — if a run already exists for this allocation, returns it.
    """
    allocation = (
        db.query(Allocation)
        .options(joinedload(Allocation.vehicle), joinedload(Allocation.driver).joinedload(DriverProfile.user))
        .filter(Allocation.id == allocation_id)
        .first()
    )
    if not allocation:
        raise HTTPException(status_code=404, detail="Allocation not found")

    # A retry returns the trip, including any dock warning, even after the
    # allocation has been marked DISPATCHED.
    existing = db.query(DispatchTrip).filter(DispatchTrip.allocation_id == allocation_id).first()
    if existing:
        return _with_loader(db, [existing])[0]

    # Allow dispatching (sending to dock) from ALLOCATED, READY, or LOADING states
    if allocation.status not in (AllocationStatus.ALLOCATED, AllocationStatus.READY, AllocationStatus.LOADING):
        raise HTTPException(
            status_code=400,
            detail=f"Allocation must be READY or LOADING to dispatch (current: {allocation.status})"
        )

    # Build the trip code from the allocation's run_id or generate one
    trip_code = allocation.run_id or f"RUN-{allocation_id:04d}"

    # Resolve driver name from the linked DriverProfile → User
    driver_name = "Unassigned"
    if allocation.driver and allocation.driver.user:
        driver_name = allocation.driver.user.full_name or "Unassigned"

    # Resolve vehicle fields
    vehicle = allocation.vehicle
    vehicle_number = vehicle.code if vehicle else "UNKNOWN"
    depot_name = vehicle.depot_name if vehicle else None

    # Fetch orders to compute totals and stop sequence
    from app.models.order import Order
    orders = db.query(Order).options(joinedload(Order.outlet)).filter(Order.allocation_id == allocation.id).all()
    total_weight = sum(o.weight_kg for o in orders if o.weight_kg)
    total_volume = sum(o.volume_m3 for o in orders if o.volume_m3)
    
    # Preserve the confirmed sequence and evidence. If planning inputs changed
    # since confirmation, require review rather than silently replacing the route.
    calculated_route = route_planning_service.plan(
        db, orders, Depot(depot_name), aware_utc(allocation.departure_time), vehicle,
        allocation.planned_stop_codes or None,
    )
    if allocation.route_plan and calculated_route.input_fingerprint != allocation.route_plan.get("input_fingerprint"):
        raise HTTPException(status_code=409, detail={
            "code": "ALLOCATION_ROUTE_STALE", "message": "Routing inputs changed after confirmation. Review the allocation again.",
        })
    route_snapshot = allocation.route_plan or calculated_route.as_dict()
    stop_sequence = route_stop_sequence(route_snapshot)
    trip = DispatchTrip(
        trip_code=trip_code,
        allocation_id=allocation.id,
        vehicle_id=allocation.vehicle_id,
        driver_id=allocation.driver_id,
        vehicle_number=vehicle_number,
        driver_name=driver_name,
        origin=depot_name or "depot",
        destination="multiple stops",
        depot_name=depot_name,
        status="scheduled",
        departure_time=allocation.departure_time,
        total_weight_kg=total_weight,
        total_volume_m3=total_volume,
        stop_count=len(stop_sequence),
        stops_completed=0,
        stop_sequence=stop_sequence,
        route_plan=route_snapshot,
        open_shortfalls=0,
        loading_events=[
            {
                "event": "Dispatch trip created",
                "time": datetime.now(timezone.utc).strftime("%H:%M"),
                "note": f"Dispatched from allocation #{allocation_id}",
                "status": "ok"
            }
        ],
    )
    db.add(trip)

    # Mark allocation as LOADING since it is now sent to the dock
    allocation.status = AllocationStatus.LOADING
    db.add(allocation)

    db.flush()
    persist_trip_route(db, trip, RoutePlan(**route_snapshot))
    try:
        with db.begin_nested():
            dock_run = loader_service.create_run_for_dispatch_trip(db, trip, dock_code=dock_code)
    except Exception as exc:
        reasons = (
            "; ".join(v["message"] for v in exc.details.get("violations", []))
            if isinstance(exc, RunNotBuildableError) else ""
        )
        warning = reasons or getattr(exc, "message", str(exc))
        trip.loading_events = [
            *(trip.loading_events or []),
            {"event": "Dock run unavailable", "time": datetime.now(timezone.utc).strftime("%H:%M"),
             "note": warning, "status": "warning"},
        ]
    else:
        # Keep the planner's ETA/window evidence; Loader consumes the same order.
        trip.stop_count = len(trip.stop_sequence)
        trip.loading_events = [
            *(trip.loading_events or []),
            {"event": "Dock plan published", "time": datetime.now(timezone.utc).strftime("%H:%M"),
             "note": f"Sent to {dock_run.dock.name}", "status": "ok"},
        ]

    if allocation.driver and allocation.driver.user_id:
        notify_user(
            db, recipient_user_id=allocation.driver.user_id, event_key=f"dispatch-trip:{trip.id}",
            category="delivery", title=f"Trip {trip.trip_code} assigned",
            message=f"Your delivery trip from {depot_name or 'the depot'} is scheduled.",
            target_url="/driver",
        )
    db.commit()
    db.refresh(trip)
    return _with_loader(db, [trip])[0]


@router.post("/{id}/add-loading-event", response_model=DeliveryRunResponse)
def add_loading_event(
    id: int,
    event_in: LoadingEventIn,
    db: Session = Depends(deps.get_db),
):
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    events = list(run.loading_events or [])
    events.append(event_in.model_dump())
    run.loading_events = events
    run.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


@router.post("/{id}/send-to-exceptions", response_model=DeliveryRunResponse)
def send_to_exceptions(
    id: int,
    db: Session = Depends(deps.get_db),
):
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    now_str = datetime.now(timezone.utc).strftime("%H:%M")
    events = list(run.loading_events or [])
    events.append({
        "event": "Sent to exceptions",
        "time": now_str,
        "note": "Shortfall escalated by dispatcher",
        "status": "warning"
    })
    run.loading_events = events
    run.open_shortfalls = 0
    run.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


@router.get("/{id}/manifest")
def get_manifest(
    id: int,
    db: Session = Depends(deps.get_db),
):
    """
    Returns the manifest for a delivery run — all orders assigned to the
    allocation that created this run, with their line items.
    """
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if not run.allocation_id:
        return {
            "run_id": id,
            "trip_code": run.trip_code,
            "orders": [],
            "total_weight_kg": run.total_weight_kg,
            "total_volume_m3": run.total_volume_m3,
        }

    orders = (
        db.query(Order)
        .options(joinedload(Order.items))
        .filter(Order.allocation_id == run.allocation_id)
        .all()
    )

    orders_payload = []
    for o in orders:
        orders_payload.append({
            "id": o.id,
            "order_number": o.order_number,
            "client_name": o.client_name,
            "destination_address": o.destination_address,
            "status": o.status.value if hasattr(o.status, 'value') else str(o.status),
            "total_amount": o.total_amount,
            "items": [
                {
                    "sku": item.sku,
                    "item_name": item.item_name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                }
                for item in o.items
            ],
        })

    return {
        "run_id": id,
        "trip_code": run.trip_code,
        "vehicle_number": run.vehicle_number,
        "driver_name": run.driver_name,
        "departure_time": run.departure_time.isoformat() if run.departure_time else None,
        "orders": orders_payload,
        "total_weight_kg": run.total_weight_kg,
        "total_volume_m3": run.total_volume_m3,
        "stop_sequence": run.stop_sequence or [],
    }


@router.post("/{id}/mark-stop-complete", response_model=DeliveryRunResponse)
def mark_stop_complete(
    id: int,
    db: Session = Depends(deps.get_db),
):
    """
    Increment stops_completed by 1. Automatically marks the run as 'completed'
    when all stops are done.
    """
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.stops_completed < run.stop_count:
        completed_idx = run.stops_completed  # The 0-indexed stop that just finished
        run.stops_completed += 1

        # Store Manager integration: Mark orders for this outlet as DELIVERED
        if run.stop_sequence and completed_idx < len(run.stop_sequence):
            stop = run.stop_sequence[completed_idx]
            outlet_code = stop.get("outlet_code") if isinstance(stop, dict) else None
            
            if outlet_code and run.allocation_id:
                outlet = db.query(Outlet).filter(Outlet.code == outlet_code).first()
                if outlet:
                    orders = db.query(Order).filter(
                        Order.allocation_id == run.allocation_id,
                        Order.outlet_id == outlet.id,
                        Order.status == OrderStatus.DISPATCHED
                    ).all()
                    for order in orders:
                        order_service.update_order_status(db, order.id, OrderStatus.DELIVERED, commit=False)

    # Auto-complete the run when all stops are done
    if run.stop_count > 0 and run.stops_completed >= run.stop_count:
        run.status = "completed"
        run.actual_arrival = datetime.now(timezone.utc)
        
        # Mark any remaining DISPATCHED orders as DELIVERED as a catch-all
        if run.allocation_id:
            remaining_orders = db.query(Order).filter(
                Order.allocation_id == run.allocation_id,
                Order.status == OrderStatus.DISPATCHED
            ).all()
            for order in remaining_orders:
                order_service.update_order_status(db, order.id, OrderStatus.DELIVERED, commit=False)

    run.updated_at = datetime.now(timezone.utc)
    db.commit()

    db.refresh(run)
    return run


@router.post("/{id}/recall-run", response_model=DeliveryRunResponse)
def recall_run(
    id: int,
    db: Session = Depends(deps.get_db),
):
    """
    Dispatcher initiates a run recall — marks run status as 'recalled' and logs
    a loading event. This is a high-severity action used in sync conflict resolution.
    """
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    now_str = datetime.now(timezone.utc).strftime("%H:%M")
    events = list(run.loading_events or [])
    events.append({
        "event": "Run recalled",
        "time": now_str,
        "note": "Dispatcher issued a recall due to sync conflict",
        "status": "error"
    })
    run.loading_events = events
    run.status = "recalled"
    run.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run
