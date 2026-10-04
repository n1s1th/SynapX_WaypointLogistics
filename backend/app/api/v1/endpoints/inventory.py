import csv
import io
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.api import deps
from app.models.inventory import InventoryItem, Warehouse
from app.schemas.inventory import (
    InventoryItemCreate,
    InventoryItemRead,
    WarehouseCreate,
    WarehouseRead,
    ChainStockSummary,
)

router = APIRouter()


@router.get("/warehouses", response_model=List[WarehouseRead])
def list_warehouses(skip: int = 0, limit: int = 50, db: Session = Depends(deps.get_db)):
    return db.query(Warehouse).offset(skip).limit(limit).all()


@router.post("/warehouses", response_model=WarehouseRead, status_code=status.HTTP_201_CREATED)
def create_warehouse(warehouse_in: WarehouseCreate, db: Session = Depends(deps.get_db)):
    warehouse = Warehouse(**warehouse_in.model_dump())
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return warehouse


@router.get("/summary", response_model=Dict[str, Any])
def get_inventory_summary(db: Session = Depends(deps.get_db)):
    """
    Returns aggregated cargo specifications for the 3 chains (Fresh, Style, Tech).
    """
    chains = ["fresh", "style", "tech"]
    chain_summaries = []
    
    total_skus = 0
    total_chilled = 0
    total_ambient = 0
    total_weight = 0.0
    total_volume = 0.0

    for ch in chains:
        query = db.query(InventoryItem).filter(func.lower(InventoryItem.chain) == ch.lower())
        items = query.all()
        
        skus_cnt = len(items)
        chilled_cnt = sum(1 for i in items if (i.temp_requirement or "").lower() == "chilled")
        ambient_cnt = sum(1 for i in items if (i.temp_requirement or "").lower() != "chilled")
        avg_wt = round(sum(i.unit_weight_kg or 0.0 for i in items) / max(skus_cnt, 1), 2)
        avg_vol = round(sum(i.unit_volume_m3 or 0.0 for i in items) / max(skus_cnt, 1), 3)
        latest_upd = max((i.updated_at for i in items if i.updated_at), default=None)

        chain_summaries.append({
            "chain": ch.capitalize(),
            "total_skus": skus_cnt,
            "chilled_skus": chilled_cnt,
            "ambient_skus": ambient_cnt,
            "avg_weight_kg": avg_wt,
            "avg_volume_m3": avg_vol,
            "last_updated": latest_upd.isoformat() if latest_upd else None,
        })

        total_skus += skus_cnt
        total_chilled += chilled_cnt
        total_ambient += ambient_cnt
        total_weight += sum(i.unit_weight_kg or 0.0 for i in items)
        total_volume += sum(i.unit_volume_m3 or 0.0 for i in items)

    return {
        "chains": chain_summaries,
        "overall": {
            "total_skus": total_skus,
            "chilled_skus": total_chilled,
            "ambient_skus": total_ambient,
            "avg_weight_kg": round(total_weight / max(total_skus, 1), 2),
            "avg_volume_m3": round(total_volume / max(total_skus, 1), 3),
        }
    }


@router.get("/items", response_model=List[InventoryItemRead])
def list_items(
    chain: Optional[str] = None,
    search: Optional[str] = None,
    temp_requirement: Optional[str] = None,
    skip: int = 0,
    limit: int = 150,
    db: Session = Depends(deps.get_db),
):
    query = db.query(InventoryItem)
    if chain and chain.lower() != "all":
        query = query.filter(func.lower(InventoryItem.chain) == chain.lower())
    if temp_requirement and temp_requirement.lower() != "all":
        query = query.filter(func.lower(InventoryItem.temp_requirement) == temp_requirement.lower())
    if search:
        s = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(InventoryItem.sku).like(s),
                func.lower(InventoryItem.name).like(s),
                func.lower(InventoryItem.depot_name).like(s),
            )
        )
    return query.order_by(InventoryItem.sku.asc()).offset(skip).limit(limit).all()


