from datetime import datetime, timezone
from typing import Dict, Type
from sqlalchemy import Column, DateTime, Float, Integer, String
from app.core.database import Base
from app.models.reference import Brand


class CatalogueItemColumns:
    """The depot items a store can order, from docs/<brand>_cargo_specs.csv.

    One table per brand, so each store only ever reads its own chain's items. Kept separate from the
    Dispatcher's inventory_items (stock levels). Weight and volume are per carton, the unit stores order in.
    """

    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String(50), unique=True, index=True, nullable=False)
    # Full catalogue name, e.g. "Greek Yogurt 500g - 12 unit Chilled Carton".
    name = Column(String(255), nullable=False)
    unit_weight_kg = Column(Float, nullable=False)
    unit_volume_m3 = Column(Float, nullable=False)
    temperature_zone = Column(String(20), nullable=False)  # Chilled / Ambient
    depot_name = Column(String(100), nullable=True)
    # When the spec was last updated at source (the CSV's last_updated).
    spec_updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class FreshItem(CatalogueItemColumns, Base):
    __tablename__ = "fresh_items"


class StyleItem(CatalogueItemColumns, Base):
    __tablename__ = "style_items"


class TechItem(CatalogueItemColumns, Base):
    __tablename__ = "tech_items"


CATALOGUE_BY_BRAND: Dict[Brand, Type[CatalogueItemColumns]] = {
    Brand.FRESH: FreshItem,
    Brand.STYLE: StyleItem,
    Brand.TECH: TechItem,
}
