import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum, Boolean, Text
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.reference import Depot, TemperatureClass


class OrderStatus(str, enum.Enum):
    """Order lifecycle (docs/store-manager-contract.md §1).

    DRAFT…CANCELLED are in Neon (Nisith's migration 0a80c3e0353c). SUBMITTED, READY_FOR_DISPATCH and
    COMPLETED are the Store Manager additions and still need adding to the Postgres enum by the
    Store Manager migration.
    """

    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    CONFIRMED = "CONFIRMED"
    PROCESSING = "PROCESSING"
    ALLOCATED = "ALLOCATED"
    READY_FOR_DISPATCH = "READY_FOR_DISPATCH"
    DEFERRED = "DEFERRED"
    DISPATCHED = "DISPATCHED"
    DELIVERED = "DELIVERED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, index=True, nullable=False)
    client_name = Column(String(255), nullable=False)
    destination_address = Column(String(500), nullable=False)
    status = Column(Enum(OrderStatus), default=OrderStatus.DRAFT, nullable=False)
    total_amount = Column(Float, default=0.0)
    brand = Column(String(100), nullable=True)
    district = Column(String(100), nullable=True)
    temperature_zone = Column(String(50), default="Ambient", nullable=False)
    delivery_window = Column(String(50), nullable=True)
    weight_kg = Column(Float, default=0.0, nullable=False)
    is_priority = Column(Boolean, default=False, nullable=False)
    allocation_id = Column(Integer, ForeignKey("allocations.id"), nullable=True)
    is_late = Column(Boolean, default=False, nullable=False)
    # Requested delivery date as YYYY-MM-DD (Store Manager uses this as the delivery date).
    operating_date = Column(String(50), nullable=True)
    deferral_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Loader order fields (Sachintha, migration 0003_order_loader_fields).
    # brand and weight_kg above are Nisith's (0a80c3e0353c); the loader reads those.
    outlet_id = Column(Integer, ForeignKey("outlets.id"), nullable=True)
    # The depot that fulfils and dispatches this order.  Keep this directly on
    # the order rather than deriving it from the outlet: an outlet relationship
    # may be absent for legacy data, while dispatch scoping must always work.
    depot = Column(Enum(Depot), default=Depot.PELIYAGODA, nullable=False, index=True)
    temperature_class = Column(Enum(TemperatureClass), nullable=True)
    units = Column(Integer, nullable=True)
    volume_m3 = Column(Float, nullable=True)

    # Store Manager fields (Dev A migration, 0004_store_manager).
    submitted_at = Column(DateTime, nullable=True)
    cutoff_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    placed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    deferral_count = Column(Integer, default=0, nullable=False)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    shipment = relationship("Shipment", back_populates="order", uselist=False)
    allocation = relationship("Allocation", back_populates="orders")
    outlet = relationship("Outlet")
    # Read-only: the loader writes these (loader_issue.py); the store reads its shortfall from them.
    loader_issues = relationship("LoaderIssue", viewonly=True)
    receipt = relationship("DeliveryReceipt", back_populates="order", uselist=False)

    @property
    def estimated_arrival(self):
        if self.shipment and self.shipment.dispatch_trip:
            return self.shipment.dispatch_trip.estimated_arrival
        if self.allocation and self.allocation.dispatch_trips:
            dt = self.allocation.dispatch_trips
            if isinstance(dt, list):
                if dt:
                    return dt[0].estimated_arrival
            else:
                return dt.estimated_arrival
        return None

    @property
    def requires_van(self) -> bool:
        return self.outlet.van_only if self.outlet else False


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    sku = Column(String(100), nullable=False)
    item_name = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)

    # Dev B store receiving extensions (contract §2)
    quantity_sent = Column(Integer, nullable=True)
    dispatcher_note = Column(Text, nullable=True)

    order = relationship("Order", back_populates="items")