@router.post("/items", response_model=InventoryItemRead, status_code=status.HTTP_201_CREATED)
def create_item(item_in: InventoryItemCreate, db: Session = Depends(deps.get_db)):
    existing = db.query(InventoryItem).filter(InventoryItem.sku == item_in.sku).first()
    if existing:
        raise HTTPException(status_code=400, detail="Item SKU already exists")
    item = InventoryItem(**item_in.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/upload-csv")
async def upload_stock_csv(
    file: UploadFile = File(...),
    chain: Optional[str] = Query(None, description="fresh, style, or tech. If omitted, inferred from file/data"),
    db: Session = Depends(deps.get_db),
):
    """
    Import product handling specifications from a CSV file for Fresh, Style, or Tech chains.
    Rows are upserted by SKU.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Empty or invalid CSV file")

    # Determine default chain from filename or query param
    target_chain = chain
    if not target_chain:
        fname_lower = file.filename.lower()
        if "fresh" in fname_lower:
            target_chain = "Fresh"
        elif "style" in fname_lower:
            target_chain = "Style"
        elif "tech" in fname_lower:
            target_chain = "Tech"
        else:
            target_chain = "Fresh"

    inserted_count = 0
    updated_count = 0
    now = datetime.now(timezone.utc)

    for row_idx, raw_row in enumerate(reader, start=2):
        row = {k.strip().lower().replace(" ", "_"): v.strip() for k, v in raw_row.items() if k}
        sku = row.get("sku") or row.get("item_code") or row.get("code")
        if not sku:
            continue

        name = row.get("name") or row.get("item_name") or row.get("description") or sku

        # Unit weight (kg)
        weight_str = row.get("unit_weight_kg") or row.get("weight_kg") or row.get("weight") or "1.0"
        try:
            unit_weight_kg = float(weight_str)
        except ValueError:
            unit_weight_kg = 1.0

        # Unit volume (m3)
        vol_str = row.get("unit_volume_m3") or row.get("volume_m3") or row.get("volume") or "0.01"
        try:
            unit_volume_m3 = float(vol_str)
        except ValueError:
            unit_volume_m3 = 0.01

        # Temperature requirement
        temp_req = row.get("temp_requirement") or row.get("temperature_zone") or row.get("temp")
        if not temp_req:
            temp_req = "Chilled" if target_chain.lower() == "fresh" and any(k in sku.upper() for k in ["EGG", "ICE", "CHK", "BEEF", "FSH", "FRZ"]) else "Ambient"

        row_chain = row.get("chain") or target_chain
        depot_name = row.get("depot_name") or row.get("depot") or "Peliyagoda Central"

        existing = db.query(InventoryItem).filter(InventoryItem.sku == sku).first()
        if existing:
            existing.name = name
            existing.unit_weight_kg = unit_weight_kg
            existing.unit_volume_m3 = unit_volume_m3
            existing.temp_requirement = temp_req
            existing.chain = row_chain.capitalize()
            existing.depot_name = depot_name
            existing.updated_at = now
            updated_count += 1
        else:
            new_item = InventoryItem(
                sku=sku,
                name=name,
                quantity=0,
                unit_price=0.0,
                unit_weight_kg=unit_weight_kg,
                unit_volume_m3=unit_volume_m3,
                temp_requirement=temp_req,
                chain=row_chain.capitalize(),
                depot_name=depot_name,
                updated_at=now,
            )
            db.add(new_item)
            inserted_count += 1

    db.commit()

    return {
        "message": f"Successfully processed cargo specifications file '{file.filename}' for chain {target_chain.capitalize()}",
        "chain": target_chain.capitalize(),
        "inserted": inserted_count,
        "updated": updated_count,
        "total_processed": inserted_count + updated_count,
    }


@router.get("/export-csv")
def export_stock_csv(
    chain: Optional[str] = Query(None, description="fresh, style, or tech. If omitted, exports all chains"),
    db: Session = Depends(deps.get_db),
):
    """
    Export current chain product cargo specifications to a downloadable CSV file.
    """
    query = db.query(InventoryItem)
    if chain and chain.lower() != "all":
        query = query.filter(func.lower(InventoryItem.chain) == chain.lower())
        filename = f"{chain.lower()}_cargo_specs.csv"
    else:
        filename = "all_chains_cargo_specs.csv"

    items = query.order_by(InventoryItem.chain.asc(), InventoryItem.sku.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "sku",
        "name",
        "chain",
        "unit_weight_kg",
        "unit_volume_m3",
        "temp_requirement",
        "depot_name",
        "last_updated",
    ])

    for item in items:
        writer.writerow([
            item.sku,
            item.name,
            item.chain or "Unassigned",
            item.unit_weight_kg,
            item.unit_volume_m3,
            item.temp_requirement,
            item.depot_name or "Peliyagoda Central",
            item.updated_at.isoformat() if item.updated_at else "",
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )
