from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from app.core.database import Base


class StoreStockItem(Base):
    """What a store has on its shelves, from the manager's last CSV import.

    Each import replaces the outlet's whole list (it's a stock count, not a delta). SKUs are the outlet's
    brand catalogue SKUs (fresh_items / style_items / tech_items).
    """

    __tablename__ = "store_stock"
    __table_args__ = (UniqueConstraint("outlet_id", "sku", name="uq_store_stock_outlet_sku"),)

    id = Column(Integer, primary_key=True, index=True)
    outlet_id = Column(Integer, ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True)
    sku = Column(String(50), nullable=False)
    quantity_on_hand = Column(Integer, nullable=False)
    imported_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
