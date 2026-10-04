import csv
import io
from datetime import datetime, time, timezone
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import inspect, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, undefer

from app.api import deps
from app.api.deps import get_db, require_dispatcher_or_admin
from app.models.reference import Outlet, Brand, Depot, DockType
from app.models.outlet import OutletContact, OutletReceivingWindow
from app.models.outlet_settings import OutletSettings
from app.models.user import User
from app.models.store_manager import StoreManagerAssignment
from app.schemas.outlet import (
    ContactRead,
    OutletCreate,
    OutletRead,
    OutletUpdate,
    WindowRead,
)
from app.schemas.outlet_settings import OutletSettingsRead, OutletSettingsUpdate
from app.schemas.admin import OutletManagerAssignRequest
from app.services.outlet_service import outlet_service

router = APIRouter()


def outlet_to_read(o: Any, s: Optional[OutletSettings] = None, user_id: Optional[int] = None) -> OutletRead:
    contacts = [ContactRead.model_validate(c) for c in getattr(o, "contacts", [])]
    windows = [WindowRead.model_validate(w) for w in getattr(o, "receiving_windows", [])]
    
    brand_val = o.brand.value if hasattr(o.brand, "value") else str(o.brand).lower()
    depot_val = o.depot.value if hasattr(o.depot, "value") else str(o.depot).lower()
    dock_val = o.dock_type.value if hasattr(o.dock_type, "value") else str(o.dock_type).lower()

    return OutletRead(
        id=o.id,
        code=o.code,
        name=o.name,
        address=getattr(o, "address", None) or "",
        district=o.district,
        brand=Brand(brand_val),
        depot=Depot(depot_val),
        dock_type=DockType(dock_val),
        van_only=o.van_only,
        active=getattr(o, "active", True),
        delivery_restrictions=getattr(o, "delivery_restrictions", None),
        created_at=getattr(o, "created_at", None),
        updated_at=getattr(o, "updated_at", None),
        window_start=getattr(o, "window_start", None),
        window_end=getattr(o, "window_end", None),
        parking_constraint=getattr(o, "parking_constraint", None) or ("van_only" if o.van_only else "normal"),
        mall_window=getattr(o, "mall_window", None),
        store_manager=s.store_manager if s else None,
        store_manager_user_id=user_id,
        store_manager_phone=s.contact_phone if s else None,
        contacts=contacts,
        receiving_windows=windows,
    )


class OutletCSVImportRequest(BaseModel):
    csv_content: str


