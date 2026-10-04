from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.api.deps import get_db
from app.models.order import Order
from app.models.user import User
from app.services.receipt_service import ReceiptService
from app.schemas.receipts import (
    ReceiptCreateRequest,
    ReceiptSyncRequest,
    ReceiptResponse,
    ReceiptSyncResponse,
)

router = APIRouter(prefix="/receipts", tags=["Receipts"])
receipt_service = ReceiptService()


def _scoped(db: Session, user: User, payload: ReceiptCreateRequest) -> ReceiptCreateRequest:
    """A store manager confirms receipts for their own outlet's orders only."""
    if user.role not in deps.STORE_ROLES:
        return payload
    outlet = deps.resolve_store_outlet(db, user, None)
    order = db.query(Order).filter(Order.id == payload.order_id).first()
    if order is None or order.outlet_id != outlet.id:
        raise HTTPException(status_code=403, detail="That order belongs to another outlet.")
    return payload.model_copy(update={"outlet_id": outlet.id})


def _reporter(user: User) -> str:
    return f"{user.full_name} (Store Manager)" if user.role in deps.STORE_ROLES else user.full_name


@router.post("", response_model=ReceiptResponse, status_code=201)
async def submit_receipt(
    body: ReceiptCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Store manager confirms what arrived. Completes the order. Logs an issue and notifies if one was reported.
    """
    return await receipt_service.submit_receipt(_scoped(db, current_user, body), db, _reporter(current_user))


@router.post("/sync", response_model=ReceiptSyncResponse)
async def sync_offline_receipts(
    body: ReceiptSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Batch submit receipts collected while offline.
    Skips any order_id that already has a receipt (idempotent).
    """
    receipts = [_scoped(db, current_user, receipt) for receipt in body.receipts]
    return await receipt_service.sync_offline_receipts(receipts, db, _reporter(current_user))


@router.get("/{order_id}", response_model=ReceiptResponse)
async def get_receipt(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Get the receipt for an order. Returns 404 if not yet submitted."""
    order = db.query(Order).filter(Order.id == order_id).first()
    deps.ensure_store_access(db, current_user, order.outlet_id if order else None)
    receipt = await receipt_service.get_receipt_by_order(order_id, db)
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt found for this order")
    return receipt
