import enum
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, Time, Enum
from sqlalchemy.orm import deferred, relationship
from app.core.database import Base


class Depot(str, enum.Enum):
    PELIYAGODA = "peliyagoda"
    KANDY = "kandy"


class Brand(str, enum.Enum):
    FRESH = "fresh"
    STYLE = "style"
    TECH = "tech"

    @property
    def label(self) -> str:
        """How orders.brand (a plain string, Nisith's 0a80c3e0353c) spells it: "Fresh"."""
        return self.value.title()


class VehicleType(str, enum.Enum):
    """Loader API vocabulary for fleet.Vehicle.vehicle_type (a plain string column)."""

    TRUCK = "truck"
    VAN = "van"


class TempCapability(str, enum.Enum):
    """Loader API vocabulary for fleet.Vehicle.temperature_mode (a plain string column).

    Chilled orders may only ride on REEFER.
    """

    REEFER = "reefer"
    AMBIENT = "ambient"


class TemperatureClass(str, enum.Enum):
    """Temperature class of an order. Drives the Temp badge on the loader screens."""

    CHILLED = "chilled"
    AMBIENT = "ambient"


class DockType(str, enum.Enum):
    """How goods come off at the outlet. Affects how the loader arranges the load."""

    REAR_DOCK = "rear_dock"
    STREET = "street"
    MALL_BAY = "mall_bay"


class CalendarDay(Base):
    """One operating day. Seeded from calendar.csv."""

    __tablename__ = "calendar_days"

    date = Column(Date, primary_key=True, index=True)
    is_operating = Column(Boolean, default=True, nullable=False)
    festival_ramp = Column(Float, default=1.0, nullable=False)
    monsoon = Column(Boolean, default=False, nullable=False)
    holiday_name = Column(String(100), nullable=True)


# Vehicles are Thisaru's model, app.models.fleet.Vehicle (table `vehicles`). The loader
# reads code, vehicle_type, capacity_kg, capacity_vol_m3, temperature_mode and depot_name
# from it; see loader_service for how those map onto the loader API.


class Outlet(Base):
    """A store the run delivers to. Seeded from outlets.csv.

    van_only outlets cannot be served by a truck - the queue shows this as a chip.
    """

    __tablename__ = "outlets"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    brand = Column(Enum(Brand), nullable=False)
    district = Column(String(100), nullable=False)
    dock_type = Column(Enum(DockType), nullable=False)
    van_only = Column(Boolean, default=False, nullable=False)
    window_start = Column(Time, nullable=True)
    window_end = Column(Time, nullable=True)
    depot = Column(Enum(Depot), default=Depot.PELIYAGODA, nullable=False)
    # Deferred so existing loader/store reads work before the profile migration is applied.
    address = deferred(Column(String(500), nullable=True))
    active = deferred(Column(Boolean, default=True, nullable=False))
    delivery_restrictions = deferred(Column(Text, nullable=True))
    created_at = deferred(Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False))
    updated_at = deferred(Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False))
    contacts = relationship("OutletContact", back_populates="outlet", cascade="all, delete-orphan", order_by="OutletContact.id")
    receiving_windows = relationship("OutletReceivingWindow", back_populates="outlet", cascade="all, delete-orphan", order_by="OutletReceivingWindow.id")
    parking_constraint = Column(String(50), default="normal", nullable=False)
    mall_window = Column(String(50), nullable=True)


class Dock(Base):
    """A loading dock at a depot. Runs are queued per dock ("Dock 3")."""

    __tablename__ = "docks"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    depot = Column(Enum(Depot), default=Depot.PELIYAGODA, nullable=False)

    tablets = relationship("DockTablet", back_populates="dock")


class DockTablet(Base):
    """A shared tablet bolted to one dock.

    There is no depot picker at sign-in: the tablet's registration is what tells the
    app which dock's runs to show.
    """

    __tablename__ = "dock_tablets"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(100), unique=True, index=True, nullable=False)
    dock_id = Column(Integer, ForeignKey("docks.id"), nullable=False)
    device_token = Column(String(255), unique=True, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    dock = relationship("Dock", back_populates="tablets")