@router.get("/export-csv")
def export_outlets_csv(
    db: Session = Depends(get_db)
) -> Any:
    """
    Export all outlets as CSV matching standard fleet/operations format:
    outlet_id,brand,district,depot,dock_type,parking_constraint,mall_window,window_open_time,window_close_time
    """
    outlets = db.query(Outlet).order_by(Outlet.code.asc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "outlet_id",
        "brand",
        "district",
        "depot",
        "dock_type",
        "parking_constraint",
        "mall_window",
        "window_open_time",
        "window_close_time"
    ])
    for o in outlets:
        b_val = o.brand.value.title() if hasattr(o.brand, "value") else str(o.brand).title()
        d_val = o.depot.value.title() if hasattr(o.depot, "value") else str(o.depot).title()
        dk_val = o.dock_type.value if hasattr(o.dock_type, "value") else str(o.dock_type)
        p_val = getattr(o, "parking_constraint", None) or ("van_only" if o.van_only else "normal")
        m_val = getattr(o, "mall_window", None) or ""
        open_time = o.window_start.strftime("%H:%M") if o.window_start else "06:00"
        close_time = o.window_end.strftime("%H:%M") if o.window_end else "18:00"

        writer.writerow([
            o.code,
            b_val,
            o.district,
            d_val,
            dk_val,
            p_val,
            m_val,
            open_time,
            close_time
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=outlets.csv"}
    )


@router.post("/import-csv")
def import_outlets_csv(
    payload: OutletCSVImportRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Import outlets from CSV string content.
    Expects columns: outlet_id,brand,district,depot,dock_type,parking_constraint,mall_window,window_open_time,window_close_time
    """
    raw_csv = payload.csv_content.strip()
    if not raw_csv:
        raise HTTPException(status_code=400, detail="CSV payload is empty.")

    reader = csv.DictReader(io.StringIO(raw_csv))
    imported_count = 0
    updated_count = 0
    errors = []

    for row_idx, row in enumerate(reader, start=2):
        norm_row = {k.strip().lower(): (v.strip() if v else "") for k, v in row.items() if k}
        code = norm_row.get("outlet_id") or norm_row.get("code")
        if not code:
            continue

        try:
            b_str = (norm_row.get("brand") or "fresh").lower()
            brand_enum = Brand.FRESH
            if b_str in ("fresh", "style", "tech"):
                brand_enum = Brand(b_str)

            district = norm_row.get("district") or "Unknown"

            d_str = (norm_row.get("depot") or "peliyagoda").lower()
            depot_enum = Depot.PELIYAGODA
            if d_str in ("peliyagoda", "kandy"):
                depot_enum = Depot(d_str)

            dk_str = (norm_row.get("dock_type") or "rear_dock").lower()
            dock_enum = DockType.REAR_DOCK
            if dk_str in ("rear_dock", "street", "mall_bay"):
                dock_enum = DockType(dk_str)

            parking_constraint = norm_row.get("parking_constraint") or "normal"
            if parking_constraint not in ("normal", "van_only"):
                parking_constraint = "normal"
            van_only = (parking_constraint == "van_only")

            w_start = None
            open_str = norm_row.get("window_open_time") or norm_row.get("window_start")
            if open_str:
                parts = open_str.split(":")
                w_start = time(hour=int(parts[0]), minute=int(parts[1]))
            else:
                w_start = time(6, 0)

            w_end = None
            close_str = norm_row.get("window_close_time") or norm_row.get("window_end")
            if close_str:
                parts = close_str.split(":")
                w_end = time(hour=int(parts[0]), minute=int(parts[1]))
            else:
                w_end = time(18, 0)

            brand_disp = brand_enum.value.title()
            outlet_name = f"{brand_disp} {district}"

            existing_outlet = db.query(Outlet).filter(Outlet.code == code).first()
            if existing_outlet:
                existing_outlet.brand = brand_enum
                existing_outlet.district = district
                existing_outlet.depot = depot_enum
                existing_outlet.dock_type = dock_enum
                existing_outlet.van_only = van_only
                existing_outlet.window_start = w_start
                existing_outlet.window_end = w_end
                if not existing_outlet.name:
                    existing_outlet.name = outlet_name
                updated_count += 1
            else:
                new_outlet = Outlet(
                    code=code,
                    name=outlet_name,
                    brand=brand_enum,
                    district=district,
                    depot=depot_enum,
                    dock_type=dock_enum,
                    van_only=van_only,
                    window_start=w_start,
                    window_end=w_end,
                )
                db.add(new_outlet)
                imported_count += 1

        except Exception as ex:
            errors.append(f"Row {row_idx}: {str(ex)}")

    db.commit()
    return {
        "success": True,
        "total_rows": imported_count + updated_count,
        "imported": imported_count,
        "updated": updated_count,
        "errors": errors
    }


def profile_ready(db: Session) -> bool:
    columns = {column["name"] for column in inspect(db.get_bind()).get_columns("outlets")}
    return {"address", "active", "delivery_restrictions", "created_at", "updated_at"}.issubset(columns) and inspect(db.get_bind()).has_table("outlet_contacts") and inspect(db.get_bind()).has_table("outlet_receiving_windows")


def legacy_outlets(db: Session, skip: int, limit: int, outlet_id: int | None = None):
    """Read loader-owned outlets without touching profile columns awaiting migration."""
    columns = {column["name"] for column in inspect(db.get_bind()).get_columns("outlets")}
    extras = [name for name in ("parking_constraint", "mall_window") if name in columns]
    names = ["id", "code", "name", "brand", "district", "dock_type", "van_only", "window_start", "window_end", "depot", *extras]
    condition = "WHERE id = :outlet_id" if outlet_id is not None else ""
    rows = db.execute(text(f"SELECT {', '.join(names)} FROM outlets {condition} ORDER BY id LIMIT :limit OFFSET :skip"), {"skip": skip, "limit": limit, "outlet_id": outlet_id}).mappings().all()
    return [{**dict(row), "brand": Brand[row["brand"]], "depot": Depot[row["depot"]], "dock_type": DockType[row["dock_type"]], "mall_window": str(row["mall_window"]) if row.get("mall_window") is not None else None, "address": None, "active": None, "delivery_restrictions": None, "contacts": [], "receiving_windows": [], "created_at": None, "updated_at": None} for row in rows]


def detail_query(db: Session):
    # Outlet profile fields are deferred for compatibility with loader-only
    # deployments. Once profiles are available, load them in the list query to
    # avoid one additional SQL query per outlet during response serialization.
    return db.query(Outlet).options(
        undefer(Outlet.address),
        undefer(Outlet.active),
        undefer(Outlet.delivery_restrictions),
        undefer(Outlet.created_at),
        undefer(Outlet.updated_at),
        selectinload(Outlet.contacts),
        selectinload(Outlet.receiving_windows),
    )


@router.get("", response_model=List[OutletRead])
@router.get("/", response_model=List[OutletRead])
def list_outlets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    q: Optional[str] = Query(None, description="Search query"),
    brand: Optional[str] = Query(None, description="Filter by brand"),
    depot: Optional[str] = Query(None, description="Filter by depot"),
    district: Optional[str] = Query(None, description="Filter by district"),
    dock_type: Optional[str] = Query(None, description="Filter by dock type"),
    van_only: Optional[bool] = Query(None, description="Filter by van only"),
    db: Session = Depends(get_db),
):
    if not profile_ready(db):
        return legacy_outlets(db, skip, limit)

    query = detail_query(db)

    if brand:
        brand_clean = brand.lower()
        if brand_clean in Brand.__members__:
            query = query.filter(Outlet.brand == Brand[brand_clean])
        else:
            query = query.filter(Outlet.brand == brand_clean)

    if depot:
        depot_clean = depot.lower()
        if depot_clean in Depot.__members__:
            query = query.filter(Outlet.depot == Depot[depot_clean])
        else:
            query = query.filter(Outlet.depot == depot_clean)

    if dock_type:
        dock_clean = dock_type.lower()
        if dock_clean in DockType.__members__:
            query = query.filter(Outlet.dock_type == DockType[dock_clean])
        else:
            query = query.filter(Outlet.dock_type == dock_clean)

    if district:
        query = query.filter(Outlet.district.ilike(f"%{district}%"))

    if van_only is not None:
        query = query.filter(Outlet.van_only == van_only)

    if q:
        search_pattern = f"%{q}%"
        query = query.filter(or_(Outlet.code.ilike(search_pattern), Outlet.name.ilike(search_pattern), Outlet.district.ilike(search_pattern)))

    outlets = query.order_by(Outlet.id.asc()).offset(skip).limit(limit).all()

    outlet_ids = [o.id for o in outlets]
    settings_map = {}
    if outlet_ids:
        records = db.query(OutletSettings).filter(OutletSettings.outlet_id.in_(outlet_ids)).all()
        settings_map = {rec.outlet_id: rec for rec in records}

    results = []
    for o in outlets:
        s = settings_map.get(o.id)
        results.append(outlet_to_read(o, s, s.store_manager_user_id if s else None))
    return results


@router.get("/{outlet_id}", response_model=OutletRead)
def get_outlet(outlet_id: int, db: Session = Depends(get_db)):
    if not profile_ready(db):
        found = legacy_outlets(db, 0, 1, outlet_id)
        if not found:
            raise HTTPException(status_code=404, detail="Outlet not found")
        return found[0]

    outlet = detail_query(db).filter(Outlet.id == outlet_id).first()
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")

    settings = db.query(OutletSettings).filter(OutletSettings.outlet_id == outlet.id).first()
    return outlet_to_read(outlet, settings, settings.store_manager_user_id if settings else None)


def set_children(outlet: Outlet, data: Any):
    if hasattr(data, "contacts") and data.contacts is not None:
        outlet.contacts = [OutletContact(**contact.model_dump()) for contact in data.contacts]
    if hasattr(data, "receiving_windows") and data.receiving_windows is not None:
        outlet.receiving_windows = [OutletReceivingWindow(**window.model_dump()) for window in data.receiving_windows]


@router.post("", response_model=OutletRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=OutletRead, status_code=status.HTTP_201_CREATED)
def create_outlet(data: OutletCreate, db: Session = Depends(get_db), _: User = Depends(require_dispatcher_or_admin)):
    if not profile_ready(db):
        raise HTTPException(status_code=503, detail="Outlet profile migration has not been applied. Contact the DB lead before adding outlets.")

    existing = db.query(Outlet).filter(Outlet.code == data.code.upper()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Outlet code already exists")

    model_data = data.model_dump(exclude={"contacts", "receiving_windows", "store_manager", "store_manager_phone"})
    model_data["code"] = data.code.upper()
    outlet = Outlet(**model_data)
    set_children(outlet, data)
    db.add(outlet)

    try:
        db.commit()
        db.refresh(outlet)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outlet code or receiving window already exists")

    settings = None
    if data.store_manager or data.store_manager_phone:
        settings = OutletSettings(
            outlet_id=outlet.id,
            store_manager=data.store_manager,
            contact_phone=data.store_manager_phone or "077-0000000",
            parking="No restrictions",
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return get_outlet(outlet.id, db)


@router.put("/{outlet_id}", response_model=OutletRead)
def update_outlet(outlet_id: int, data: OutletUpdate, db: Session = Depends(get_db), _: User = Depends(require_dispatcher_or_admin)):
    if not profile_ready(db):
        raise HTTPException(status_code=503, detail="Outlet profile migration has not been applied. Contact the DB lead before editing outlets.")

    outlet = detail_query(db).filter(Outlet.id == outlet_id).with_for_update().first()
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")

    def utc_naive(value: Any):
        if not value:
            return None
        return value.astimezone(timezone.utc).replace(tzinfo=None) if getattr(value, "tzinfo", None) else value

    if data.expected_updated_at is not None:
        if utc_naive(outlet.updated_at) != utc_naive(data.expected_updated_at):
            raise HTTPException(status_code=409, detail="Outlet changed since you opened it. Refresh and try again.")

    dumped = data.model_dump(exclude_unset=True, exclude={"contacts", "receiving_windows", "expected_updated_at", "store_manager", "store_manager_phone"})
    for key, value in dumped.items():
        if value is not None:
            setattr(outlet, key, value)

    # Child-only edits must advance the parent version used for conflict detection.
    outlet.updated_at = datetime.now(timezone.utc)

    # If contacts/receiving_windows were explicitly provided, update children
    if data.contacts is not None and len(data.contacts) > 0 or hasattr(data, "contacts"):
        outlet.contacts.clear()
        if data.contacts:
            outlet.contacts = [OutletContact(**contact.model_dump()) for contact in data.contacts]

    if data.receiving_windows is not None and len(data.receiving_windows) > 0 or hasattr(data, "receiving_windows"):
        outlet.receiving_windows.clear()
        if data.receiving_windows:
            outlet.receiving_windows = [OutletReceivingWindow(**window.model_dump()) for window in data.receiving_windows]

    settings = db.query(OutletSettings).filter(OutletSettings.outlet_id == outlet.id).first()
    if data.store_manager is not None or data.store_manager_phone is not None:
        if not settings:
            settings = OutletSettings(
                outlet_id=outlet.id,
                store_manager=data.store_manager,
                contact_phone=data.store_manager_phone or "077-0000000",
                parking="No restrictions",
            )
            db.add(settings)
        else:
            if data.store_manager is not None:
                if data.store_manager != settings.store_manager:
                    # A different manager name unlinks the old account everywhere: for emails (this column)
                    # and for login (store_manager_assignments). Link the new one with assign-manager.
                    settings.store_manager_user_id = None
                    db.query(StoreManagerAssignment).filter(StoreManagerAssignment.outlet_id == outlet.id).delete()
                settings.store_manager = data.store_manager
            if data.store_manager_phone is not None:
                settings.contact_phone = data.store_manager_phone

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Outlet code or receiving window already exists")

    return get_outlet(outlet.id, db)


@router.post("/{outlet_id}/assign-manager", response_model=OutletRead)
def assign_outlet_manager(
    outlet_id: int,
    payload: OutletManagerAssignRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_dispatcher_or_admin),
) -> Any:
    """
    Assign or unassign a store manager for an outlet.
    """
    outlet = db.query(Outlet).filter(Outlet.id == outlet_id).first()
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")

    manager_name = payload.store_manager
    manager_phone = payload.contact_phone
    user_id = payload.user_id

    if user_id is not None:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Store manager user account not found")
        manager_name = user.full_name
        if not manager_phone:
            manager_phone = "077-0000000"

    # The real user -> outlet link the Store Manager screens are scoped by (the name above is display only).
    # Assigning moves the manager here from any other outlet; unassigning clears this outlet's managers.
    if user_id is not None:
        db.query(StoreManagerAssignment).filter(StoreManagerAssignment.user_id == user_id).delete()
        db.add(StoreManagerAssignment(user_id=user_id, outlet_id=outlet.id))
        # Moving a manager here unlinks them from the outlet they ran before, for emails too.
        db.query(OutletSettings).filter(
            OutletSettings.store_manager_user_id == user_id, OutletSettings.outlet_id != outlet.id
        ).update({OutletSettings.store_manager_user_id: None, OutletSettings.store_manager: None})
    else:
        db.query(StoreManagerAssignment).filter(StoreManagerAssignment.outlet_id == outlet.id).delete()

    settings = db.query(OutletSettings).filter(OutletSettings.outlet_id == outlet.id).first()
    if not settings:
        settings = OutletSettings(
            outlet_id=outlet.id,
            store_manager=manager_name,
            store_manager_user_id=user_id,
            contact_phone=manager_phone or "077-0000000",
            parking="No restrictions",
        )
        db.add(settings)
    else:
        settings.store_manager = manager_name
        settings.store_manager_user_id = user_id
        if manager_phone is not None:
            settings.contact_phone = manager_phone

    db.commit()
    db.refresh(settings)

    try:
        from app.api.v1.endpoints.admin import record_audit
        record_audit(
            action_type="OUTLET_MUTATION",
            entity_name="Outlet Manager Assignment",
            entity_id=str(outlet.id),
            summary=f"Assigned store manager '{manager_name or 'Unassigned'}' to outlet {outlet.code}.",
            severity="INFO",
        )
    except Exception:
        pass

    return get_outlet(outlet.id, db)


@router.get("/{outlet_id}/settings", response_model=OutletSettingsRead)
def get_outlet_settings(
    outlet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Retrieve outlet profile, delivery & unloading parameters, and access preferences."""
    deps.ensure_store_outlet_ref(db, current_user, outlet_id)
    return outlet_service.get_settings(db, outlet_id)


@router.patch("/{outlet_id}/settings", response_model=OutletSettingsRead)
def update_outlet_settings(
    outlet_id: str,
    update_data: OutletSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Update editable outlet contacts and notification/access preferences."""
    deps.ensure_store_outlet_ref(db, current_user, outlet_id)
    return outlet_service.update_settings(db, outlet_id, update_data)


@router.post("/{outlet_id}/settings/reset", response_model=OutletSettingsRead)
def reset_outlet_settings(
    outlet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Reset editable outlet settings to default verified values."""
    deps.ensure_store_outlet_ref(db, current_user, outlet_id)
    return outlet_service.reset_settings(db, outlet_id)
