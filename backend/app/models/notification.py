import enum
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.reference import Depot


class NotificationType(str, enum.Enum):
    """docs/reference/store-manager-contract.md §4."""

    ORDER_SUBMITTED = "order_submitted"
    ORDER_CONFIRMED = "order_confirmed"
    DISPATCHER_NOTE = "dispatcher_note"
    SHORTFALL_WARNING = "shortfall_warning"
    DEFERRED = "deferred"
    READY_FOR_DISPATCH = "ready_for_dispatch"
    ETA_UPDATED = "eta_updated"
    DELIVERED = "delivered"
    ISSUE_LOGGED = "issue_logged"
    ORDER_CLOSED = "order_closed"
    # To a driver and a depot's dispatcher, not a store: the loader released a run.
    RUN_RELEASED = "run_released"


class NotificationCategory(str, enum.Enum):
    """The Requests / Deliveries / Issues tabs on the Store Manager Notifications screen."""

    REQUEST = "request"
    DELIVERY = "delivery"
    ISSUE = "issue"


class Notification(Base):
    """One in-app notice. A Store Manager's has outlet_id; a driver's has
    recipient_user_id; a depot dispatcher's has recipient_depot (dispatchers
    are scoped by depot, and in dev mode are not real users)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_outlet_is_read", "outlet_id", "is_read"),)

    id = Column(Integer, primary_key=True, index=True)
    outlet_id = Column(Integer, ForeignKey("outlets.id"), nullable=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    recipient_depot = Column(Enum(Depot), nullable=True, index=True)
    dispatch_trip_id = Column(Integer, ForeignKey("dispatch_trips.id"), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    type = Column(Enum(NotificationType), nullable=False)
    category = Column(Enum(NotificationCategory), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    order = relationship("Order")

    @property
    def order_number(self):
        """Lets the Notifications screen link to the order without a second request."""
        return self.order.order_number if self.order is not None else None
