from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import get_db, get_dispatcher_depot, require_dispatcher_or_admin
from app.models.user import User
from app.models.allocation import Allocation, AllocationStatus
from app.models.order import Order
from app.models.fleet import Vehicle, DriverProfile, VehicleStatus
from app.models.reference import Depot
from app.schemas.allocation import AllocationCreate, AllocationResponse, AllocationUpdate
from app.schemas.allocation_recommendation import ConfirmAllocationRequest
from app.services.allocation_confirmation import allocation_confirmation_service

router = APIRouter()


@router.post("/confirm", response_model=AllocationResponse, status_code=status.HTTP_201_CREATED)
def confirm_allocation(
    payload: ConfirmAllocationRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_dispatcher_or_admin),
    depot: Depot = Depends(get_dispatcher_depot),
) -> Allocation:
    """Recheck every hard constraint and commit vehicle, allocation and orders together."""
    allocation = allocation_confirmation_service.confirm(
        db, vehicle_id=payload.vehicle_id, order_ids=payload.order_ids,
        departure_time=payload.departure_time, depot=depot,
        route_fingerprint=payload.route_fingerprint,
    )
    return (
        db.query(Allocation)
        .options(joinedload(Allocation.vehicle), joinedload(Allocation.driver).joinedload(DriverProfile.user), joinedload(Allocation.orders))
        .filter(Allocation.id == allocation.id)
        .first()
    )

@router.get("/", response_model=List[AllocationResponse])
def get_allocations(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    depot: Depot = Depends(get_dispatcher_depot),
) -> Any:
    """
    Retrieve allocations with their nested vehicles, drivers, and orders.
    """
    allocations = (
        db.query(Allocation)
        .options(
            joinedload(Allocation.vehicle), 
            joinedload(Allocation.driver).joinedload(DriverProfile.user),
            joinedload(Allocation.orders).selectinload(Order.items)
        )
        .join(Allocation.vehicle)
        .filter(Vehicle.depot_name == depot.value)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return allocations

@router.post("/", response_model=AllocationResponse, status_code=status.HTTP_201_CREATED)
def create_allocation(
    allocation_in: AllocationCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_dispatcher_or_admin),
    depot: Depot = Depends(get_dispatcher_depot),
) -> Any:
    """
    Create new allocation. Ensures vehicle is available and marks it as allocated.
    """
    vehicle = db.query(Vehicle).filter(
        Vehicle.id == allocation_in.vehicle_id,
        Vehicle.depot_name == depot.value,
    ).with_for_update().first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    if vehicle.status != VehicleStatus.AVAILABLE:
        raise HTTPException(status_code=400, detail="Vehicle is not available for allocation")
    if db.query(Allocation.id).filter(
        Allocation.vehicle_id == vehicle.id,
        Allocation.status.notin_([AllocationStatus.COMPLETED, AllocationStatus.CANCELLED]),
    ).first():
        raise HTTPException(status_code=409, detail="Vehicle already has an active allocation")

    allocation_in_data = allocation_in.model_dump()

    # Auto-assign the driver from the vehicle's assigned driver profile
    if vehicle and vehicle.driver:
        allocation_in_data["driver_id"] = vehicle.driver.id

    allocation = Allocation(**allocation_in_data)
    db.add(allocation)
    
    # Mark vehicle as allocated
    vehicle.status = VehicleStatus.ALLOCATED
    
    db.commit()
    
    # Fetch with joins to return complete response
    allocation_complete = (
        db.query(Allocation)
        .options(
            joinedload(Allocation.vehicle),
            joinedload(Allocation.driver).joinedload(DriverProfile.user),
            joinedload(Allocation.orders)
        )
        .filter(Allocation.id == allocation.id)
        .first()
    )
    return allocation_complete

