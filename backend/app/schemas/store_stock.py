from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class StoreStockRow(BaseModel):
    sku: str
    name: Optional[str] = None
    pack_label: Optional[str] = None
    quantity_on_hand: int


class StoreStockRead(BaseModel):
    """The store's on-hand list from its last CSV import. imported_at is null before the first import."""

    imported_at: Optional[datetime] = None
    items: List[StoreStockRow] = []


class SkippedStockRow(BaseModel):
    line: Optional[int] = None
    sku: Optional[str] = None
    reason: str


class StoreStockImportResult(BaseModel):
    imported: int
    skipped: List[SkippedStockRow] = []
    imported_at: datetime
