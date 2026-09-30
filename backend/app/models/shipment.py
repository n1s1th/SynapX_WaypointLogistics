import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class ShipmentStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_TRANSIT = "IN_TRANSIT"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"


class DispatchTrip(Base):
    __tablename__ = "dispatch_trips"

    id = Column(Integer, primary_key=True, index=True)
    trip_code = Column(String(50), unique=True, index=True, nullable=False)
    
    allocation_id = Column(Integer, ForeignKey("allocations.id"), nullable=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id"), nullable=True)

    vehicle_number = Column(String(50), nullable=False)
    driver_name = Column(String(255), nullable=False)
    
    origin = Column(String(255), nullable=False)
    destination = Column(String(255), nullable=False)
    depot_name = Column(String(50), nullable=True)

    status = Column(String(50), default="scheduled", nullable=False)

    departure_time = Column(DateTime, nullable=True)
    estimated_arrival = Column(DateTime, nullable=True)
    actual_arrival = Column(DateTime, nullable=True)

    total_weight_kg = Column(Float, default=0.0, nullable=False)
    total_volume_m3 = Column(Float, default=0.0, nullable=False)
    stop_count = Column(Integer, default=0, nullable=False)
    stops_completed = Column(Integer, default=0, nullable=False)
    stop_sequence = Column(JSON, nullable=True)
    
    open_shortfalls = Column(Integer, default=0, nullable=False)
    loading_events = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    shipments = relationship("Shipment", back_populates="dispatch_trip")


class Shipment(Base):
    __tablename__ = "shipments"

    id = Column(Integer, primary_key=True, index=True)
    tracking_number = Column(String(100), unique=True, index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    dispatch_trip_id = Column(Integer, ForeignKey("dispatch_trips.id"), nullable=True)
    status = Column(Enum(ShipmentStatus), default=ShipmentStatus.PENDING, nullable=False)
    current_location = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    last_updated = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    order = relationship("Order", back_populates="shipment")
    dispatch_trip = relationship("DispatchTrip", back_populates="shipments")
