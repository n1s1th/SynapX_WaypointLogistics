"""Response shapes for the loader endpoints owned by L0/L4/L7/L8/L9.

Scope note: only the endpoints in this module's own features are modelled here.
The queue, sign-in and issue-list shapes (L2/L3/L5) are Sanduni's and are
proposed in docs/loader/API_CONTRACT.md for her to review rather than coded here.
"""
from datetime import date, datetime, time, timezone
from typing import Annotated, Dict, List, Optional, Union
from uuid import UUID

from pydantic import AfterValidator, AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field

from app.models.delivery_run import RunOrderState, RunStatus, StopStatus
from app.models.loader_activity import ActorKind
from app.models.loader_issue import IssueStatus, IssueType
from app.models.loader_user import SessionEndReason
from app.models.plan_revision import PlanChangeKind
from app.models.reference import Brand, DockType, TempCapability, TemperatureClass, VehicleType


def _as_utc(value: datetime) -> datetime:
    """Label a stored datetime as UTC so it serializes with a Z.

    Every datetime is stored in UTC in naive columns, so what comes back from
    the database has no tzinfo. Without this the API would send
    "2026-05-27T22:00:00", which a browser reads as its own local time.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Every loader datetime on the wire: ISO 8601 in UTC, e.g. "2026-05-27T22:00:00Z".
# The frontend formats them in depot time (Asia/Colombo). Outlet delivery
# windows are plain `time` values in depot time and are not converted.
UtcDateTime = Annotated[datetime, AfterValidator(_as_utc)]


def _lower(value):
    """fleet.Vehicle stores vehicle_type / temperature_mode as free strings; Neon
    has them lower case, but the column default is "Ambient"."""
    return value.lower() if isinstance(value, str) else value


# Vehicle columns as the loader API names them. Read from fleet.Vehicle
# (Thisaru's `vehicles` table), whose own names are the second alias.
LoaderVehicleType = Annotated[VehicleType, BeforeValidator(_lower)]
LoaderTempCapability = Annotated[TempCapability, BeforeValidator(_lower)]


class VehicleRead(BaseModel):
    """The run's vehicle, read from fleet.Vehicle.

    temperature_mode -> temp_capability, capacity_kg -> max_weight_kg,
    capacity_vol_m3 -> max_volume_m3. The API keeps the loader names.
    """

    code: str
    vehicle_type: LoaderVehicleType
    temp_capability: LoaderTempCapability = Field(
        validation_alias=AliasChoices("temp_capability", "temperature_mode")
    )
    max_weight_kg: float = Field(validation_alias=AliasChoices("max_weight_kg", "capacity_kg"))
    max_volume_m3: float = Field(validation_alias=AliasChoices("max_volume_m3", "capacity_vol_m3"))

    model_config = ConfigDict(from_attributes=True)


class OutletRead(BaseModel):
    code: str
    name: str
    brand: Brand
    district: str
    dock_type: DockType
    van_only: bool
    window_start: Optional[time] = None
    window_end: Optional[time] = None

    model_config = ConfigDict(from_attributes=True)


class CapacityRead(BaseModel):
    """Drives the two capacity bars: loaded over the vehicle limit, planned as marker."""

    loaded_weight_kg: float
    planned_weight_kg: float
    max_weight_kg: float
    loaded_volume_m3: float
    planned_volume_m3: float
    max_volume_m3: float


class MovedToRead(BaseModel):
    """Where a dont_load order went: "Moved to VEH003 · Trip 1 · 03:45".

    run_code is null when the other trip has no loader run yet, and departs_at
    when the dispatcher has not timed it. The frontend formats the time.
    """

    run_code: Optional[str] = None
    vehicle_code: str
    trip_number: int
    departs_at: Optional[UtcDateTime] = None


class RunOrderRead(BaseModel):
    order_number: str
    temperature_class: Optional[TemperatureClass] = None
    units: Optional[int] = None
    weight_kg: Optional[float] = None
    volume_m3: Optional[float] = None
    state: RunOrderState
    checked_at: Optional[UtcDateTime] = None
    checked_by: Optional[str] = None
    # Units actually on the truck: all of them once loaded (re_check and a
    # take_off not yet unloaded count, the goods are aboard), units minus the
    # flagged units for short / damaged / won't fit (0 if the flag has no
    # count), 0 for missing and for anything not loaded. "53 of 56 units will be loaded".
    loaded_units: int = 0

    # --- Plan diff (L7). All null on an order the latest change left alone.
    # Plan version whose change this row is showing.
    changed_in_version: Optional[int] = None
    # Which group of the diff the order is in. null for re_check (the loader
    # re-confirms it; the dispatcher did not change it) and for a rechecked row.
    change_kind: Optional[PlanChangeKind] = None
    # Short, time-free line for the row, e.g. "Take off the truck" or
    # "Re-check · moved to reach ORD0092308". Times are added by the frontend.
    note: Optional[str] = None
    # The dispatcher's own words for this order, shown in the diff card.
    reason: Optional[str] = None
    # Filled once plan_revision_changes stores the target (migration fix);
    # always null until then.
    moved_to: Optional[MovedToRead] = None
    deferred_to: Optional[date] = None
    # When the order came off the truck ("off truck 02:24") and who took it off.
    unloaded_at: Optional[UtcDateTime] = None
    unloaded_by: Optional[str] = None


class RunStopRead(BaseModel):
    stop_sequence: int
    load_position: int
    eta: Optional[UtcDateTime] = None
    handling_minutes: Optional[int] = None
    status: StopStatus
    outlet: OutletRead
    orders: List[RunOrderRead]
    # Against the plan before the latest change: "was Stop 4", or "new stop".
    note: Optional[str] = None
    is_new: bool = False


class PlanRevisionRead(BaseModel):
    version: int
    published_at: UtcDateTime
    source: str
    summary: Optional[str] = None
    acknowledged_at: Optional[UtcDateTime] = None
    acknowledged_by: Optional[str] = None


class PlanDiffRead(BaseModel):
    """The latest plan change as one diff, for the takeover (Figma 2a, 2d).

    from_version is the plan the loader last acknowledged before this change,
    so stacked versions read as one diff: v2 -> v4, confirmed once. Still sent
    after the acknowledgement, so the updated checklist keeps its notes.
    """

    from_version: int
    to_version: int
    published_at: UtcDateTime
    summary: Optional[str] = None
    # "Capacity after change": 4,920 -> 4,690 kg.
    planned_weight_before_kg: float
    planned_weight_after_kg: float
    planned_volume_before_m3: float
    planned_volume_after_m3: float
    # "Your 5 checked orders are saved": rows that still carry a check.
    checks_saved: int
    # Set when this change reopened a signed-off run: "was Ready 01:48".
    was_ready_at: Optional[UtcDateTime] = None


class ReleaseBlockerRead(BaseModel):
    """One reason release is locked, e.g. {"code": "re_check_pending", "count": 2}.

    Codes, in the order the footer lists them:
    plan_not_acknowledged, unload_pending, re_check_pending, orders_open,
    issue_waiting.
    """

    code: str
    count: int


class LoaderRefRead(BaseModel):
    """A loader named on a record: {"id": 1, "name": "Saman J."}."""

    id: int
    name: str


class PlanChangeRead(BaseModel):
    change_kind: PlanChangeKind
    order_number: Optional[str] = None
    outlet_code: Optional[str] = None
    reason: Optional[str] = None


class RunDetailRead(BaseModel):
    """GET /loader/runs/{code} - the L4 checklist.

    `stops` is ordered by load_position, not stop_sequence: the loader works the
    truck from the cab outwards, which is the reverse of the delivery order.
    """

    code: str
    trip_number: int
    brand: Brand
    district: str
    wave: Optional[str] = None
    departs_at: UtcDateTime
    status: RunStatus
    # Who signed the run off and when ("signed off by Saman J. 03:06"). Only
    # while the run is ready_to_depart or gated_out: null before release, after
    # an undo, and after a plan change reopens it (that time is in
    # plan_change.was_ready_at).
    released_at: Optional[UtcDateTime] = None
    released_by: Optional[LoaderRefRead] = None
    current_plan_version: int
    dock: str
    vehicle: VehicleRead
    capacity: CapacityRead
    plan: Optional[PlanRevisionRead] = None
    unacknowledged_plan_version: Optional[int] = None
    # The newest version someone acknowledged; with current_plan_version it
    # makes the queue card's "Plan updated · v2 -> v3".
    acknowledged_plan_version: Optional[int] = None
    # null when the run has no earlier plan on record to compare against.
    plan_change: Optional[PlanDiffRead] = None
    stops: List[RunStopRead]
    # Two different counts over the same orders_total (take_off / moved excluded):
    # - orders_loaded: state loaded only - what is on the truck and confirmed.
    #   The queue's "3 of 5 loaded" and the "x of y orders in" line.
    # - orders_checked: loaded OR flagged - no longer blocking review. The
    #   review lock, "Review & confirm · 4 of 5".
    # re_check counts toward neither until it is confirmed again.
    orders_loaded: int
    orders_checked: int
    orders_total: int
    # Release (L6) is locked while any blocker is listed. The same list backs
    # LoaderService.release_blockers, which POST /release should check.
    release_locked: bool
    release_blockers: List[ReleaseBlockerRead]


class IssueOptionRead(BaseModel):
    # The option's id, for POST /loader/issues/{id}/decision (integration).
    id: Optional[int] = None
    label: str
    detail: Optional[str] = None
    is_default: bool
    is_chosen: bool


class IssueDetailRead(BaseModel):
    """GET /loader/issues/{id} - the L8 waiting and decision screens."""

    id: int
    run_code: str
    order_number: str
    outlet_code: Optional[str] = None
    issue_type: IssueType
    units_affected: Optional[int] = None
    units_total: Optional[int] = None
    quick_note_tag: Optional[str] = None
    note: Optional[str] = None
    photo_path: Optional[str] = None
    reported_by: str
    reported_at: UtcDateTime
    status: IssueStatus
    seen_at: Optional[UtcDateTime] = None
    decide_by: Optional[UtcDateTime] = None
    decided_at: Optional[UtcDateTime] = None
    decided_by: Optional[str] = None
    options: List[IssueOptionRead]


class ActivityRead(BaseModel):
    """One entry in the L9 log.

    Used by both activity endpoints. `run_code` is redundant on the per-run
    timeline but carried anyway, so the dock-wide feed and the per-run timeline
    render from one shape.
    """

    at: UtcDateTime
    run_code: str
    actor_kind: ActorKind
    actor: Optional[str] = None
    event_type: str
    order_number: Optional[str] = None
    message: str


class ActivityActorRead(BaseModel):
    """Who did it. `name` is the short form the log shows ("Saman J.");
    `full_name` is set for loaders only - dispatcher and system entries carry
    the label they were logged with."""

    kind: ActorKind
    name: Optional[str] = None
    full_name: Optional[str] = None


class ActivityStopRead(BaseModel):
    sequence: int
    outlet_code: str


class ActivityOrderRead(BaseModel):
    order_number: str


class RunActivityEventRead(BaseModel):
    """One event on GET /loader/runs/{code}/activity (L9), newest first.

    `type` is an open set: the values in API_CONTRACT.md today, and more as
    features land (L8 decisions, L5 flags, L6 release). Clients show `summary`
    for a type they do not know rather than dropping the event.

    `summary` is the loader's wording (Figma T1c Change log). The dock-wide feed
    keeps the stored `message`, which is the Dispatcher's wording (Figma 2c #5).
    """

    id: int
    type: str
    at: UtcDateTime
    actor: ActivityActorRead
    stop: Optional[ActivityStopRead] = None
    order: Optional[ActivityOrderRead] = None
    summary: str
    details: Dict[str, object] = {}


# --- Writes from the tablet -----------------------------------------------


class OrderActionRequest(BaseModel):
    """Body for check, uncheck and recheck on one checklist row.

    client_action_id is generated once per tap by the tablet and reused on every
    retry of that tap - a repeat returns the run with 200 and applies nothing.

    plan_version is the version the loader was looking at when they tapped. If
    the dispatcher has published a newer one since, the write is refused with
    409 PLAN_VERSION_STALE rather than applied to a plan the loader never saw.

    The offline outbox also sends run_code and order_number in the body; the
    path is authoritative, so extra fields are ignored.
    """

    client_action_id: UUID
    plan_version: int
    loader_session_id: Optional[int] = None

    model_config = ConfigDict(extra="ignore")


class AcknowledgePlanRequest(BaseModel):
    """Body for POST /loader/runs/{code}/plan/{version}/acknowledge.

    plan_version must match the version in the path; it is carried in the body
    too so every tablet write has the same shape.

    loader_session_id is who the Dispatcher sees as "received by". It is
    optional until L2 sign-in lands; without it the acknowledgement is recorded
    with no loader.
    TODO(L2): make loader_session_id required once sign-in is merged.
    """

    client_action_id: UUID
    plan_version: int
    loader_session_id: Optional[int] = None

    model_config = ConfigDict(extra="ignore")


class FlagIssueRequest(BaseModel):
    """POST /loader/issues (L5): the tablet's FlagActionPayload plus the write
    fields every tablet write carries.

    units_affected is what the stepper shows; units_total is taken from the
    order on the server. A flag needs a signed-in loader: loader_issues keeps
    who reported it, and that column is required.
    """

    client_action_id: UUID
    plan_version: int
    loader_session_id: Optional[int] = None
    run_code: str
    order_number: str
    issue_type: IssueType
    units_affected: int
    quick_note_tag: Optional[str] = None
    note: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


class ReleaseRequest(BaseModel):
    """POST /loader/runs/{code}/release and /release/undo (L6): the write
    fields only; the run is in the path."""

    client_action_id: UUID
    plan_version: int
    loader_session_id: Optional[int] = None

    model_config = ConfigDict(extra="ignore")


# --- Dev-only simulation payloads ----------------------------------------


class SimulatedPlanChangeRequest(BaseModel):
    """Body for the dev plan-change endpoint. All fields optional.

    Defaults reproduce the Figma v2 -> v3 change on RUN-021 exactly.
    """

    unload_order_numbers: Optional[List[str]] = None
    dont_load_order_numbers: Optional[List[str]] = None
    load_new_order_numbers: Optional[List[str]] = None
    # Loaded orders the loader has to re-confirm (moved to reach one coming
    # off). Omitted: every order aboard goes to re_check.
    recheck_order_numbers: Optional[List[str]] = None
    # The dispatcher's words per order, shown in the diff.
    reasons: Optional[Dict[str, str]] = None
    summary: Optional[str] = None


class SimulatedDecisionRequest(BaseModel):
    """Body for the dev decision endpoint."""

    option_label: Optional[str] = None
    decided_by: str = "Kasun Perera"


class SimulationResult(BaseModel):
    detail: str
    run_code: Optional[str] = None
    plan_version: Optional[int] = None
    issue_id: Optional[int] = None
    changes: List[PlanChangeRead] = []


# ---------------------------------------------------------------------------
# L2 sign-in: users and sessions (shapes from frontend/lib/loader/types.ts)
# ---------------------------------------------------------------------------


class LoaderUserRead(BaseModel):
    """GET /loader/users: a sign-in tile. The PIN hash never leaves the server."""

    id: int
    full_name: str
    short_name: str

    model_config = ConfigDict(from_attributes=True)


class SessionRequest(BaseModel):
    """POST /loader/session. The PIN is checked here only."""

    loader_user_id: int
    pin: str
    # The tablet, not the loader, decides the dock: "Dock tablet 3".
    dock_tablet_label: str


class SessionLoaderRead(BaseModel):
    id: int
    short_name: str


class LoaderSessionRead(BaseModel):
    """POST /loader/session (200) and DELETE /loader/session/{id}.

    ended_at / end_reason are null while the session is open; the frontend
    reads neither, so they are extra rather than a different shape.
    """

    session_id: int
    loader: SessionLoaderRead
    dock: str
    depot: str
    started_at: UtcDateTime
    ended_at: Optional[UtcDateTime] = None
    end_reason: Optional[SessionEndReason] = None


class EndSessionRequest(BaseModel):
    """DELETE /loader/session/{id} body."""

    end_reason: SessionEndReason


# ---------------------------------------------------------------------------
# L3 queue and summary (shapes from frontend/lib/loader/types.ts)
# ---------------------------------------------------------------------------


class RunAlertRead(BaseModel):
    """The coloured row on a queue card. tone: warning · error · success · neutral."""

    tone: str
    message: str
    action: str
    href: str


class RunSummaryRead(BaseModel):
    """One queue card (RunSummary)."""

    code: str
    vehicle_code: str
    vehicle_type: VehicleType
    temp_capability: TempCapability
    trip_number: int
    brand: Brand
    district: str
    departs_at: UtcDateTime
    status: RunStatus
    stop_count: int
    orders_loaded: int
    orders_checked: int
    orders_total: int
    loader: Optional[str] = None
    released_at: Optional[UtcDateTime] = None
    released_by: Optional[LoaderRefRead] = None
    plan_updated_at: Optional[UtcDateTime] = None
    # Source TBD with the dispatcher; no table holds it yet.
    pre_stage_note: Optional[str] = None
    chips: List[str]
    alert: Optional[RunAlertRead] = None


class RunGroupRead(BaseModel):
    label: str
    brand: Brand
    wave: str
    runs: List[RunSummaryRead]


class RunQueueRead(BaseModel):
    """GET /loader/runs?dock=."""

    groups: List[RunGroupRead]


class HolidayRead(BaseModel):
    date: date
    label: str


class LoadingCountRead(BaseModel):
    count: int
    loaders: List[str]


class IssueCountRead(BaseModel):
    count: int
    label: str


class ReadyCountRead(BaseModel):
    count: int
    run_codes: List[str]


class QueueSummaryRead(BaseModel):
    """GET /loader/summary?dock=: the queue's metric cards (QueueSummary)."""

    dock: str
    date: date
    day_label: str
    next_holiday: Optional[HolidayRead] = None
    runs: int
    loading: LoadingCountRead
    issues: IssueCountRead
    ready: ReadyCountRead
    plan_updated_at: Optional[UtcDateTime] = None


