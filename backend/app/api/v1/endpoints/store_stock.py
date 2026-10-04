from datetime import datetime
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.api import deps
from app.models.reference import Outlet
from app.models.user import User
from app.schemas.store_stock import StoreStockImportResult, StoreStockRead
from app.services.store_stock_service import store_stock_service

router = APIRouter()

MAX_UPLOAD_BYTES = 1_000_000


@router.get("/{outlet_id}/stock", response_model=StoreStockRead)
def get_store_stock(
    outlet_id: int, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)
):
    """The store's on-hand quantities from its last CSV import."""
    outlet: Outlet = deps.resolve_store_outlet(db, current_user, outlet_id)
    rows = store_stock_service.get_stock(db, outlet)
    names = store_stock_service.names_for(db, outlet, [row.sku for row in rows])
    return {
        "imported_at": max((row.imported_at for row in rows), default=None),
        "items": [
            {
                "sku": row.sku,
                "name": names.get(row.sku, (None, None))[0],
                "pack_label": names.get(row.sku, (None, None))[1],
                "quantity_on_hand": row.quantity_on_hand,
            }
            for row in rows
        ],
    }


@router.post("/{outlet_id}/stock/import", response_model=StoreStockImportResult)
async def import_store_stock(
    outlet_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(deps.get_db),
    now: datetime = Depends(deps.get_now),
    current_user: User = Depends(deps.get_current_user),
):
    """Replace the store's on-hand list with a CSV of sku + quantity_on_hand. Unusable rows are reported, not saved."""
    outlet = deps.resolve_store_outlet(db, current_user, outlet_id)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The CSV is larger than 1 MB.")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Save the file as a UTF-8 CSV and try again.")
    return store_stock_service.import_csv(db, outlet, text, now)
