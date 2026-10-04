from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, and_, func
from app.api import deps
from app.models.order import Order, OrderStatus
from app.models.reference import Depot
from app.schemas.order import OrderCreate, OrderRead, OrderUpdate
from app.services.order_service import TRANSITIONS, order_service
from pydantic import BaseModel

router = APIRouter()


class BulkAllocateRequest(BaseModel):
    order_ids: List[int]
    allocation_id: Optional[int] = None


class DeferOrderRequest(BaseModel):
    reason: Optional[str] = "Capacity limit reached"
    item_id: Optional[int] = None
    item_sku: Optional[str] = None
    quantity_sent: Optional[int] = None


@router.get("/metrics", response_model=Dict[str, int])
def get_order_metrics(
    operating_date: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    query = db.query(Order).filter(Order.depot == depot)
    if operating_date:
        query = query.filter(Order.operating_date == operating_date)

    total_orders = query.count()
    confirmed = query.filter(Order.status.in_([OrderStatus.CONFIRMED, OrderStatus.SUBMITTED])).count()
    unallocated = query.filter(
        and_(
            Order.status.in_([OrderStatus.CONFIRMED, OrderStatus.SUBMITTED]),
            Order.allocation_id == None,
            Order.is_late == False,
        )
    ).count()
    allocated = query.filter(
        or_(
            Order.status == OrderStatus.ALLOCATED,
            Order.allocation_id != None,
        )
    ).count()
    deferred = query.filter(Order.status == OrderStatus.DEFERRED).count()
    priority = query.filter(Order.is_priority == True).count()
    late = query.filter(Order.is_late == True).count()

    return {
        "total_orders": total_orders,
        "confirmed": confirmed,
        "unallocated": unallocated,
        "allocated": allocated,
        "deferred": deferred,
        "priority": priority,
        "late": late,
    }


@router.get("/", response_model=List[OrderRead])
def list_orders(
    status: Optional[str] = None,
    brand: Optional[str] = None,
    district: Optional[str] = None,
    temperature_zone: Optional[str] = None,
    is_priority: Optional[bool] = None,
    is_late: Optional[bool] = None,
    operating_date: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    query = db.query(Order).options(selectinload(Order.items)).filter(Order.depot == depot)

    if is_late is not None:
        query = query.filter(Order.is_late == is_late)

    if operating_date:
        query = query.filter(Order.operating_date == operating_date)

    if brand and brand.lower() != "all brands" and brand.lower() != "all":
        query = query.filter(func.lower(Order.brand) == brand.lower())

    if district and district.lower() != "all districts" and district.lower() != "all":
        query = query.filter(func.lower(Order.district) == district.lower())

    if temperature_zone and temperature_zone.lower() != "all":
        query = query.filter(func.lower(Order.temperature_zone) == temperature_zone.lower())

    if is_priority is not None:
        query = query.filter(Order.is_priority == is_priority)

    if status and status.lower() != "all":
        s_upper = status.upper()
        if s_upper == "UNALLOCATED":
            query = query.filter(
                Order.status.in_([OrderStatus.CONFIRMED, OrderStatus.SUBMITTED]),
                Order.allocation_id == None,
                Order.is_late == False,
            )
        elif s_upper == "ALLOCATED":
            query = query.filter(
                or_(Order.status == OrderStatus.ALLOCATED, Order.allocation_id != None)
            )
        elif s_upper == "PRIORITY":
            query = query.filter(Order.is_priority == True)
        elif s_upper in OrderStatus.__members__:
            query = query.filter(Order.status == OrderStatus[s_upper])

    if search:
        s = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Order.order_number).like(s),
                func.lower(Order.client_name).like(s),
                func.lower(Order.destination_address).like(s),
                func.lower(Order.district).like(s),
                func.lower(Order.brand).like(s),
            )
        )

    return query.order_by(Order.id.asc()).offset(skip).limit(limit).all()


@router.post("/", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
def create_order(
    order_in: OrderCreate,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    existing = db.query(Order).filter(Order.order_number == order_in.order_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Order number already exists")
    # Depot belongs to the dispatcher scope, never to an arbitrary request body.
    order_in.depot = depot
    return order_service.create_order(db=db, order_in=order_in)


@router.post("/bulk-allocate")
def bulk_allocate_orders(
    req: BulkAllocateRequest,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    orders = db.query(Order).filter(Order.id.in_(req.order_ids), Order.depot == depot).all()
    if not orders:
        raise HTTPException(status_code=404, detail="No matching orders found")

    # Up-front validation
    from app.services.order_service import TRANSITIONS
    for order in orders:
        if order.status != OrderStatus.ALLOCATED and OrderStatus.ALLOCATED not in TRANSITIONS.get(order.status, set()):
            raise HTTPException(
                status_code=409,
                detail=f"{order.order_number} can't move from {order.status.value.lower()} to allocated."
            )

    # Apply changes
    for order in orders:
        if req.allocation_id:
            order.allocation_id = req.allocation_id
        
        if order.status != OrderStatus.ALLOCATED:
            order_service.update_order_status(db, order.id, OrderStatus.ALLOCATED, commit=False)
            
    db.commit()
    return {"message": f"Successfully allocated {len(orders)} orders", "count": len(orders)}


@router.post("/{order_id}/defer", response_model=OrderRead)
def defer_order(
    order_id: int,
    req: DeferOrderRequest,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    order = db.query(Order).filter(Order.id == order_id, Order.depot == depot).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    return order_service.defer_order(
        db,
        order_id,
        req.reason,
        item_id=req.item_id,
        item_sku=req.item_sku,
        quantity_sent=req.quantity_sent,
    )


@router.get("/{order_id}", response_model=OrderRead)
def get_order(
    order_id: int,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    order = db.query(Order).options(selectinload(Order.items)).filter(Order.id == order_id, Order.depot == depot).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/{order_id}", response_model=OrderRead)
def update_order(
    order_id: int,
    order_in: OrderUpdate,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
):
    order = db.query(Order).filter(Order.id == order_id, Order.depot == depot).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    update_data = order_in.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(order, field, val)
    db.commit()
    db.refresh(order)
    return order
