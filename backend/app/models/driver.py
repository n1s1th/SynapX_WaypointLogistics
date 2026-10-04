import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Date, DateTime, Enum, Text, UniqueConstraint
from sqlalchemy.orm import object_session, relationship
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

    @property
    def planned_departure(self):
        """The dispatcher's departure time for this trip (not a column)."""
        return self.dispatch_trip.departure_time if self.dispatch_trip else None

    @property
    def run_code(self):
        """The run's code the dispatcher and loader use, e.g. RUN-0067 (not a column)."""
        return self.dispatch_trip.trip_code if self.dispatch_trip else None

    @property
    def vehicle_number(self):
        """The truck on this trip, e.g. VEH005 (not a column)."""
        return self.dispatch_trip.vehicle_number if self.dispatch_trip else None

    @property
    def depot_name(self):
        """The depot of the trip's truck (set by Admin), e.g. peliyagoda (not a column).
        Copied onto the dispatcher's trip at dispatch; else read from the truck."""
        trip = self.dispatch_trip
        if trip is None:
            return None
        if trip.depot_name:
            return trip.depot_name
        session = object_session(self)
        if trip.vehicle_id is None or session is None:
            return None
        from app.models.fleet import Vehicle
        vehicle = session.get(Vehicle, trip.vehicle_id)
        return vehicle.depot_name if vehicle is not None else None


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
    # The store this stop delivers to (outlet names aren't unique), and when the
    # truck is expected there: set when the trip starts, moved on by a reported delay
    outlet_id = Column(Integer, ForeignKey("outlets.id"), nullable=True, index=True)
    eta = Column(DateTime, nullable=True)

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
    # photo_url is in the table (migration 0016_sos_photo) but not mapped: saving and reading
    # an SOS never name it, so both keep working on a database where the migration hasn't
    # run yet. driver_service._save_sos_photo writes it through the table.
    __mapper_args__ = {"exclude_properties": ["photo_url"]}

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    driver_trip_id = Column(Integer, ForeignKey("driver_trips.id"), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    message = Column(String(500), nullable=True)
    photo_url = Column(Text, nullable=True)  # Cloudflare R2 link to the driver's photo
    status = Column(Enum(SOSStatus), default=SOSStatus.TRIGGERED, nullable=False)
    triggered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime, nullable=True)

    driver = relationship("User")
    driver_trip = relationship("DriverTrip")


class DriverAvailability(Base):
    """A driver's "I'm ready" for a working day, so the dispatcher can plan around
    who is available (migration 0013_driver_availability)."""
    __tablename__ = "driver_availability"
    __table_args__ = (UniqueConstraint("driver_id", "for_date", name="uq_driver_availability_driver_day"),)

    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)  # users.id
    for_date = Column(Date, nullable=False, index=True)  # the working day the driver can take a run
    confirmed_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    driver = relationship("User")
