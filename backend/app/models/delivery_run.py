import enum
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Enum, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.reference import Brand


class RunStatus(str, enum.Enum):
    """Lifecycle of a run on the loading dock.

    LOADED and READY_TO_DEPART are deliberately distinct: every order is on the
    truck, but the loader has not signed the run off yet. The design calls for an
    unambiguous departure state, so "all checked" must not imply "ready".

    Once the driver leaves the gate the run is GATED_OUT and drops off the loader's
    queue - from there it is the driver's job.
    """

    NOT_STARTED = "not_started"
    LOADING = "loading"
    ISSUE_FLAGGED = "issue_flagged"
    LOADED = "loaded"
    READY_TO_DEPART = "ready_to_depart"
    GATED_OUT = "gated_out"


class StopStatus(str, enum.Enum):
    PENDING = "pending"
    LOADING = "loading"
    COMPLETE = "complete"


class RunOrderState(str, enum.Enum):
    """Per-order state on the checklist.

    These are exactly the seven `Order row` variants in the Figma component set.
    """

    TO_LOAD = "to_load"
    LOADED = "loaded"
    FLAGGED = "flagged"
    RE_CHECK = "re_check"
    TAKE_OFF = "take_off"
    MOVED = "moved"
    NEW = "new"


class DeliveryRun(Base):
    """One vehicle's trip out of a dock, as the loader sees it ("RUN-021").

    Intentionally NOT an extension of DispatchTrip/Shipment. Those are owned by the
    dispatcher team and have no concept of stop sequence, plan version, dock or
    brand. `dispatch_trip_id` links the two: a dispatched allocation becomes one
    loader run (LoaderService.create_run_for_dispatch_trip), at most one per trip.
    Runs with no trip (the demo seeds) keep it null and are left alone.

    planned_* are what the current plan version says the run should carry;
    loaded_* are what is physically on the truck so far. The checklist capacity
    bars show loaded over the vehicle limit, with planned as the marker.
    """

    __tablename__ = "delivery_runs"
    __table_args__ = (
        # One loader run per dispatch trip; NULLs repeat (runs not from a trip).
        Index("uq_delivery_runs_dispatch_trip_id", "dispatch_trip_id", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    dock_id = Column(Integer, ForeignKey("docks.id"), nullable=False)
    trip_number = Column(Integer, default=1, nullable=False)
    brand = Column(Enum(Brand), nullable=False)
    district = Column(String(100), nullable=False)
    wave = Column(String(50), nullable=True)
    departs_at = Column(DateTime, nullable=False)
    status = Column(Enum(RunStatus), default=RunStatus.NOT_STARTED, nullable=False)
    current_plan_version = Column(Integer, default=1, nullable=False)

    planned_weight_kg = Column(Float, default=0.0, nullable=False)
    planned_volume_m3 = Column(Float, default=0.0, nullable=False)
    loaded_weight_kg = Column(Float, default=0.0, nullable=False)
    loaded_volume_m3 = Column(Float, default=0.0, nullable=False)

    released_at = Column(DateTime, nullable=True)
    released_by_id = Column(Integer, ForeignKey("loader_users.id"), nullable=True)
    gated_out_at = Column(DateTime, nullable=True)

    # The dispatcher's trip this run was built from (docs/reference/loader/INTEGRATION_DESIGN.md).
    dispatch_trip_id = Column(Integer, ForeignKey("dispatch_trips.id"), nullable=True)

    # The driver's "Arrived at dock" tap. Until then the run is built (plan v1
    # from the dispatcher) but hidden from the loader queue. On arrival dock_id
    # follows the truck, so arrived_dock_id is where it actually pulled in.
    arrived_at = Column(DateTime, nullable=True)
    arrived_dock_id = Column(Integer, ForeignKey("docks.id"), nullable=True)

    # The pick lock: one loader works a run at a time. Live while that
    # session is open and recently seen (LoaderService.pick_holder).
    picked_by_id = Column(Integer, ForeignKey("loader_users.id"), nullable=True)
    picked_session_id = Column(Integer, ForeignKey("loader_sessions.id"), nullable=True)
    picked_at = Column(DateTime, nullable=True)

    # When the driver and dispatcher were told about the current release.
    release_notified_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("Vehicle")
    dock = relationship("Dock", foreign_keys=[dock_id])
    arrived_dock = relationship("Dock", foreign_keys=[arrived_dock_id])
    released_by = relationship("LoaderUser", foreign_keys=[released_by_id])
    picked_by = relationship("LoaderUser", foreign_keys=[picked_by_id])
    picked_session = relationship("LoaderSession", foreign_keys=[picked_session_id])
    stops = relationship(
        "RunStop",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunStop.stop_sequence",
    )


class RunStop(Base):
    """One outlet on a run.

    Two orderings matter and they are opposite, so both are stored rather than one
    being derived at read time:

    - stop_sequence is the delivery order the driver follows (1 first).
    - load_position is the loading order, deepest first - stop_sequence reversed.
      The checklist works down load_position ("LOAD 1ST - DEEPEST"), because the
      last stop has to go in at the cab end.
    """

    __tablename__ = "run_stops"
    __table_args__ = (
        UniqueConstraint("run_id", "plan_version", "stop_sequence", name="uq_run_stop_sequence"),
    )

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("delivery_runs.id"), nullable=False)
    plan_version = Column(Integer, default=1, nullable=False)
    stop_sequence = Column(Integer, nullable=False)
    load_position = Column(Integer, nullable=False)
    outlet_id = Column(Integer, ForeignKey("outlets.id"), nullable=False)
    eta = Column(DateTime, nullable=True)
    handling_minutes = Column(Integer, nullable=True)
    status = Column(Enum(StopStatus), default=StopStatus.PENDING, nullable=False)

    run = relationship("DeliveryRun", back_populates="stops")
    outlet = relationship("Outlet")
    orders = relationship(
        "RunStopOrder",
        back_populates="run_stop",
        cascade="all, delete-orphan",
    )


class RunStopOrder(Base):
    """An order placed at a stop on a run - one checklist row.

    units / weight_kg / volume_m3 are snapshotted from the order at plan time.
    A later plan version may drop or re-add the order, and the loader still needs
    to see what this version said it was carrying.

    `state` is the denormalised current value so the checklist reads cheaply;
    LoadingCheck holds the append-only history behind it.
    """

    __tablename__ = "run_stop_orders"
    __table_args__ = (
        UniqueConstraint("run_stop_id", "order_id", name="uq_run_stop_order"),
    )

    id = Column(Integer, primary_key=True, index=True)
    run_stop_id = Column(Integer, ForeignKey("run_stops.id"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    plan_version = Column(Integer, default=1, nullable=False)
    state = Column(Enum(RunOrderState), default=RunOrderState.TO_LOAD, nullable=False)

    units = Column(Integer, nullable=True)
    weight_kg = Column(Float, nullable=True)
    volume_m3 = Column(Float, nullable=True)

    checked_at = Column(DateTime, nullable=True)
    checked_by_id = Column(Integer, ForeignKey("loader_users.id"), nullable=True)

    run_stop = relationship("RunStop", back_populates="orders")
    order = relationship("Order")
    checked_by = relationship("LoaderUser")