# --- integration slice 1 (docs/loader/INTEGRATION_DESIGN.md) ------------------


class DispatcherLoadingEventRead(BaseModel):
    """One entry on the dispatcher's Loading readiness timeline.

    event / time / note / status are the keys LoadingReadinessDialog already
    reads from dispatch_trips.loading_events; at and type are extra.
    """

    event: str
    time: str  # "HH:MM", depot time
    note: str
    status: str  # ok | warning | error
    at: UtcDateTime
    type: str  # the loader activity event_type


class DispatcherLoadingRead(BaseModel):
    """The dock's side of one dispatch trip, for the dispatcher's screens.

    stop_count / stops_completed / open_shortfalls / loading_events use the
    names the readiness dialog already reads, so it can switch from `run.X`
    to `run.loader.X`. stops_completed = stops fully loaded (or flagged).
    """

    run_code: str
    status: RunStatus
    dock: str
    departs_at: UtcDateTime
    plan_version: int
    plan_acknowledged: bool
    stop_count: int
    stops_completed: int
    orders_checked: int
    orders_total: int
    open_shortfalls: int
    planned_weight_kg: float
    loaded_weight_kg: float
    planned_volume_m3: float
    loaded_volume_m3: float
    released_at: Optional[UtcDateTime] = None
    released_by: Optional[LoaderRefRead] = None
    last_update_at: Optional[UtcDateTime] = None
    loading_events: List[DispatcherLoadingEventRead]