@router.get("/{allocation_id}", response_model=AllocationResponse)
def get_allocation(
    allocation_id: int,
    db: Session = Depends(get_db),
    depot: Depot = Depends(get_dispatcher_depot),
) -> Any:
    """
    Get a specific allocation by ID.
    """
    allocation = (
        db.query(Allocation)
        .options(
            joinedload(Allocation.vehicle),
            joinedload(Allocation.driver).joinedload(DriverProfile.user),
            joinedload(Allocation.orders)
        )
        .join(Allocation.vehicle)
        .filter(Allocation.id == allocation_id, Vehicle.depot_name == depot.value)
        .first()
    )
    if not allocation:
        raise HTTPException(status_code=404, detail="Allocation not found")
    return allocation

@router.patch("/{allocation_id}", response_model=AllocationResponse)
def update_allocation(
    allocation_id: int,
    allocation_in: AllocationUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_dispatcher_or_admin),
    depot: Depot = Depends(get_dispatcher_depot),
) -> Any:
    """
    Update an allocation. Handles freeing the vehicle if status changes to cancelled/completed.
    """
    target = db.query(Allocation.vehicle_id).join(Allocation.vehicle).filter(
        Allocation.id == allocation_id, Vehicle.depot_name == depot.value
    ).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Allocation not found")
    vehicle = db.query(Vehicle).filter(Vehicle.id == target.vehicle_id).with_for_update().first()
    allocation = db.query(Allocation).filter(Allocation.id == allocation_id).with_for_update().populate_existing().first()
    if vehicle is None or allocation is None:
        raise HTTPException(status_code=404, detail="Allocation not found")

    update_data = allocation_in.model_dump(exclude_unset=True)

    # Removed driver_id update block
    for field, val in update_data.items():
        setattr(allocation, field, val)
        
    # Sync vehicle status with allocation lifecycle
    if "status" in update_data:
        new_status = update_data["status"]
        if new_status in [AllocationStatus.COMPLETED, AllocationStatus.CANCELLED]:
            db.flush()
            other_active = db.query(Allocation.id).filter(
                Allocation.vehicle_id == vehicle.id, Allocation.id != allocation.id,
                Allocation.status.notin_([AllocationStatus.COMPLETED, AllocationStatus.CANCELLED]),
            ).first()
            if not other_active and vehicle.status != VehicleStatus.UNAVAILABLE:
                vehicle.status = VehicleStatus.AVAILABLE
        elif new_status == AllocationStatus.LOADING:
            vehicle.status = VehicleStatus.LOADING
        elif new_status in [AllocationStatus.ALLOCATED, AllocationStatus.READY]:
            vehicle.status = VehicleStatus.ALLOCATED

    db.commit()
    db.refresh(allocation)
    return allocation

@router.delete("/{allocation_id}")
def delete_allocation(
    allocation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_dispatcher_or_admin),
    depot: Depot = Depends(get_dispatcher_depot),
) -> Any:
    """
    Soft-delete an allocation (mark as cancelled).
    """
    target = db.query(Allocation.vehicle_id).join(Allocation.vehicle).filter(
        Allocation.id == allocation_id, Vehicle.depot_name == depot.value,
    ).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Allocation not found")
    vehicle = db.query(Vehicle).filter(Vehicle.id == target.vehicle_id).with_for_update().first()
    allocation = db.query(Allocation).filter_by(id=allocation_id).with_for_update().populate_existing().first()
    if vehicle is None or allocation is None:
        raise HTTPException(status_code=404, detail="Allocation not found")
        
    allocation.status = AllocationStatus.CANCELLED
    db.flush()
    other_active = db.query(Allocation.id).filter(
        Allocation.vehicle_id == vehicle.id, Allocation.id != allocation.id,
        Allocation.status.notin_([AllocationStatus.COMPLETED, AllocationStatus.CANCELLED]),
    ).first()
    if not other_active and vehicle.status != VehicleStatus.UNAVAILABLE:
        vehicle.status = VehicleStatus.AVAILABLE
        
    db.commit()
    return {"detail": "Allocation cancelled successfully"}
