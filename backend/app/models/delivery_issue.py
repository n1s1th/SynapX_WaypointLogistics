from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class DeliveryIssue(Base):
    __tablename__ = "delivery_issues"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    order_number = Column(String(50), nullable=True, index=True)
    outlet_id = Column(Integer, ForeignKey("outlets.id"), nullable=True, index=True)
    issue_type = Column(String(50), nullable=False)  # Damaged Goods, Missing Items, Quantity Mismatch, Temperature Breach, Wrong Consignment, Other
    title = Column(String(255), nullable=False)
    affected_item = Column(String(255), nullable=True)
    sku = Column(String(100), nullable=True)
    expected_units = Column(Integer, nullable=True)
    received_units = Column(Integer, nullable=True)
    description = Column(Text, nullable=False)
    photo_url = Column(Text, nullable=True)
    photo_name = Column(String(255), nullable=True)
    photo_size = Column(String(100), nullable=True)
    reported_by = Column(String(255), default="Sarah Jenkins (Store Manager)", nullable=False)
    status = Column(String(50), default="open", nullable=False)  # open, under_review, resolved, credit_issued
    resolution_notes = Column(Text, nullable=True)
    claimed_amount = Column(String(50), nullable=True)
    driver_name = Column(String(255), nullable=True)
    vehicle_id = Column(String(50), nullable=True)
    reported_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    order = relationship("Order")
    outlet = relationship("Outlet")