class DispatchTripRunRead(BaseModel):
    """POST /loader/dispatch-trips/{id}/run: the loader run built for a trip."""

    dispatch_trip_id: int
    run_code: str
    created: bool
    loading: DispatcherLoadingRead



# --- dispatcher / driver integration endpoints ---------------------------------


class DispatcherOrderRef(BaseModel):
    order_number: str
    reason: Optional[str] = None  # the dispatcher's words, shown verbatim on the tablet


class DispatcherMovedOrder(DispatcherOrderRef):
    # The trip the order moves to, if the dispatcher knows it. Informational:
    # moved_to on the tablet is read from wherever the order is planned next.
    to_dispatch_trip_id: Optional[int] = None


class DispatcherDeferredOrder(DispatcherOrderRef):
    # Informational, as for moves: deferred_to on the tablet is read from the
    # order (status DEFERRED with a later operating_date).
    deferred_to: Optional[date] = None


class DispatcherPlanRequest(BaseModel):
    """POST /loader/dispatch-trips/{id}/plan: the dispatcher changes the plan."""

    client_action_id: UUID
    base_version: int  # the plan version the dispatcher's screen shows
    stop_order: Optional[List[str]] = None  # outlet codes, delivery order; unnamed stops follow
    add: List[DispatcherOrderRef] = []
    remove: List[DispatcherOrderRef] = []
    move: List[DispatcherMovedOrder] = []
    defer: List[DispatcherDeferredOrder] = []
    departs_at: Optional[datetime] = None
    summary: Optional[str] = None
    dispatcher: str = "Dispatcher"


