from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.services.receipt_service import ReceiptService
from app.schemas.receipts import (
    ReceiptCreateRequest,
    ReceiptSyncRequest,
    ReceiptResponse,
    ReceiptSyncResponse,
)

router = APIRouter(prefix="/receipts", tags=["Receipts"])
receipt_service = ReceiptService()


@router.post("", response_model=ReceiptResponse, status_code=201)
async def submit_receipt(
    body: ReceiptCreateRequest,
    db: Session = Depends(get_db),
):
    """
    Store manager submits a delivery receipt.
    Marks order as delivered. Fires notification if issues reported.
    """
    return await receipt_service.submit_receipt(body, db)


@router.post("/sync", response_model=ReceiptSyncResponse)
async def sync_offline_receipts(
    body: ReceiptSyncRequest,
    db: Session = Depends(get_db),
):
    """
    Batch submit receipts collected while offline.
    Skips any order_id that already has a receipt (idempotent).
    """
    return await receipt_service.sync_offline_receipts(body.receipts, db)


@router.get("/{order_id}", response_model=ReceiptResponse)
async def get_receipt(
    order_id: int,
    db: Session = Depends(get_db),
):
    """Get the receipt for an order. Returns 404 if not yet submitted."""
    receipt = await receipt_service.get_receipt_by_order(order_id, db)
    if not receipt:
        raise HTTPException(status_code=404, detail="No receipt found for this order")
    return receipt
