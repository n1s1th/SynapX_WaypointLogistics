from typing import Optional
from pydantic import BaseModel


class CatalogueItemRead(BaseModel):
    """One orderable item for New Goods Request (Figma 03b). Weight and volume are per carton."""

    sku: str
    name: str
    # The pack from the end of the catalogue name, e.g. "12 unit Chilled Carton".
    pack_label: Optional[str] = None
    brand: str
    temperature_zone: str
    unit_weight_kg: float
    unit_volume_m3: float