class DispatcherPlanResult(BaseModel):
    dispatch_trip_id: int
    run_code: str
    plan_version: int
    published: bool  # false when only departs_at changed (no new plan version)
    replayed: bool  # true when this request had already been applied
    run_status: RunStatus
    departs_at: UtcDateTime
    changes: List["PlanChangeRead"]


class IssueDecisionRequest(BaseModel):
    """POST /loader/issues/{id}/decision. option = the option id (int) or its label."""

    option: Union[int, str]
    note: Optional[str] = None
    client_action_id: UUID
    decided_by: str = "Dispatcher"


class GateOutRequest(BaseModel):
    client_action_id: UUID
    by: Optional[str] = None  # who let it through (driver or gate), for the log


class GateOutRead(BaseModel):
    dispatch_trip_id: int
    run_code: str
    status: RunStatus
    gated_out_at: UtcDateTime
    replayed: bool


class HandoffShortfallRead(BaseModel):
    issue_id: int
    order_number: str
    outlet_code: Optional[str] = None
    issue_type: IssueType
    units_affected: Optional[int] = None
    units_total: Optional[int] = None
    status: IssueStatus  # decided | default_applied
    decision: Optional[str] = None  # the chosen option's label
    decided_by: Optional[str] = None
    decided_at: Optional[UtcDateTime] = None


class HandoffOrderRead(BaseModel):
    order_number: str
    temperature_class: Optional[TemperatureClass] = None
    units_ordered: Optional[int] = None
    loaded_units: int
    weight_kg: Optional[float] = None
    volume_m3: Optional[float] = None
    shortfall: Optional[HandoffShortfallRead] = None


class HandoffStopRead(BaseModel):
    stop_sequence: int  # delivery order: the driver goes 1, 2, 3 ...
    load_position: int  # 1 = loaded first, deepest
    outlet_code: str
    outlet_name: str
    district: str
    eta: Optional[UtcDateTime] = None
    orders: List[HandoffOrderRead]


class HandoffRead(BaseModel):
    """GET /loader/dispatch-trips/{id}/handoff: what is on the truck, for the driver."""

    dispatch_trip_id: int
    run_code: str
    status: RunStatus
    plan_version: int
    vehicle_code: str
    dock: str
    departs_at: UtcDateTime
    released_at: Optional[UtcDateTime] = None
    released_by: Optional[LoaderRefRead] = None
    gated_out_at: Optional[UtcDateTime] = None
    units_ordered: int
    units_loaded: int
    stops: List[HandoffStopRead]
    shortfalls: List[HandoffShortfallRead]
