from typing import Dict, Iterable, List, Optional, Tuple
from sqlalchemy.orm import Session
from app.models.catalogue import CATALOGUE_BY_BRAND, CatalogueItemColumns
from app.models.reference import Outlet


def split_name(name: str) -> Tuple[str, Optional[str]]:
    """"Greek Yogurt 500g - 12 unit Chilled Carton" -> ("Greek Yogurt 500g", "12 unit Chilled Carton")."""
    item_name, separator, pack = name.rpartition(" - ")
    return (item_name, pack) if separator else (name, None)


class CatalogueService:
    """The depot items a store can order. Each brand reads only its own table (fresh_items, style_items, tech_items)."""

    @staticmethod
    def items_for_outlet(db: Session, outlet: Outlet) -> List[CatalogueItemColumns]:
        model = CATALOGUE_BY_BRAND.get(outlet.brand)
        if model is None:
            return []
        return db.query(model).order_by(model.name).all()

    @staticmethod
    def items_by_sku(db: Session, outlet: Outlet, skus: Iterable[str]) -> Dict[str, CatalogueItemColumns]:
        """Only the requested SKUs that are in the outlet's brand catalogue."""
        model = CATALOGUE_BY_BRAND.get(outlet.brand)
        wanted = set(skus)
        if model is None or not wanted:
            return {}
        return {item.sku: item for item in db.query(model).filter(model.sku.in_(wanted)).all()}


catalogue_service = CatalogueService()
