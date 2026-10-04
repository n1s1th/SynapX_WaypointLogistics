from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api import deps
from app.models.reference import Outlet
from app.schemas.catalogue import CatalogueItemRead
from app.services.catalogue_service import catalogue_service, split_name

router = APIRouter()


@router.get("/", response_model=List[CatalogueItemRead])
def list_catalogue(outlet: Outlet = Depends(deps.get_store_outlet), db: Session = Depends(deps.get_db)):
    """Items the signed-in manager's outlet can order: only its own brand's table."""
    items = []
    for item in catalogue_service.items_for_outlet(db, outlet):
        name, pack = split_name(item.name)
        items.append(
            CatalogueItemRead(
                sku=item.sku,
                name=name,
                pack_label=pack,
                brand=outlet.brand.label,
                temperature_zone=item.temperature_zone,
                unit_weight_kg=item.unit_weight_kg,
                unit_volume_m3=item.unit_volume_m3,
            )
        )
    return items
