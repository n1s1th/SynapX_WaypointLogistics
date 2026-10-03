from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.api import deps
from app.models.shipment import DispatchTrip
from app.models.allocation import Allocation, AllocationStatus
from app.models.fleet import DriverProfile
from app.schemas.shipment import DispatchTripCreate, DispatchTripRead, DeliveryRunResponse, DeliveryRunUpdate, LoadingEventIn
from app.models.order import Order, OrderItem
from app.services import driver_service
from pydantic import BaseModel, Field

router = APIRouter()


@router.get("/", response_model=List[DeliveryRunResponse])
def list_delivery_runs(
    status: Optional[str] = None,
    depot: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(deps.get_db)
):
    query = db.query(DispatchTrip)
    if status:
        query = query.filter(DispatchTrip.status == status)
    if depot:
        query = query.filter(DispatchTrip.depot_name == depot)
    return query.offset(skip).limit(limit).all()


@router.get("/{id}", response_model=DeliveryRunResponse)
def get_delivery_run(id: int, db: Session = Depends(deps.get_db)):
    run = db.query(DispatchTrip).filter(DispatchTrip.id == id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Delivery run not found")
    return run


@router.get("/{id}/deliveries")
def get_run_deliveries(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user=Depends(deps.require_dispatcher_or_admin),
):
    """Server-confirmed driver progress for this run: outcome, quantities, POD
    availability and timestamps per stop, plus sync conflicts awaiting review."""
    if not db.query(DispatchTrip.id).filter(DispatchTrip.id == id).first():
        raise HTTPException(status_code=404, detail="Delivery run not found")
    return driver_service.dispatch_deliveries(db, id)


class ConflictReviewIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/{id}/sync-conflicts/{event_id}/review")
def review_sync_conflict(
    id: int,
    event_id: int,
    body: ConflictReviewIn,
    db: Session = Depends(deps.get_db),
    current_user=Depends(deps.require_dispatcher_or_admin),
):
    """Dispatcher acknowledges a driver sync conflict. Nothing is applied
    automatically; the driver's phone stops flagging it once reviewed."""
    data = driver_service.dispatch_deliveries(db, id)
    if event_id not in {c["event_id"] for c in data["conflicts"]}:
        raise HTTPException(status_code=404, detail="Conflict not found for this run")
    event = driver_service.review_sync_conflict(db, event_id, current_user.id, body.note)
    return {"event_id": event.id, "reviewed_at": event.reviewed_at, "review_note": event.review_note}


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
    for field, value in update_data.items():
        setattr(run, field, value)

    # Explicitly touch updated_at — onupdate lambda only fires on DB-level flush
    run.updated_at = datetime.now(timezone.utc)

    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.post("/from-allocation/{allocation_id}", response_model=DeliveryRunResponse, status_code=status.HTTP_201_CREATED)
def create_run_from_allocation(
    allocation_id: int,
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

    # Only allow dispatching from READY or LOADING states
    if allocation.status not in (AllocationStatus.READY, AllocationStatus.LOADING):
        raise HTTPException(
            status_code=400,
            detail=f"Allocation must be READY or LOADING to dispatch (current: {allocation.status})"
        )

    # Idempotency: if a DispatchTrip already exists for this allocation, return it
    existing = db.query(DispatchTrip).filter(DispatchTrip.allocation_id == allocation_id).first()
    if existing:
        return existing

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
        total_weight_kg=0.0,
        total_volume_m3=0.0,
        stop_count=0,
        stops_completed=0,
        stop_sequence=[],
        open_shortfalls=0,
        loading_events=[
            {
                "event": "Plan published",
                "time": datetime.now(timezone.utc).strftime("%H:%M"),
                "note": f"Dispatched from allocation #{allocation_id}",
                "status": "ok"
            }
        ],
    )
    db.add(trip)

    # Mark allocation as dispatched
    allocation.status = AllocationStatus.DISPATCHED
    db.add(allocation)

    db.commit()
    db.refresh(trip)
    return trip


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
