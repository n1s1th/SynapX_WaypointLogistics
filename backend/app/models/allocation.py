import enum
from datetime import datetime, timezone
from sqlalchemy import String, Float, ForeignKey, DateTime, Enum, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class AllocationStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ALLOCATED = "ALLOCATED"
    READY = "READY"
    LOADING = "LOADING"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    UNAVAILABLE = "UNAVAILABLE"
    AVAILABLE = "AVAILABLE"


class Allocation(Base):
    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), nullable=False)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("driver_profiles.id"), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True) # e.g. RUN-024 — unique so delivery_runs.allocation_id FK is safe
    
    load_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    volume_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    departure_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    planned_stop_codes: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    route_plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[AllocationStatus] = mapped_column(Enum(AllocationStatus), default=AllocationStatus.DRAFT, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    vehicle = relationship("Vehicle", back_populates="allocations")
    driver = relationship("DriverProfile", back_populates="allocations")
    # Orders can be linked to allocations
    orders = relationship("Order", back_populates="allocation")
    # DispatchTrips are linked to allocations
    dispatch_trips = relationship("DispatchTrip", backref="allocation")
