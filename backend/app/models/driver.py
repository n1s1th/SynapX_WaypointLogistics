import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base

class DriverTripStatus(str, enum.Enum):
    ASSIGNED = "assigned"
    STARTED = "started"
    COMPLETED = "completed"

class DeliveryStopStatus(str, enum.Enum):
    PENDING = "pending"
    ARRIVED = "arrived"
    DELIVERED = "delivered"
    FAILED = "failed"
    PARTIAL = "partial"
    RESCHEDULED = "rescheduled"

class IssueType(str, enum.Enum):
    VEHICLE_BREAKDOWN = "vehicle_breakdown"
    TRAFFIC_DELAY = "traffic_delay"
    CUSTOMER_UNAVAILABLE = "customer_unavailable"
    DAMAGED_GOODS = "damaged_goods"
    WRONG_ADDRESS = "wrong_address"
    OTHER = "other"

class IssueStatus(str, enum.Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"

class SOSStatus(str, enum.Enum):
    TRIGGERED = "triggered"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class DriverTrip(Base):
    __tablename__ = "driver_trips"

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    dispatch_trip_id = Column(Integer, ForeignKey("dispatch_trips.id"), nullable=False)
    status = Column(Enum(DriverTripStatus), default=DriverTripStatus.ASSIGNED, nullable=False)
    assigned_date = Column(DateTime, default=lambda: datetime.now(timezone.utc).date())
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    driver = relationship("User")
    dispatch_trip = relationship("DispatchTrip")
    stops = relationship("DeliveryStop", back_populates="driver_trip", cascade="all, delete-orphan")
    issues = relationship("IssueReport", back_populates="driver_trip")


class DeliveryStop(Base):
    __tablename__ = "delivery_stops"

    id = Column(Integer, primary_key=True, index=True)
    driver_trip_id = Column(Integer, ForeignKey("driver_trips.id"), nullable=False)
    shipment_id = Column(Integer, ForeignKey("shipments.id"), nullable=True)
    sequence = Column(Integer, nullable=False)
    address = Column(String(500), nullable=False)
    customer_name = Column(String(255), nullable=False)
    customer_phone = Column(String(50), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    notes = Column(String(1000), nullable=True)
    status = Column(Enum(DeliveryStopStatus), default=DeliveryStopStatus.PENDING, nullable=False)
    # Why a stop failed, e.g. "Refused by outlet" (migration 0006). Refused is a
    # failed stop with this reason rather than its own status.
    outcome_reason = Column(String(255), nullable=True)
    arrived_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    driver_trip = relationship("DriverTrip", back_populates="stops")
    shipment = relationship("Shipment")
    pod = relationship("ProofOfDelivery", back_populates="stop", uselist=False)


class ProofOfDelivery(Base):
    __tablename__ = "proof_of_delivery"

    id = Column(Integer, primary_key=True, index=True)
    stop_id = Column(Integer, ForeignKey("delivery_stops.id"), unique=True, nullable=False)
    recipient_name = Column(String(255), nullable=False)
    signature_data = Column(Text, nullable=True)
    photo_url = Column(Text, nullable=True)
    notes = Column(String(1000), nullable=True)
    # {sku: units handed over} (migration 0006)
    delivered_items = Column(JSON, nullable=True)
    # When the driver captured it on the phone; created_at is when the server received it
    captured_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    stop = relationship("DeliveryStop", back_populates="pod")


class IssueReport(Base):
    __tablename__ = "issue_reports"

    id = Column(Integer, primary_key=True, index=True)
    stop_id = Column(Integer, ForeignKey("delivery_stops.id"), nullable=True)
    driver_trip_id = Column(Integer, ForeignKey("driver_trips.id"), nullable=False)
    issue_type = Column(Enum(IssueType), nullable=False)
    description = Column(String(2000), nullable=False)
    photo_url = Column(Text, nullable=True)
    status = Column(Enum(IssueStatus), default=IssueStatus.OPEN, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    driver_trip = relationship("DriverTrip", back_populates="issues")
    stop = relationship("DeliveryStop")


class SOSAlert(Base):
    __tablename__ = "sos_alerts"

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    driver_trip_id = Column(Integer, ForeignKey("driver_trips.id"), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    message = Column(String(500), nullable=True)
    status = Column(Enum(SOSStatus), default=SOSStatus.TRIGGERED, nullable=False)
    triggered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime, nullable=True)

    driver = relationship("User")
    driver_trip = relationship("DriverTrip")


class SyncEventStatus(str, enum.Enum):
    APPLIED = "applied"
    CONFLICT = "conflict"
    REJECTED = "rejected"


class DriverSyncEvent(Base):
    """Ledger of every write the driver's phone sent through /driver/sync (migration 0006).

    client_action_id is generated once per tap on the phone and is unique, so a
    replay (retry after a lost response, or a second tab) returns the stored
    result instead of being applied twice. Conflicts stay here for dispatcher
    review; nothing is resolved automatically.
    """

    __tablename__ = "driver_sync_events"

    id = Column(Integer, primary_key=True, index=True)
    client_action_id = Column(String(64), unique=True, index=True, nullable=False)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action_type = Column(String(32), nullable=False)
    trip_id = Column(Integer, nullable=True, index=True)
    stop_id = Column(Integer, nullable=True)
    status = Column(String(16), nullable=False)
    code = Column(String(64), nullable=True)
    message = Column(String(500), nullable=True)
    # Server state after applying (or the state that caused the conflict)
    result = Column(JSON, nullable=True)
    # What the driver recorded, minus signature/photo data, for conflict review
    payload_summary = Column(JSON, nullable=True)
    client_timestamp = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    review_note = Column(String(500), nullable=True)
