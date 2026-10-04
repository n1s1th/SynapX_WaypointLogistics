from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    location = Column(String(255), nullable=False)
    capacity_sqft = Column(Float, nullable=True)

    items = relationship("InventoryItem", back_populates="warehouse")


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    quantity = Column(Integer, default=0, nullable=False)
    unit_price = Column(Float, default=0.0)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    chain = Column(String(50), nullable=True)  # fresh, style, tech
    unit_weight_kg = Column(Float, default=0.0)
    unit_volume_m3 = Column(Float, default=0.0)
    temp_requirement = Column(String(50), default="Ambient")
    depot_name = Column(String(100), nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    warehouse = relationship("Warehouse", back_populates="items")
