import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Date, Integer, String, Float, ForeignKey, DateTime, Enum, Text, UniqueConstraint
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


class DriverAvailability(Base):
    """A driver telling dispatch they can take a run on the next operating day.

    Migration 0006_driver_availability. One row per driver per day; confirming
    again is a no-op, so the tap can be queued offline and replayed safely.
    """

    __tablename__ = "driver_availability"
    __table_args__ = (UniqueConstraint("driver_id", "for_date", name="uq_driver_availability_day"),)

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    for_date = Column(Date, nullable=False)
    confirmed_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    driver = relationship("User")
