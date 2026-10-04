import csv
import io
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from app.core.exceptions import OrderRuleError
from app.models.reference import Outlet
from app.models.store_stock import StoreStockItem
from app.services.catalogue_service import catalogue_service, split_name

SKU_COLUMNS = ("sku", "item_sku", "product_sku")
QUANTITY_COLUMNS = ("quantity_on_hand", "on_hand", "quantity", "qty", "stock")
MAX_ROWS = 5000


def _column(fieldnames: List[str], options: Tuple[str, ...]) -> Optional[str]:
    by_name = {name.strip().lower(): name for name in fieldnames if name}
    return next((by_name[option] for option in options if option in by_name), None)


class StoreStockService:
    """The store's on-hand stock, from the manager's CSV import (one snapshot per outlet)."""

    @staticmethod
    def get_stock(db: Session, outlet: Outlet) -> List[StoreStockItem]:
        return db.query(StoreStockItem).filter(StoreStockItem.outlet_id == outlet.id).order_by(StoreStockItem.sku).all()

    @staticmethod
    def names_for(db: Session, outlet: Outlet, skus) -> Dict[str, Tuple[str, Optional[str]]]:
        """sku -> (item name, pack label) from the outlet's brand catalogue."""
        return {sku: split_name(item.name) for sku, item in catalogue_service.items_by_sku(db, outlet, skus).items()}

    @staticmethod
    def import_csv(db: Session, outlet: Outlet, content: str, now: datetime) -> dict:
        """Replaces the outlet's stock with the CSV. Rows that can't be used are skipped and reported.

        Nothing changes if the file has no usable rows, so a bad upload never wipes the last good count.
        """
        reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))
        fieldnames = reader.fieldnames or []
        sku_column = _column(fieldnames, SKU_COLUMNS)
        quantity_column = _column(fieldnames, QUANTITY_COLUMNS)
        if not sku_column or not quantity_column:
            raise OrderRuleError(
                "The CSV needs a 'sku' column and a 'quantity_on_hand' (or 'quantity') column.",
                code="STOCK_CSV_COLUMNS",
                details={"found_columns": fieldnames},
            )

        rows = list(reader)
        if len(rows) > MAX_ROWS:
            raise OrderRuleError(f"The CSV has more than {MAX_ROWS} rows.", code="STOCK_CSV_TOO_LARGE")

        parsed: Dict[str, int] = {}
        skipped = []
        for line, row in enumerate(rows, start=2):  # line 1 is the header
            sku = (row.get(sku_column) or "").strip().upper()
            raw = (row.get(quantity_column) or "").strip()
            if not sku and not raw:
                continue  # blank line
            if not sku:
                skipped.append({"line": line, "sku": None, "reason": "No SKU"})
                continue
            try:
                quantity = int(float(raw))
                if quantity < 0 or float(raw) != quantity:
                    raise ValueError
            except ValueError:
                skipped.append({"line": line, "sku": sku, "reason": f"Quantity '{raw}' isn't a whole number of 0 or more"})
                continue
            if sku in parsed:
                skipped.append({"line": line, "sku": sku, "reason": "Listed twice; the first row was used"})
                continue
            parsed[sku] = quantity

        known = catalogue_service.items_by_sku(db, outlet, parsed)
        for sku in [sku for sku in parsed if sku not in known]:
            skipped.append({"line": None, "sku": sku, "reason": f"Not in {outlet.name}'s catalogue"})
            del parsed[sku]

        if not parsed:
            raise OrderRuleError(
                "None of the rows could be imported, so your current stock list was kept.",
                code="STOCK_CSV_EMPTY",
                details={"skipped": skipped},
            )

        db.query(StoreStockItem).filter(StoreStockItem.outlet_id == outlet.id).delete()
        db.add_all(
            StoreStockItem(outlet_id=outlet.id, sku=sku, quantity_on_hand=quantity, imported_at=now)
            for sku, quantity in parsed.items()
        )
        db.commit()
        return {"imported": len(parsed), "skipped": skipped, "imported_at": now}


store_stock_service = StoreStockService()
