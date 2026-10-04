"""Recorded fuel inputs required for defensible allocation checks."""

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class VehicleFuelWeek(Base):
    """Cumulative litres used since Monday, verified by an operator.

    Updating this after a completed trip keeps the next allocation from relying
    on a stale balance. A missing week is *unknown*, never zero usage.
    """

    __tablename__ = "vehicle_fuel_weeks"
    __table_args__ = (
        UniqueConstraint("vehicle_id", "week_start", name="uq_vehicle_fuel_week"),
        CheckConstraint("liters_used >= 0", name="ck_vehicle_fuel_week_nonnegative"),
        Index("ix_vehicle_fuel_weeks_week_start", "week_start"),
    )

    id = Column(Integer, primary_key=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False)
    week_start = Column(Date, nullable=False)
    liters_used = Column(Float, nullable=False)
    source = Column(String(100), nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    vehicle = relationship("Vehicle")
