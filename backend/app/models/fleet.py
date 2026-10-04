import enum
from datetime import datetime, timezone
from sqlalchemy import String, Float, ForeignKey, DateTime, Enum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class VehicleStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    ALLOCATED = "ALLOCATED"
    LOADING = "LOADING"
    UNAVAILABLE = "UNAVAILABLE"


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False) # e.g. VEH014
    vehicle_type: Mapped[str] = mapped_column(String(50), nullable=False) # "truck" or "van"
    capacity_kg: Mapped[float] = mapped_column(Float, nullable=False)
    capacity_vol_m3: Mapped[float] = mapped_column(Float, nullable=False)  # required — no default; loader reads this for capacity bars
    status: Mapped[VehicleStatus] = mapped_column(Enum(VehicleStatus), default=VehicleStatus.AVAILABLE, nullable=False)

    temperature_mode: Mapped[str] = mapped_column(String(50), nullable=False, default="ambient")   # "reefer" or "ambient"
    depot_name: Mapped[str] = mapped_column(String(100), nullable=False, default="peliyagoda")      # "peliyagoda" or "kandy"
    weekly_fuel_status: Mapped[str] = mapped_column(String(50), nullable=False, default="Within quota")
    trips_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trips_planned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    maintenance_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fuel_type: Mapped[str] = mapped_column(String(50), nullable=False, default="diesel")
    km_per_l: Mapped[float] = mapped_column(Float, nullable=False, default=6.0)
    weekly_fuel_quota_l: Mapped[float] = mapped_column(Float, nullable=False, default=500.0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    driver = relationship("DriverProfile", back_populates="vehicle", uselist=False)
    allocations = relationship("Allocation", back_populates="vehicle")


class DriverProfile(Base):
    """Extended profile for users with DRIVER role."""
    __tablename__ = "driver_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    license_type: Mapped[str] = mapped_column(String(50), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    assigned_vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", backref="driver_profile")
    vehicle = relationship("Vehicle", back_populates="driver")
    allocations = relationship("Allocation", back_populates="driver")
