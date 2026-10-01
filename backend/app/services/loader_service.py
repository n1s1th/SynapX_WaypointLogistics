"""Business logic behind the loader endpoints.

Endpoints stay thin; anything that decides something lives here.
"""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AllocationError, InvalidStateTransitionError, NotFoundError
from app.core.security import verify_password
from app.models.delivery_run import (
    DeliveryRun,
    RunOrderState,
    RunStatus,
    RunStop,
    RunStopOrder,
    StopStatus,
)
from app.models.loader_activity import (
    ActorKind,
    CheckAction,
    LoaderActivity,
    LoadingCheck,
    ReleaseAction,
    RunReleaseAction,
)
from app.models.fleet import Vehicle
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue, LoaderIssueOption
from app.models.loader_user import LoaderSession, LoaderUser
from app.models.order import Order, OrderStatus
from app.models.plan_revision import PlanChangeKind, PlanRevision, PlanRevisionChange
from app.models.shipment import DispatchTrip
from app.models.reference import (
    Brand,
    CalendarDay,
    Depot,
    Dock,
    DockTablet,
    Outlet,
    TempCapability,
    TemperatureClass,
    VehicleType,
)
from app.schemas import loader as schemas

# States that mean the order is physically aboard, for the capacity rollup.
# RE_CHECK counts: the goods are on the truck, they just need re-confirming
# against the new plan.
ON_TRUCK_STATES = {RunOrderState.LOADED, RunOrderState.RE_CHECK}

# States that no longer need the loader to act, for the "checked or flagged"
# gate that unlocks review. RE_CHECK is deliberately NOT resolved - a plan change
# invalidates the earlier check, and the loader has to confirm it again.
RESOLVED_STATES = {RunOrderState.LOADED, RunOrderState.FLAGGED}

# States where the order has left this run's plan. Still rendered on the
# checklist (greyed, or as a pinned unload task), but not counted in the
# "x of y" totals - they are no longer orders to load.
OFF_PLAN_STATES = {RunOrderState.TAKE_OFF, RunOrderState.MOVED}

# Once signed off or through the gate, the checklist is closed to the loader.
# Reopening after Ready is L7's plan-change path, not a plain check.
CLOSED_RUN_STATES = {RunStatus.READY_TO_DEPART, RunStatus.GATED_OUT}

# Runs the summary counts as "Loading" (L3): someone is working on them.
LOADING_RUN_STATES = {RunStatus.LOADING, RunStatus.ISSUE_FLAGGED, RunStatus.LOADED}

BRAND_LABELS = {Brand.FRESH: "Fresh", Brand.STYLE: "Style", Brand.TECH: "Tech"}

# How a queue card names a waiting flag: "ORD0092314 missing · waiting".
ISSUE_WORDS = {
    IssueType.MISSING: "missing",
    IssueType.SHORT: "short",
    IssueType.DAMAGED: "damaged",
    IssueType.WONT_FIT: "won't fit",
}

# Asia/Colombo is UTC+05:30 all year (no DST). A fixed offset needs no tz
# database, which Windows Python does not ship.
DEPOT_UTC_OFFSET = timedelta(hours=5, minutes=30)
_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _depot_time(value: datetime) -> datetime:
    """A stored datetime (naive UTC) or an aware one, as naive depot time."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value + DEPOT_UTC_OFFSET


def _depot_date(value: datetime) -> date:
    return _depot_time(value).date()


def _depot_hhmm(value: datetime) -> str:
    return _depot_time(value).strftime("%H:%M")


def _day_label(day: date) -> str:
    """"Thu 28 May", without depending on the server's locale."""
    return f"{_DAYS[day.weekday()]} {day.day} {_MONTHS[day.month - 1]}"


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class IncorrectPinError(Exception):
    """POST /loader/session with a wrong PIN, or for a loader who cannot sign
    in. The endpoint answers 401: the shared AuthorizationError handler is a
    403, which the tablet would read as "offline"."""

    def __init__(self, message: str = "Incorrect PIN."):
        super().__init__(message)
        self.message = message

# Rows a loader can flag (L5): on the plan and not already flagged. take_off
# and moved are not on this trip any more.
FLAGGABLE_STATES = {
    RunOrderState.TO_LOAD,
    RunOrderState.LOADED,
    RunOrderState.RE_CHECK,
    RunOrderState.NEW,
}

# A flag's decide-by: departure minus 20 minutes (contract, L5/L8).
DECIDE_BY_LEAD = timedelta(minutes=20)


def _issue_options(issue_type: IssueType, affected: int, total: int) -> List[Tuple[str, str, bool]]:
    """(label, detail, is_default) the Dispatcher picks from, the same as her
    mock server's, until the dispatcher module builds its own. The default is
    what the system applies if decide-by passes."""
    if issue_type == IssueType.MISSING:
        return [
            ("Send without it", "Defer it to the next delivery day.", True),
            ("Hold the vehicle", "Wait for the order to be found.", False),
        ]
    if issue_type == IssueType.WONT_FIT:
        return [
            ("Leave the overflow for the next run", f"{affected} units wait at the dock.", True),
            ("Swap to a larger vehicle", "Reload on a bigger truck.", False),
        ]
    return [
        (f"Send {total - affected} of {total}", "Balance on the next delivery day.", True),
        ("Hold the vehicle", "Wait for replacement stock.", False),
    ]


def _who(actor: Optional[LoaderUser]) -> str:
    # The stored message is the Dispatcher's wording: the full name.
    return actor.full_name if actor else "unknown loader"


class FlagRequestError(Exception):
    """POST /loader/issues that cannot be filed as sent: no signed-in loader,
    or units_affected outside 0..units_total. The endpoint answers 422."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

# Which row states each tablet action may start from. check also clears
# re_check: the tablet taps the same tile whatever the row says, so a check on a
# re_check row confirms it exactly as recheck does.
ORDER_ACTIONS = {
    CheckAction.CHECK: {RunOrderState.TO_LOAD, RunOrderState.NEW, RunOrderState.RE_CHECK},
    CheckAction.RECHECK: {RunOrderState.RE_CHECK},
    CheckAction.UNCHECK: {RunOrderState.LOADED},
    # take_off -> moved: the order is off the truck and off this run. There is
    # no separate "unloaded" state; the loading_checks row records the unload.
    CheckAction.UNLOAD: {RunOrderState.TAKE_OFF},
}

# Rows already where the action would put them. These are a 200 no-op, not an
# error: two loaders can tick the same order, and the second tap should not
# bounce. Nothing is recorded, since nothing changed.
ALREADY_DONE = {
    CheckAction.CHECK: {RunOrderState.LOADED},
    CheckAction.RECHECK: {RunOrderState.LOADED},
    CheckAction.UNCHECK: {RunOrderState.TO_LOAD, RunOrderState.NEW},
    CheckAction.UNLOAD: {RunOrderState.MOVED},
}

ACTION_EVENTS = {
    CheckAction.CHECK: ("order_checked", "loaded"),
    CheckAction.RECHECK: ("order_rechecked", "re-checked"),
    CheckAction.UNCHECK: ("order_unchecked", "unchecked"),
    CheckAction.UNLOAD: ("order_unloaded", "off truck"),
}

# The Log's wording for order events (Figma T1c Change log), by event type.
# An unload also names where the order went back to: "ORD0092308 unloaded → chiller".
# The Log's wording for release and undo, followed by the loader's short name
# (as "Acknowledged · Saman J."). The stored message has the full name.
RELEASE_SUMMARIES = {
    "run_released": "Ready to depart",
    "run_release_undone": "Ready undone",
}

ORDER_SUMMARIES = {
    "order_checked": "loaded",
    "order_rechecked": "re-checked",
    "order_unchecked": "unchecked",
    "order_unloaded": "unloaded",
}


class StalePlanVersionError(InvalidStateTransitionError):
    """The tablet acted on a plan version the dispatcher has since replaced.

    Subclasses InvalidStateTransitionError so the existing 409 handler serves
    it; only the code and details differ.
    """

    def __init__(self, run: DeliveryRun, sent_version: int):
        super().__init__(
            f"Plan changed to v{run.current_plan_version}; this action was made on "
            f"v{sent_version}.",
            current_state=f"v{run.current_plan_version}",
            target_state=f"v{sent_version}",
            entity="DeliveryRun",
        )
        self.code = "PLAN_VERSION_STALE"
        self.details = {
            "entity": "DeliveryRun",
            "entity_id": run.code,
            "current_plan_version": run.current_plan_version,
            "sent_plan_version": sent_version,
        }


class PlanNotAcknowledgedError(InvalidStateTransitionError):
    """A row write on a plan version nobody has acknowledged yet.

    The tablet shows the plan-change takeover until the loader acknowledges;
    this is the server's side of that, so a tablet that missed the takeover
    still cannot check against a plan it never read.
    """

    def __init__(self, run: DeliveryRun):
        super().__init__(
            f"Plan v{run.current_plan_version} has not been acknowledged; read the change first.",
            current_state=f"v{run.current_plan_version} unacknowledged",
            target_state="acknowledged",
            entity="DeliveryRun",
        )
        self.code = "PLAN_NOT_ACKNOWLEDGED"
        self.details = {
            "entity": "DeliveryRun",
            "entity_id": run.code,
            "unacknowledged_plan_version": run.current_plan_version,
        }


# Undo of a release (L6): the tablet shows a 10 s undo; the server allows 2 s
# more so a tap on the last second, sent over a slow link, still lands.
UNDO_WINDOW_SECONDS = 10
UNDO_GRACE_SECONDS = 2


def _utc_z(value: datetime) -> str:
    """A datetime as the API writes it, for error details (which are plain JSON)."""
    return _naive_utc(value).isoformat() + "Z"


class ReleaseLockedError(InvalidStateTransitionError):
    """POST /release while something still blocks it (L6).

    detail.release_blockers is the same [{code, count}] list the run read and
    release-summary send, so the tablet can say why without another request.
    """

    def __init__(self, run: DeliveryRun, blockers: List[schemas.ReleaseBlockerRead]):
        super().__init__(
            f"{run.code} cannot be released yet.",
            current_state="locked",
            target_state="ready_to_depart",
            entity="DeliveryRun",
        )
        self.code = "RELEASE_LOCKED"
        self.details = {
            "entity": "DeliveryRun",
            "entity_id": run.code,
            "release_blockers": [b.model_dump() for b in blockers],
        }


class UndoWindowExpiredError(InvalidStateTransitionError):
    """POST /release/undo after the undo window has closed (L6)."""

    def __init__(self, run: DeliveryRun):
        super().__init__(
            f"The undo window for {run.code} has closed.",
            current_state=run.status.value,
            target_state="undo",
            entity="DeliveryRun",
        )
        self.code = "UNDO_WINDOW_EXPIRED"
        self.details = {
            "entity": "DeliveryRun",
            "entity_id": run.code,
            "released_at": _utc_z(run.released_at),
            "window_seconds": UNDO_WINDOW_SECONDS,
        }


class ClientActionIdReusedError(InvalidStateTransitionError):
    """A client_action_id already recorded for a different order or action.

    A genuine replay always repeats the same request, so a mismatch is a client
    bug; answering it with the other action's result would hide that.
    """

    def __init__(self, client_action_id: str, entity: str = "LoadingCheck"):
        super().__init__(
            f"client_action_id {client_action_id} was already used for a different action.",
            current_state="used",
            target_state="reused",
            entity=entity,
        )
        self.code = "CLIENT_ACTION_ID_REUSED"
        self.details = {"entity": entity, "client_action_id": client_action_id}


def order_temperature(order: Order) -> Optional[TemperatureClass]:
    """The order's temperature class for the loader screens.

    orders.temperature_zone ("Ambient"/"Chilled", Nisith's, always set) is the
    source of truth; temperature_class (0003) is only filled by loader seeds.
    Read the class when set, otherwise map the zone, so orders placed through
    the Store Manager or the dispatcher still get a Temp badge.
    """
    if order.temperature_class is not None:
        return order.temperature_class
    zone = (order.temperature_zone or "").strip().lower()
    try:
        return TemperatureClass(zone)
    except ValueError:
        return None


class RunNotBuildableError(AllocationError):
    """A dispatch trip that cannot become a loader run (integration slice 1).

    422 through the shared AllocationError handler; `violations` lists every
    reason at once ({code, message, order_number?}) so the dispatcher can fix
    them in one go. The caller's transaction must roll back with it.
    """

    def __init__(self, trip: DispatchTrip, violations: List[dict]):
        super().__init__(
            f"{trip.trip_code} cannot be sent to the loading dock.",
            code="RUN_NOT_BUILDABLE",
            violations=violations,
        )
        self.details["dispatch_trip_id"] = trip.id


class OrderOnAnotherRunError(InvalidStateTransitionError):
    """An order of the trip is already on another loader run's current plan,
    and that run has not left the gate. 409; details.orders names each one."""

    def __init__(self, trip: DispatchTrip, clashes: List[dict]):
        super().__init__(
            f"{len(clashes)} order(s) of {trip.trip_code} are already on another loader run.",
            current_state="on_another_run",
            target_state="on_this_run",
            entity="Order",
        )
        self.code = "ORDER_ON_ANOTHER_RUN"
        self.details = {"entity": "Order", "dispatch_trip_id": trip.id, "orders": clashes}


class RunCodeTakenError(InvalidStateTransitionError):
    """The trip code is already the code of a loader run that is not this
    trip's (for example a seeded demo run). 409 rather than overwriting it."""

    def __init__(self, trip: DispatchTrip, run: DeliveryRun):
        super().__init__(
            f"Loader run {run.code} already exists and is not {trip.trip_code}'s.",
            current_state="taken",
            target_state="created",
            entity="DeliveryRun",
        )
        self.code = "RUN_CODE_TAKEN"
        self.details = {
            "entity": "DeliveryRun",
            "entity_id": run.code,
            "dispatch_trip_id": trip.id,
            "linked_dispatch_trip_id": run.dispatch_trip_id,
        }


class _TripRef:
    """The two DispatchTrip attributes OrderOnAnotherRunError reads."""

    def __init__(self, run: DeliveryRun):
        self.id = run.dispatch_trip_id
        self.trip_code = run.code


class PlanLockedError(InvalidStateTransitionError):
    """A dispatcher plan change on a run that has gone through the gate. 409."""

    def __init__(self, run: DeliveryRun):
        super().__init__(
            f"{run.code} has gone through the gate; change it with the driver.",
            current_state=run.status.value,
            target_state="plan_changed",
            entity="DeliveryRun",
        )
        self.code = "PLAN_LOCKED"
        self.details = {"entity": "DeliveryRun", "entity_id": run.code, "status": run.status.value}


class RunNotReleasedError(InvalidStateTransitionError):
    """Hand-off or gate-out of a run the loader has not released. 409."""

    def __init__(self, run: DeliveryRun):
        super().__init__(
            f"{run.code} is {run.status.value}; the loader has not released it.",
            current_state=run.status.value,
            target_state=RunStatus.GATED_OUT.value,
            entity="DeliveryRun",
        )
        self.code = "RUN_NOT_RELEASED"
        self.details = {"entity": "DeliveryRun", "entity_id": run.code, "status": run.status.value}


class PlanChangeInvalidError(AllocationError):
    """A dispatcher plan change that cannot be applied as asked. 422, every
    reason in violations ({code, message, order_number? | outlet_code?})."""

    def __init__(self, run: DeliveryRun, violations: List[dict]):
        super().__init__(
            f"The plan change for {run.code} cannot be applied.",
            code="PLAN_CHANGE_INVALID",
            violations=violations,
        )
        self.details["run_code"] = run.code


class InvalidOptionError(AllocationError):
    """A decision naming an option the issue does not have. 422."""

    def __init__(self, issue: LoaderIssue, option):
        super().__init__(
            f"Option {option!r} is not one of issue {issue.id}'s options.",
            code="INVALID_OPTION",
            violations=[{
                "code": "INVALID_OPTION",
                "message": "Choose one of the issue's options.",
                "options": [{"id": o.id, "label": o.label} for o in issue.options],
            }],
        )


class IssueAlreadyDecidedError(InvalidStateTransitionError):
    """A decision on an issue already decided (or defaulted) another way. 409."""

    def __init__(self, issue: LoaderIssue, chosen: Optional[LoaderIssueOption]):
        super().__init__(
            f"Issue {issue.id} is already {issue.status.value}.",
            current_state=issue.status.value,
            target_state=IssueStatus.DECIDED.value,
            entity="LoaderIssue",
        )
        self.code = "ISSUE_ALREADY_DECIDED"
        self.details = {
            "entity": "LoaderIssue",
            "entity_id": issue.id,
            "status": issue.status.value,
            "chosen_option": chosen.label if chosen else None,
            "decided_by": issue.decided_by,
        }


# delivery_runs.code is String(20); a longer trip code cannot be stored.
RUN_CODE_MAX = 20

# How the dispatcher's Loading readiness timeline titles each loader event.
DISPATCHER_EVENT_TITLES = {
    "plan_published": "Plan published",
    "plan_acknowledged": "Loader acknowledged plan",
    "order_checked": "Order loaded",
    "order_rechecked": "Order re-checked",
    "order_unchecked": "Order unchecked",
    "order_unloaded": "Order unloaded",
    "issue_flagged": "Shortfall flagged",
    "issue_decided": "Shortfall decided",
    "issue_default_applied": "Default applied",
    "load_reopened": "Load reopened",
    "departure_changed": "Departure changed",
    "run_released": "Ready to depart",
    "run_release_undone": "Ready undone",
    "gated_out": "Gated out",
}

# The timeline dot colour the dialog maps: error = red, warning = amber, ok = green.
DISPATCHER_EVENT_STATUS = {
    "issue_flagged": "error",
    "plan_published": "warning",
    "load_reopened": "warning",
    "issue_default_applied": "warning",
    "run_release_undone": "warning",
}


class LoaderService:
    # --- reads ------------------------------------------------------------

    @staticmethod
    def get_run(db: Session, code: str) -> DeliveryRun:
        run = db.execute(select(DeliveryRun).filter_by(code=code)).scalars().first()
        if run is None:
            raise NotFoundError(f"Run '{code}' not found.", entity="DeliveryRun", entity_id=code)
        return run

    @staticmethod
    def get_issue(db: Session, issue_id: int) -> LoaderIssue:
        issue = db.get(LoaderIssue, issue_id)
        if issue is None:
            raise NotFoundError(
                f"Issue '{issue_id}' not found.", entity="LoaderIssue", entity_id=issue_id
            )
        return issue

    @staticmethod
    def current_stops(db: Session, run: DeliveryRun) -> List[RunStop]:
        """Stops for the run's current plan version, in LOADING order.

        Sorted by load_position, which is the reverse of the delivery sequence -
        the last stop is loaded first, deepest against the cab.
        """
        return list(
            db.execute(
                select(RunStop)
                .filter_by(run_id=run.id, plan_version=run.current_plan_version)
                .order_by(RunStop.load_position)
            ).scalars()
        )

    @staticmethod
    def build_run_detail(db: Session, run: DeliveryRun) -> schemas.RunDetailRead:
        stops = LoaderService.current_stops(db, run)
        issues = LoaderService._latest_issues(db, run)
        unloads = LoaderService._unloads(db, run)
        diff = LoaderService._plan_diff(db, run, stops, unloads)
        blockers = LoaderService.release_blockers(db, run)

        stop_reads: List[schemas.RunStopRead] = []
        loaded = 0
        checked = 0
        total = 0
        for stop in stops:
            order_reads = []
            for row in sorted(stop.orders, key=lambda r: r.order.order_number):
                if row.state not in OFF_PLAN_STATES:
                    total += 1
                    if row.state == RunOrderState.LOADED:
                        loaded += 1
                    if row.state in RESOLVED_STATES:
                        checked += 1
                unload = unloads.get(row.order_id) if row.state == RunOrderState.MOVED else None
                order_reads.append(
                    schemas.RunOrderRead(
                        order_number=row.order.order_number,
                        temperature_class=order_temperature(row.order),
                        units=row.units,
                        weight_kg=row.weight_kg,
                        volume_m3=row.volume_m3,
                        state=row.state,
                        checked_at=row.checked_at,
                        checked_by=row.checked_by.short_name if row.checked_by else None,
                        loaded_units=LoaderService.loaded_units(row, issues.get(row.order_id)),
                        unloaded_at=unload.at if unload else None,
                        unloaded_by=unload.actor.short_name if unload and unload.actor else None,
                        **(diff.order_fields(row, stop) if diff else {}),
                        **LoaderService.order_destination(db, run, row),
                    )
                )
            stop_reads.append(
                schemas.RunStopRead(
                    stop_sequence=stop.stop_sequence,
                    load_position=stop.load_position,
                    eta=stop.eta,
                    handling_minutes=stop.handling_minutes,
                    status=stop.status,
                    outlet=schemas.OutletRead.model_validate(stop.outlet),
                    orders=order_reads,
                    **(diff.stop_fields(stop) if diff else {}),
                )
            )

        revision = LoaderService.get_revision(db, run, run.current_plan_version)
        plan_read = None
        unacknowledged = None
        if revision is not None:
            plan_read = schemas.PlanRevisionRead(
                version=revision.version,
                published_at=revision.published_at,
                source=revision.source,
                summary=revision.summary,
                acknowledged_at=revision.acknowledged_at,
                acknowledged_by=(
                    revision.acknowledged_by.short_name if revision.acknowledged_by else None
                ),
            )
            if revision.acknowledged_at is None:
                unacknowledged = revision.version

        vehicle = schemas.VehicleRead.model_validate(run.vehicle)
        return schemas.RunDetailRead(
            code=run.code,
            trip_number=run.trip_number,
            brand=run.brand,
            district=run.district,
            wave=run.wave,
            departs_at=run.departs_at,
            status=run.status,
            **LoaderService.release_fields(run),
            current_plan_version=run.current_plan_version,
            dock=run.dock.name,
            vehicle=vehicle,
            capacity=schemas.CapacityRead(
                loaded_weight_kg=run.loaded_weight_kg,
                planned_weight_kg=run.planned_weight_kg,
                max_weight_kg=vehicle.max_weight_kg,
                loaded_volume_m3=run.loaded_volume_m3,
                planned_volume_m3=run.planned_volume_m3,
                max_volume_m3=vehicle.max_volume_m3,
            ),
            plan=plan_read,
            unacknowledged_plan_version=unacknowledged,
            acknowledged_plan_version=db.execute(
                select(func.max(PlanRevision.version)).where(
                    PlanRevision.run_id == run.id,
                    PlanRevision.acknowledged_at.is_not(None),
                )
            ).scalar(),
            plan_change=diff.summary(db, run, stops) if diff else None,
            stops=stop_reads,
            orders_loaded=loaded,
            orders_checked=checked,
            orders_total=total,
            release_locked=bool(blockers),
            release_blockers=blockers,
        )

    @staticmethod
    def loaded_units(row: RunStopOrder, issue: Optional[LoaderIssue]) -> int:
        """Units of this order actually on the truck.

        - loaded, re_check, take_off (not yet unloaded): every unit is aboard.
        - flagged: missing -> 0; short, damaged or won't fit -> units minus the
          units flagged; a flag without a count means the whole order is affected (0).
        - to_load, new, moved: nothing aboard.
        """
        units = row.units or 0
        if row.state in (RunOrderState.LOADED, RunOrderState.RE_CHECK, RunOrderState.TAKE_OFF):
            return units
        if row.state == RunOrderState.FLAGGED and issue is not None:
            if issue.issue_type == IssueType.MISSING or issue.units_affected is None:
                return 0
            return max(units - issue.units_affected, 0)
        return 0

    @staticmethod
    def _latest_issues(db: Session, run: DeliveryRun) -> dict:
        """The most recent issue per order on this run, by order id."""
        issues = db.execute(
            select(LoaderIssue)
            .filter_by(run_id=run.id)
            .order_by(LoaderIssue.reported_at, LoaderIssue.id)
        ).scalars().all()
        return {issue.order_id: issue for issue in issues}

    @staticmethod
    def release_fields(run: DeliveryRun) -> dict:
        """released_at / released_by as the API sends them, for the run read and
        the queue card alike.

        Only while the run is signed off (ready_to_depart or gated_out). The
        column keeps the time after a plan change reopens the run, for "was
        Ready 01:48", but the run is not released any more, so the API says so.
        """
        if run.status not in CLOSED_RUN_STATES or run.released_at is None:
            return {"released_at": None, "released_by": None}
        who = run.released_by
        return {
            "released_at": run.released_at,
            "released_by": (
                schemas.LoaderRefRead(id=who.id, name=who.short_name) if who else None
            ),
        }

    @staticmethod
    def plan_updated_at(db: Session, run: DeliveryRun) -> Optional[datetime]:
        """When the run's current plan was published - plan_updated_at on a queue
        card (L3). None for a run with no revision on record."""
        revision = LoaderService.get_revision(db, run, run.current_plan_version)
        return revision.published_at if revision else None

    @staticmethod
    def dock_plan_updated_at(
        db: Session, dock: Dock, run_ids: Optional[List[int]] = None
    ) -> Optional[datetime]:
        """The latest plan publish across a dock - plan_updated_at on the summary
        (L3), "Plan from Dispatcher · updated 02:14" on the queue strip.

        Only each run's current version counts. run_ids narrows it to the runs
        the queue actually shows (for example, today's); None means every run
        at the dock.
        """
        query = (
            select(func.max(PlanRevision.published_at))
            .join(DeliveryRun, PlanRevision.run_id == DeliveryRun.id)
            .where(
                DeliveryRun.dock_id == dock.id,
                PlanRevision.version == DeliveryRun.current_plan_version,
            )
        )
        if run_ids is not None:
            query = query.where(DeliveryRun.id.in_(run_ids))
        return db.execute(query).scalar()

    @staticmethod
    def check_release_allowed(db: Session, run: DeliveryRun) -> None:
        """For POST /release (L6): raise 409 RELEASE_LOCKED, with the blockers
        in the detail, unless nothing blocks the release."""
        blockers = LoaderService.release_blockers(db, run)
        if blockers:
            raise ReleaseLockedError(run, blockers)

    @staticmethod
    def check_undo_allowed(run: DeliveryRun, now: Optional[datetime] = None) -> None:
        """For POST /release/undo (L6).

        Only a run that is still ready_to_depart can be undone - a plan change
        inside the window has already reopened it, and after gate-out it is the
        Driver's. Then only within UNDO_WINDOW_SECONDS of released_at, plus
        UNDO_GRACE_SECONDS; after that, 409 UNDO_WINDOW_EXPIRED.
        """
        if run.status != RunStatus.READY_TO_DEPART or run.released_at is None:
            raise InvalidStateTransitionError(
                f"{run.code} is {run.status.value}; only a ready_to_depart run can be undone.",
                current_state=run.status.value,
                target_state="undo",
                entity="DeliveryRun",
            )
        now = now or datetime.now(timezone.utc)
        elapsed = (_naive_utc(now) - _naive_utc(run.released_at)).total_seconds()
        if elapsed > UNDO_WINDOW_SECONDS + UNDO_GRACE_SECONDS:
            raise UndoWindowExpiredError(run)

    @staticmethod
    def release_blockers(db: Session, run: DeliveryRun) -> List[schemas.ReleaseBlockerRead]:
        """Everything that must be done before the run can be released.

        Empty means release is allowed. Checked by the read so the button can
        say why it is locked ("Release locked · unload first"), and meant to be
        checked again by POST /release (L6) before it writes anything.

        take_off rows are outside orders_total, so "all checked" alone would
        let a truck leave with an order the plan took off; unload_pending is
        what stops that.
        """
        states = LoaderService._current_states(db, run)
        blockers: List[schemas.ReleaseBlockerRead] = []

        def add(code: str, count: int) -> None:
            if count:
                blockers.append(schemas.ReleaseBlockerRead(code=code, count=count))

        current = LoaderService.get_revision(db, run, run.current_plan_version)
        add("plan_not_acknowledged", int(current is not None and current.acknowledged_at is None))
        add("unload_pending", states.count(RunOrderState.TAKE_OFF))
        add("re_check_pending", states.count(RunOrderState.RE_CHECK))
        add("orders_open", states.count(RunOrderState.TO_LOAD) + states.count(RunOrderState.NEW))
        add(
            "issue_waiting",
            len(
                db.execute(
                    select(LoaderIssue.id).where(
                        LoaderIssue.run_id == run.id,
                        LoaderIssue.status.in_([IssueStatus.SENT, IssueStatus.SEEN]),
                    )
                ).all()
            ),
        )
        return blockers

    @staticmethod
    def _plan_diff(
        db: Session, run: DeliveryRun, stops: List[RunStop], unloads: dict
    ) -> Optional["PlanDiff"]:
        """The latest change as one diff, or None when there is nothing to compare.

        The window is the versions the latest acknowledgement covers - every
        version still unread, or, once read, every version acknowledged in that
        same tap. The base is the version just before it: what the loader had
        confirmed before this change. So v2 -> v3 -> v4 unread reads as v2 -> v4,
        and after the acknowledgement the checklist keeps showing that diff.

        None when the base has no stops on record (a run seeded straight at v2).
        """
        revisions = {
            r.version: r
            for r in db.execute(select(PlanRevision).filter_by(run_id=run.id)).scalars()
        }
        current = revisions.get(run.current_plan_version)
        if current is None:
            return None

        first = current.version
        while first - 1 in revisions and (
            revisions[first - 1].acknowledged_at == current.acknowledged_at
        ):
            first -= 1
        base = first - 1

        base_stops = db.execute(
            select(RunStop).filter_by(run_id=run.id, plan_version=base)
        ).scalars().all()
        if not base_stops:
            return None

        window = [revisions[v] for v in range(first, current.version + 1) if v in revisions]
        versions = [r.version for r in window]

        changes = db.execute(
            select(PlanRevisionChange)
            .join(PlanRevision, PlanRevisionChange.revision_id == PlanRevision.id)
            .where(PlanRevision.run_id == run.id, PlanRevision.version.in_(versions))
            .order_by(PlanRevision.version, PlanRevisionChange.position, PlanRevisionChange.id)
        ).scalars().all()

        # A check confirms a re_check row just as recheck does (the tablet only
        # sends check), so both count; PlanDiff keeps the ones on orders that
        # were aboard before the change.
        rechecks = db.execute(
            select(LoadingCheck)
            .join(RunStopOrder, LoadingCheck.run_stop_order_id == RunStopOrder.id)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .where(
                RunStop.run_id == run.id,
                LoadingCheck.action.in_([CheckAction.CHECK, CheckAction.RECHECK]),
                LoadingCheck.plan_version.in_(versions),
            )
            .order_by(LoadingCheck.at, LoadingCheck.id)
        ).scalars().all()

        return PlanDiff(
            base_version=base,
            window=window,
            base_stops=base_stops,
            changes=changes,
            rechecked={c.run_stop_order.order_id: c.plan_version for c in rechecks},
            unloaded_in_window={
                order_id for order_id, check in unloads.items() if check.plan_version in versions
            },
            current_stops=stops,
        )

    @staticmethod
    def _unloads(db: Session, run: DeliveryRun) -> dict:
        """The latest UNLOAD check per order on this run, by order id."""
        checks = db.execute(
            select(LoadingCheck)
            .join(RunStopOrder, LoadingCheck.run_stop_order_id == RunStopOrder.id)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .where(RunStop.run_id == run.id, LoadingCheck.action == CheckAction.UNLOAD)
            .order_by(LoadingCheck.at, LoadingCheck.id)
        ).scalars().all()
        return {c.run_stop_order.order_id: c for c in checks}

    @staticmethod
    def build_issue_detail(db: Session, issue: LoaderIssue) -> schemas.IssueDetailRead:
        options = sorted(issue.options, key=lambda o: o.position)
        return schemas.IssueDetailRead(
            id=issue.id,
            run_code=issue.run.code,
            order_number=issue.order.order_number,
            outlet_code=issue.order.outlet.code if issue.order.outlet else None,
            issue_type=issue.issue_type,
            units_affected=issue.units_affected,
            units_total=issue.units_total,
            quick_note_tag=issue.quick_note_tag,
            note=issue.note,
            photo_path=issue.photo_path,
            reported_by=issue.reported_by.short_name,
            reported_at=issue.reported_at,
            status=issue.status,
            seen_at=issue.seen_at,
            decide_by=issue.decide_by,
            decided_at=issue.decided_at,
            decided_by=issue.decided_by,
            options=[
                schemas.IssueOptionRead(
                    id=o.id,
                    label=o.label,
                    detail=o.detail,
                    is_default=o.is_default,
                    is_chosen=o.is_chosen,
                )
                for o in options
            ],
        )

    @staticmethod
    def _to_activity_read(row: LoaderActivity) -> schemas.ActivityRead:
        return schemas.ActivityRead(
            at=row.at,
            run_code=row.run.code,
            actor_kind=row.actor_kind,
            actor=row.actor_label or (row.actor.short_name if row.actor else None),
            event_type=row.event_type,
            order_number=row.order.order_number if row.order else None,
            message=row.message,
        )

    @staticmethod
    def list_activity(db: Session, run: DeliveryRun) -> List[schemas.RunActivityEventRead]:
        """One run's log, NEWEST first (L9).

        Read from loader_activities, the one table every write logs to. The Log
        tab shows it as is; the checklist's Change log card reverses it, since
        that card reads top to bottom as the shift goes (02:14 published ->
        02:16 acknowledged -> ...).
        """
        rows = db.execute(
            select(LoaderActivity)
            .filter_by(run_id=run.id)
            .order_by(LoaderActivity.at.desc(), LoaderActivity.id.desc())
        ).scalars().all()
        stops = LoaderService._stops_by_order(db, run)
        return [LoaderService._to_run_event(row, stops) for row in rows]

    @staticmethod
    def _stops_by_order(db: Session, run: DeliveryRun) -> Dict[int, RunStop]:
        """Each order's stop on this run, from the newest plan version it is in.

        An order dropped by a later plan keeps the stop it was last on, so an
        old "loaded" entry still says where it was.
        """
        pairs = db.execute(
            select(RunStopOrder.order_id, RunStop)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .where(RunStop.run_id == run.id)
            .order_by(RunStop.plan_version)
        ).all()
        return {order_id: stop for order_id, stop in pairs}

    @staticmethod
    def _to_run_event(
        row: LoaderActivity, stops: Dict[int, RunStop]
    ) -> schemas.RunActivityEventRead:
        stop = stops.get(row.order_id) if row.order_id is not None else None
        return schemas.RunActivityEventRead(
            id=row.id,
            type=row.event_type,
            at=row.at,
            actor=schemas.ActivityActorRead(
                kind=row.actor_kind,
                name=row.actor.short_name if row.actor else row.actor_label,
                full_name=row.actor.full_name if row.actor else None,
            ),
            stop=(
                schemas.ActivityStopRead(sequence=stop.stop_sequence, outlet_code=stop.outlet.code)
                if stop is not None
                else None
            ),
            order=(
                schemas.ActivityOrderRead(order_number=row.order.order_number)
                if row.order is not None
                else None
            ),
            summary=LoaderService._activity_summary(row),
            details=LoaderService._activity_details(row),
        )

    @staticmethod
    def _activity_summary(row: LoaderActivity) -> str:
        """The loader's wording for an entry (Figma T1c Change log).

        Built at read time from the event and its order, so stored rows keep
        the Dispatcher's wording (Figma 2c #5) for the dock-wide feed. Anything
        without a loader wording here - dispatcher decisions, the system,
        future types - is shown as stored.
        """
        order_number = row.order.order_number if row.order else None
        if row.event_type in RELEASE_SUMMARIES:
            who = row.actor.short_name if row.actor else "unknown loader"
            return f"{RELEASE_SUMMARIES[row.event_type]} · {who}"
        if row.event_type == "plan_acknowledged":
            # TODO(L2): loader_session_id becomes required; drop "unknown loader".
            return f"Acknowledged · {row.actor.short_name if row.actor else 'unknown loader'}"
        if order_number and row.event_type in ORDER_SUMMARIES:
            summary = f"{order_number} {ORDER_SUMMARIES[row.event_type]}"
            if row.event_type == "order_unloaded":
                summary += f" → {LoaderService.return_area(row.order)}"
            return summary
        return row.message

    @staticmethod
    def _activity_details(row: LoaderActivity) -> Dict[str, object]:
        """Extra fields some types carry. Only what the row gives cleanly."""
        if row.event_type == "order_unloaded" and row.order is not None:
            return {"return_area": LoaderService.return_area(row.order)}
        return {}

    @staticmethod
    def resolve_dock(db: Session, dock: str) -> Dock:
        """Find a dock by number ("3"), code ("DOCK3") or name ("Dock 3")."""
        needle = (dock or "").strip()
        if not needle:
            raise NotFoundError("No dock given.", entity="Dock", entity_id=dock)

        candidates = [needle, needle.upper().replace(" ", "")]
        if needle.isdigit():
            candidates += [f"DOCK{needle}", f"Dock {needle}"]

        for candidate in candidates:
            found = db.execute(
                select(Dock).where(
                    (Dock.code == candidate) | (Dock.name == candidate)
                )
            ).scalars().first()
            if found is not None:
                return found

        raise NotFoundError(f"Dock '{dock}' not found.", entity="Dock", entity_id=dock)

    @staticmethod
    def list_dock_activity(
        db: Session,
        dock: Dock,
        run_code: Optional[str] = None,
        limit: int = 100,
    ) -> List[schemas.ActivityRead]:
        """Everything that happened at one dock, NEWEST first.

        This is a feed rather than a timeline - the loader coming back to the Log
        tab wants the most recent thing at the top, across every run on the dock.
        That is the opposite of the per-run timeline above, deliberately.

        `run_code` narrows the feed to one run without changing the ordering.
        """
        query = (
            select(LoaderActivity)
            .join(DeliveryRun, LoaderActivity.run_id == DeliveryRun.id)
            .where(DeliveryRun.dock_id == dock.id)
        )

        if run_code is not None:
            run = LoaderService.get_run(db, run_code)
            if run.dock_id != dock.id:
                raise NotFoundError(
                    f"Run '{run_code}' is not at {dock.name}.",
                    entity="DeliveryRun",
                    entity_id=run_code,
                )
            query = query.where(LoaderActivity.run_id == run.id)

        rows = db.execute(
            query.order_by(LoaderActivity.at.desc(), LoaderActivity.id.desc()).limit(limit)
        ).scalars()
        return [LoaderService._to_activity_read(row) for row in rows]

    # --- L2 sign-in: users and sessions ------------------------------------

    @staticmethod
    def list_users(db: Session, q: Optional[str] = None) -> List[LoaderUser]:
        """Active loaders for the sign-in tiles, by full name. `q` matches the
        full or short name anywhere, case-insensitive. Not filtered by depot:
        the tablet sends no dock, and loader_users only has an optional home dock."""
        query = select(LoaderUser).where(LoaderUser.is_active.is_(True))
        needle = (q or "").strip()
        if needle:
            like = f"%{needle}%"
            query = query.where(or_(LoaderUser.full_name.ilike(like), LoaderUser.short_name.ilike(like)))
        return list(db.execute(query.order_by(LoaderUser.full_name, LoaderUser.id)).scalars())

    @staticmethod
    def start_session(db: Session, payload: schemas.SessionRequest) -> LoaderSession:
        """Sign a loader in on a registered tablet.

        The tablet decides the dock, so an unknown or retired tablet is a 404.
        An unknown or inactive loader gets the same answer as a wrong PIN, so
        the endpoint does not reveal which ids exist. Other sessions on the
        tablet are left alone: the tablet ends the old one itself.
        """
        label = payload.dock_tablet_label.strip()
        tablet = db.execute(
            select(DockTablet).where(DockTablet.label == label, DockTablet.is_active.is_(True))
        ).scalars().first()
        if tablet is None:
            raise NotFoundError(
                f"Dock tablet '{label}' is not registered.", entity="DockTablet", entity_id=label
            )
        user = db.get(LoaderUser, payload.loader_user_id)
        if user is None or not user.is_active or not verify_password(payload.pin, user.pin_hash):
            raise IncorrectPinError()
        session = LoaderSession(loader_user_id=user.id, dock_tablet_id=tablet.id)
        db.add(session)
        db.flush()
        return session

    @staticmethod
    def end_session(
        db: Session, session_id: int, payload: schemas.EndSessionRequest
    ) -> LoaderSession:
        """End a session. Ending it again is a no-op that keeps the first
        ended_at / end_reason, because offline sign-outs are replayed."""
        session = db.get(LoaderSession, session_id)
        if session is None:
            raise NotFoundError(
                f"Loader session {session_id} not found.", entity="LoaderSession", entity_id=session_id
            )
        if session.ended_at is None:
            session.ended_at = datetime.now(timezone.utc)
            session.end_reason = payload.end_reason
            db.flush()
        return session

    @staticmethod
    def session_read(session: LoaderSession) -> schemas.LoaderSessionRead:
        dock = session.dock_tablet.dock
        return schemas.LoaderSessionRead(
            session_id=session.id,
            loader=schemas.SessionLoaderRead(
                id=session.loader_user.id, short_name=session.loader_user.short_name
            ),
            dock=dock.name,
            depot=dock.depot.value,
            started_at=session.started_at,
            ended_at=session.ended_at,
            end_reason=session.end_reason,
        )

    # --- L3 queue and summary ---------------------------------------------

    @staticmethod
    def queue_runs(db: Session, dock: Dock, brand: Optional[Brand] = None) -> List[DeliveryRun]:
        """The dock's runs, by departure. Gated-out runs have left the dock and
        drop off (they are the driver's now). Not narrowed to one day: the queue
        is whatever the dock still has to load or hand over."""
        query = select(DeliveryRun).where(
            DeliveryRun.dock_id == dock.id, DeliveryRun.status != RunStatus.GATED_OUT
        )
        if brand is not None:
            query = query.where(DeliveryRun.brand == brand)
        return list(db.execute(query.order_by(DeliveryRun.departs_at, DeliveryRun.code)).scalars())

    @staticmethod
    def build_queue(db: Session, dock: Dock, brand: Optional[Brand] = None) -> schemas.RunQueueRead:
        """GET /loader/runs: cards grouped by brand and wave ("Fresh · night
        wave"), groups in order of their first departure."""
        groups: Dict[Tuple[Brand, str], schemas.RunGroupRead] = {}
        for run in LoaderService.queue_runs(db, dock, brand):
            wave = run.wave or "day"
            key = (run.brand, wave)
            if key not in groups:
                groups[key] = schemas.RunGroupRead(
                    label=f"{BRAND_LABELS[run.brand]} · {wave} wave", brand=run.brand, wave=wave, runs=[]
                )
            groups[key].runs.append(LoaderService.run_card(db, run))
        return schemas.RunQueueRead(groups=list(groups.values()))

    @staticmethod
    def run_card(db: Session, run: DeliveryRun) -> schemas.RunSummaryRead:
        """One queue card. Counts, release fields and the plan alert come from
        the run read itself, so the card and the checklist never disagree."""
        detail = LoaderService.build_run_detail(db, run)
        return schemas.RunSummaryRead(
            code=run.code,
            vehicle_code=detail.vehicle.code,
            vehicle_type=detail.vehicle.vehicle_type,
            temp_capability=detail.vehicle.temp_capability,
            trip_number=run.trip_number,
            brand=run.brand,
            district=run.district,
            departs_at=run.departs_at,
            status=run.status,
            stop_count=len(detail.stops),
            orders_loaded=detail.orders_loaded,
            orders_checked=detail.orders_checked,
            orders_total=detail.orders_total,
            loader=LoaderService._run_loader(db, run),
            released_at=detail.released_at,
            released_by=detail.released_by,
            plan_updated_at=LoaderService.plan_updated_at(db, run),
            pre_stage_note=None,
            chips=LoaderService._run_chips(db, run),
            alert=LoaderService._run_alert(db, run, detail),
        )

    @staticmethod
    def _run_loader(db: Session, run: DeliveryRun) -> Optional[str]:
        """Who is on the run: the loader of its latest logged action, else who
        released it, else who checked an order last."""
        latest = db.execute(
            select(LoaderActivity)
            .where(
                LoaderActivity.run_id == run.id,
                LoaderActivity.actor_kind == ActorKind.LOADER,
                LoaderActivity.actor_id.is_not(None),
            )
            .order_by(LoaderActivity.at.desc(), LoaderActivity.id.desc())
        ).scalars().first()
        if latest is not None:
            return latest.actor.short_name
        if run.released_by is not None:
            return run.released_by.short_name
        checked = db.execute(
            select(RunStopOrder)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .where(RunStop.run_id == run.id, RunStopOrder.checked_by_id.is_not(None))
            .order_by(RunStopOrder.checked_at.desc())
        ).scalars().first()
        return checked.checked_by.short_name if checked is not None else None

    @staticmethod
    def _run_chips(db: Session, run: DeliveryRun) -> List[str]:
        """["Truck", "Reefer", third]: the third is the one thing the loader
        most needs to know - van-only access, a reload trip, or capacity."""
        vehicle = schemas.VehicleRead.model_validate(run.vehicle)
        chips = [
            "Van" if vehicle.vehicle_type == VehicleType.VAN else "Truck",
            "Reefer" if vehicle.temp_capability == TempCapability.REEFER else "Ambient",
        ]
        if any(stop.outlet.van_only for stop in LoaderService.current_stops(db, run)):
            chips.append("van_only")
        elif run.trip_number > 1:
            chips.append(f"{_ordinal(run.trip_number)} trip · reload")
        else:
            chips.append(f"{vehicle.max_weight_kg:,.0f} kg · {vehicle.max_volume_m3:.1f} m³")
        return chips

    @staticmethod
    def _run_alert(
        db: Session, run: DeliveryRun, detail: schemas.RunDetailRead
    ) -> Optional[schemas.RunAlertRead]:
        """The card's alert row, most urgent first: an unread plan (the same
        wording as the frontend's planChangeAlert), a flag waiting on the
        dispatcher, then signed off. The tablet replaces the plan alert with its
        own while it has taps waiting to sync."""
        href = f"/loader/runs/{quote(run.code)}"
        to = detail.unacknowledged_plan_version
        if to is not None:
            change = detail.plan_change
            since = detail.acknowledged_plan_version
            if since is None and change is not None:
                since = change.from_version
            versions = f"v{since} → v{to}" if since is not None and since != to else f"v{to}"
            published = change.published_at if change else detail.plan.published_at
            at = _depot_hhmm(published)
            if change is not None and change.was_ready_at is not None:
                return schemas.RunAlertRead(
                    tone="error",
                    message=f"Load reopened · {run.code} · {run.vehicle.code} · {versions} at {at}",
                    action="Open",
                    href=href,
                )
            return schemas.RunAlertRead(
                tone="warning", message=f"Plan updated {at} · {versions}", action="Review", href=href
            )

        waiting = LoaderService._waiting_issues(db, [run.id])
        if waiting:
            issue = waiting[-1]
            return schemas.RunAlertRead(
                tone="error",
                message=f"{issue.order.order_number} {ISSUE_WORDS[issue.issue_type]} · waiting",
                action="Open",
                href=f"/loader/issues/{issue.id}",
            )
        if run.status == RunStatus.READY_TO_DEPART:
            return schemas.RunAlertRead(
                tone="success",
                message="Signed off · driver can collect",
                action="View",
                href=f"{href}/ready",
            )
        return None

    @staticmethod
    def _waiting_issues(db: Session, run_ids: List[int]) -> List[LoaderIssue]:
        """Issues the dispatcher has not answered (sent or seen), oldest first."""
        if not run_ids:
            return []
        return list(
            db.execute(
                select(LoaderIssue)
                .where(
                    LoaderIssue.run_id.in_(run_ids),
                    LoaderIssue.status.in_([IssueStatus.SENT, IssueStatus.SEEN]),
                )
                .order_by(LoaderIssue.reported_at, LoaderIssue.id)
            ).scalars()
        )

    @staticmethod
    def build_summary(db: Session, dock: Dock) -> schemas.QueueSummaryRead:
        """GET /loader/summary: the queue's metric cards, counted from the same
        runs and cards as GET /loader/runs so the two agree.

        The day is the depot date of the first departure (a night wave leaving
        03:30 belongs to that date), or today when the dock has no runs.
        """
        runs = LoaderService.queue_runs(db, dock)
        cards = [LoaderService.run_card(db, run) for run in runs]
        day = _depot_date(runs[0].departs_at if runs else datetime.now(timezone.utc))

        holiday = db.execute(
            select(CalendarDay)
            .where(CalendarDay.date >= day, CalendarDay.holiday_name.is_not(None))
            .order_by(CalendarDay.date)
        ).scalars().first()

        loading = [c for c in cards if c.status in LOADING_RUN_STATES]
        loaders: List[str] = []
        for card in loading:
            first = card.loader.split(" ")[0] if card.loader else None
            if first and first not in loaders:
                loaders.append(first)
        waiting = LoaderService._waiting_issues(db, [run.id for run in runs])
        ready = [c.code for c in cards if c.status == RunStatus.READY_TO_DEPART]

        return schemas.QueueSummaryRead(
            dock=dock.name,
            date=day,
            day_label=_day_label(day),
            next_holiday=(
                schemas.HolidayRead(
                    date=holiday.date, label=f"{holiday.holiday_name} {_day_label(holiday.date)}"
                )
                if holiday is not None
                else None
            ),
            runs=len(cards),
            loading=schemas.LoadingCountRead(count=len(loading), loaders=loaders),
            issues=schemas.IssueCountRead(
                count=len(waiting), label="Awaiting decision" if waiting else "None waiting"
            ),
            ready=schemas.ReadyCountRead(count=len(ready), run_codes=ready),
            plan_updated_at=(
                LoaderService.dock_plan_updated_at(db, dock, [run.id for run in runs]) if runs else None
            ),
        )

    # --- L5 flags ---------------------------------------------------------------

    @staticmethod
    def flag_issue(db: Session, payload: schemas.FlagIssueRequest) -> LoaderIssue:
        """Flag an order as missing, short, damaged or won't fit (L5).

        Same order as the L4 writes: replay first (the issue already filed
        under this client_action_id comes back, nothing is filed twice), then
        the stale plan, then the write in one savepoint. The row goes to
        flagged, the run to issue_flagged, and release_blockers picks up
        issue_waiting from the new issue - the lock her mock server applies.
        """
        action_id = str(payload.client_action_id)
        replay = LoaderService._issue_replay(db, payload, action_id)
        if replay is not None:
            return replay

        run = LoaderService.get_run(db, payload.run_code)
        if payload.plan_version != run.current_plan_version:
            raise StalePlanVersionError(run, payload.plan_version)
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())

        if run.status in CLOSED_RUN_STATES:
            raise InvalidStateTransitionError(
                f"{run.code} is {run.status.value}; the checklist is closed.",
                current_state=run.status.value,
                target_state="flagged",
                entity="DeliveryRun",
            )
        current = LoaderService.get_revision(db, run, run.current_plan_version)
        if current is not None and current.acknowledged_at is None:
            raise PlanNotAcknowledgedError(run)

        row = LoaderService._current_row(db, run, payload.order_number)
        if row.state not in FLAGGABLE_STATES:
            raise InvalidStateTransitionError(
                f"{payload.order_number} is {row.state.value}; it cannot be flagged.",
                current_state=row.state.value,
                target_state=RunOrderState.FLAGGED.value,
                entity="RunStopOrder",
            )
        total = row.units if row.units is not None else payload.units_affected
        if not 0 <= payload.units_affected <= total:
            raise FlagRequestError(f"units_affected must be between 0 and {total}.")

        actor = LoaderService._session_actor(db, payload.loader_session_id)
        if actor is None:
            raise FlagRequestError("Sign in to flag an issue: loader_session_id is required.")

        now = datetime.now(timezone.utc)
        try:
            with db.begin_nested():
                issue = LoaderIssue(
                    run_id=run.id,
                    order_id=row.order_id,
                    issue_type=payload.issue_type,
                    units_affected=payload.units_affected,
                    units_total=total,
                    quick_note_tag=payload.quick_note_tag,
                    note=payload.note or None,
                    reported_by_id=actor.id,
                    reported_at=now,
                    client_action_id=action_id,
                    status=IssueStatus.SENT,
                    # Contract: the truck cannot wait; departure minus 20 minutes.
                    decide_by=_naive_utc(run.departs_at) - DECIDE_BY_LEAD,
                )
                for position, (label, detail, is_default) in enumerate(
                    _issue_options(payload.issue_type, payload.units_affected, total)
                ):
                    issue.options.append(
                        LoaderIssueOption(
                            label=label, detail=detail, is_default=is_default,
                            is_chosen=False, position=position,
                        )
                    )
                db.add(issue)

                row.state = RunOrderState.FLAGGED
                row.checked_at = None
                row.checked_by_id = None
                db.flush()
                LoaderService.refresh_stop_status(row.run_stop)
                LoaderService.recalculate_capacity(db, run)
                run.status = RunStatus.ISSUE_FLAGGED

                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.LOADER, event_type="issue_flagged",
                    actor_id=actor.id, order_id=row.order_id,
                    message=(
                        f"{payload.order_number}: {ISSUE_WORDS[payload.issue_type]} "
                        f"{payload.units_affected} of {total} units, sent to Dispatcher"
                    ),
                )
                db.flush()
        except IntegrityError:
            replay = LoaderService._issue_replay(db, payload, action_id)
            if replay is not None:
                return replay
            raise
        return issue

    @staticmethod
    def _issue_replay(
        db: Session, payload: schemas.FlagIssueRequest, action_id: str
    ) -> Optional[LoaderIssue]:
        """The issue already filed under this client_action_id, if any. The
        same id on another order or run is a client bug: 409."""
        issue = db.execute(
            select(LoaderIssue).filter_by(client_action_id=action_id)
        ).scalars().first()
        if issue is None:
            return None
        if issue.run.code != payload.run_code or issue.order.order_number != payload.order_number:
            raise ClientActionIdReusedError(action_id, entity="LoaderIssue")
        return issue

    @staticmethod
    def list_issues(db: Session, dock: Dock, run_code: Optional[str] = None) -> List[LoaderIssue]:
        """GET /loader/issues (L5, the Issues tab): every issue on the dock's
        runs, newest first, whatever its status. `run_code` narrows it to one
        run; a run at another dock is a 404, as on the dock-wide activity feed."""
        query = (
            select(LoaderIssue)
            .join(DeliveryRun, LoaderIssue.run_id == DeliveryRun.id)
            .where(DeliveryRun.dock_id == dock.id)
        )
        if run_code is not None:
            run = LoaderService.get_run(db, run_code)
            if run.dock_id != dock.id:
                raise NotFoundError(
                    f"Run '{run_code}' is not at {dock.name}.", entity="DeliveryRun", entity_id=run_code
                )
            query = query.where(LoaderIssue.run_id == run.id)
        return list(
            db.execute(query.order_by(LoaderIssue.reported_at.desc(), LoaderIssue.id.desc())).scalars()
        )

    # --- L6 release and undo -----------------------------------------------------

    @staticmethod
    def release_run(db: Session, run_code: str, payload: schemas.ReleaseRequest) -> DeliveryRun:
        """Mark the run ready to depart (L6).

        Replay first, then the stale plan. A run already ready is a 200 no-op
        (her mock server answers the same). Otherwise check_release_allowed
        refuses it with 409 RELEASE_LOCKED while anything blocks it. The release
        is stored three ways in one savepoint: delivery_runs.released_at/by,
        a run_release_actions row (the idempotency record) and the activity log.
        """
        run = LoaderService.get_run(db, run_code)
        action_id = str(payload.client_action_id)
        if LoaderService._release_replay(db, run, ReleaseAction.RELEASE, action_id):
            return run
        if payload.plan_version != run.current_plan_version:
            raise StalePlanVersionError(run, payload.plan_version)
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())

        if run.status == RunStatus.READY_TO_DEPART:
            return run
        if run.status == RunStatus.GATED_OUT:
            raise InvalidStateTransitionError(
                f"{run.code} is through the gate; it is the Driver's now.",
                current_state=run.status.value,
                target_state=RunStatus.READY_TO_DEPART.value,
                entity="DeliveryRun",
            )
        LoaderService.check_release_allowed(db, run)

        actor = LoaderService._session_actor(db, payload.loader_session_id)
        now = datetime.now(timezone.utc)
        return LoaderService._record_release(
            db, run, ReleaseAction.RELEASE, actor, now, action_id,
            apply=lambda: LoaderService._set_released(run, actor, now),
            event_type="run_released",
            message=f"Ready to depart · {_who(actor)}",
        )

    @staticmethod
    def undo_release(db: Session, run_code: str, payload: schemas.ReleaseRequest) -> DeliveryRun:
        """Undo "Mark ready to depart" within the window (L6).

        check_undo_allowed refuses a run that is no longer ready (a plan inside
        the window reopened it, or it gated out) and a late undo, 409
        UNDO_WINDOW_EXPIRED. Release needs every order checked, so an undone
        run is loaded again; released_at/by are cleared.
        """
        run = LoaderService.get_run(db, run_code)
        action_id = str(payload.client_action_id)
        if LoaderService._release_replay(db, run, ReleaseAction.UNDO, action_id):
            return run
        if payload.plan_version != run.current_plan_version:
            raise StalePlanVersionError(run, payload.plan_version)
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())
        LoaderService.check_undo_allowed(run)

        actor = LoaderService._session_actor(db, payload.loader_session_id)
        now = datetime.now(timezone.utc)
        return LoaderService._record_release(
            db, run, ReleaseAction.UNDO, actor, now, action_id,
            apply=lambda: LoaderService._set_released(run, None, None),
            event_type="run_release_undone",
            message=f"Ready undone · {_who(actor)}",
        )

    @staticmethod
    def _set_released(
        run: DeliveryRun, actor: Optional[LoaderUser], at: Optional[datetime]
    ) -> None:
        if at is None:
            run.status = RunStatus.LOADED
            run.released_at = None
            run.released_by_id = None
        else:
            run.status = RunStatus.READY_TO_DEPART
            run.released_at = at
            run.released_by_id = actor.id if actor else None

    @staticmethod
    def _record_release(
        db: Session,
        run: DeliveryRun,
        action: ReleaseAction,
        actor: Optional[LoaderUser],
        now: datetime,
        action_id: str,
        *,
        apply,
        event_type: str,
        message: str,
    ) -> DeliveryRun:
        try:
            with db.begin_nested():
                apply()
                db.add(
                    RunReleaseAction(
                        run_id=run.id, action=action, actor_id=actor.id if actor else None,
                        at=now, client_action_id=action_id,
                    )
                )
                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.LOADER, event_type=event_type,
                    actor_id=actor.id if actor else None, message=message,
                )
                db.flush()
        except IntegrityError:
            # The same id landed between our lookup and our insert.
            if LoaderService._release_replay(db, run, action, action_id):
                db.refresh(run)
                return run
            raise
        return run

    @staticmethod
    def _release_replay(
        db: Session, run: DeliveryRun, action: ReleaseAction, action_id: str
    ) -> bool:
        """True when this release or undo was applied before. The id on the
        other action, or on another run, is a client bug: 409."""
        recorded = db.execute(
            select(RunReleaseAction).filter_by(client_action_id=action_id)
        ).scalars().first()
        if recorded is None:
            return False
        if recorded.run_id != run.id or recorded.action != action:
            raise ClientActionIdReusedError(action_id, entity="RunReleaseAction")
        return True

    # --- writes from the tablet -------------------------------------------

    @staticmethod
    def apply_order_action(
        db: Session,
        run_code: str,
        order_number: str,
        action: CheckAction,
        payload: schemas.OrderActionRequest,
    ) -> DeliveryRun:
        """Check, uncheck or re-check one checklist row. Returns the run.

        Order matters:

        1. Replay first. A client_action_id already in loading_checks means this
           tap was applied before, so nothing is applied again. It comes before
           the stale-plan check on purpose: a check accepted under v2 and
           replayed after v3 is published must still answer 200, not 409.
        2. Stale plan: refuse a tap made against an older plan version, and
           any tap while the current version is still unacknowledged.
        3. Transition the row, then roll the change up into stop, run,
           capacity and the activity log - all in one savepoint, so a racing
           replay of the same id loses on the unique constraint instead of
           writing twice.
        """
        run = LoaderService.get_run(db, run_code)
        action_id = str(payload.client_action_id)

        if LoaderService._is_replay(db, run, order_number, action, action_id):
            return run

        if payload.plan_version != run.current_plan_version:
            raise StalePlanVersionError(run, payload.plan_version)

        # Serialise writers on this run so two tablets cannot race the run
        # status rollup. A no-op on SQLite, which has no row locks.
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())

        if run.status in CLOSED_RUN_STATES:
            raise InvalidStateTransitionError(
                f"{run.code} is {run.status.value}; the checklist is closed.",
                current_state=run.status.value,
                target_state=action.value,
                entity="DeliveryRun",
            )

        current = LoaderService.get_revision(db, run, run.current_plan_version)
        if current is not None and current.acknowledged_at is None:
            raise PlanNotAcknowledgedError(run)

        row = LoaderService._current_row(db, run, order_number)
        if row.state in ALREADY_DONE[action]:
            return run
        target = LoaderService._target_state(db, run, row, action)
        if row.state not in ORDER_ACTIONS[action]:
            raise InvalidStateTransitionError(
                f"{order_number} is {row.state.value}; it cannot be {action.value}ed.",
                current_state=row.state.value,
                target_state=target.value,
                entity="RunStopOrder",
            )

        actor = LoaderService._session_actor(db, payload.loader_session_id)
        now = datetime.now(timezone.utc)

        try:
            with db.begin_nested():
                db.add(
                    LoadingCheck(
                        run_stop_order_id=row.id,
                        action=action,
                        actor_id=actor.id if actor else None,
                        at=now,
                        client_action_id=action_id,
                        plan_version=run.current_plan_version,
                    )
                )
                was_re_check = row.state == RunOrderState.RE_CHECK
                row.state = target
                if target == RunOrderState.LOADED:
                    row.checked_at = now
                    row.checked_by_id = actor.id if actor else None
                else:
                    row.checked_at = None
                    row.checked_by_id = None
                db.flush()

                LoaderService.refresh_stop_status(row.run_stop)
                LoaderService.recalculate_capacity(db, run)
                LoaderService._refresh_run_status(db, run)

                # The log says what happened to the row: a check that clears
                # re_check is a re-check. loading_checks keeps the verb sent,
                # which is what a replay is matched against.
                logged_as = CheckAction.RECHECK if was_re_check else action
                event_type, verb = ACTION_EVENTS[logged_as]
                message = f"{order_number} {verb}"
                if action == CheckAction.UNLOAD:
                    message += f", back in {LoaderService.return_area(row.order)}"
                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.LOADER,
                    event_type=event_type, actor_id=actor.id if actor else None,
                    order_id=row.order_id, message=message,
                )
                db.flush()
        except IntegrityError:
            # The same id landed between our lookup and our insert. The savepoint
            # has rolled back our copy; the other one is the original.
            if LoaderService._is_replay(db, run, order_number, action, action_id):
                db.refresh(run)
                return run
            raise

        return run

    @staticmethod
    def _find_loading_check(db: Session, action_id: str) -> Optional[LoadingCheck]:
        return db.execute(
            select(LoadingCheck).filter_by(client_action_id=action_id)
        ).scalars().first()

    @staticmethod
    def _is_replay(
        db: Session, run: DeliveryRun, order_number: str, action: CheckAction, action_id: str
    ) -> bool:
        """True if this exact tap was already applied; raises if the id was reused."""
        existing = LoaderService._find_loading_check(db, action_id)
        if existing is None:
            return False
        previous = existing.run_stop_order
        if (
            existing.action != action
            or previous.run_stop.run_id != run.id
            or previous.order.order_number != order_number
        ):
            raise ClientActionIdReusedError(action_id)
        return True

    @staticmethod
    def _current_row(db: Session, run: DeliveryRun, order_number: str) -> RunStopOrder:
        row = db.execute(
            select(RunStopOrder)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .join(Order, RunStopOrder.order_id == Order.id)
            .where(
                RunStop.run_id == run.id,
                RunStop.plan_version == run.current_plan_version,
                Order.order_number == order_number,
            )
        ).scalars().first()
        if row is None:
            raise NotFoundError(
                f"Order '{order_number}' is not on {run.code} plan v{run.current_plan_version}.",
                entity="RunStopOrder",
                entity_id=order_number,
            )
        return row

    @staticmethod
    def _target_state(
        db: Session, run: DeliveryRun, row: RunStopOrder, action: CheckAction
    ) -> RunOrderState:
        if action == CheckAction.UNLOAD:
            return RunOrderState.MOVED
        if action != CheckAction.UNCHECK:
            return RunOrderState.LOADED
        # Unchecking returns the row to how the plan introduced it: an order the
        # current version added goes back to "new", not "to load".
        added_now = db.execute(
            select(PlanRevisionChange.id)
            .join(PlanRevision, PlanRevisionChange.revision_id == PlanRevision.id)
            .where(
                PlanRevision.run_id == run.id,
                PlanRevision.version == run.current_plan_version,
                PlanRevisionChange.change_kind == PlanChangeKind.LOAD_NEW,
                PlanRevisionChange.order_id == row.order_id,
            )
        ).first()
        return RunOrderState.NEW if added_now else RunOrderState.TO_LOAD

    @staticmethod
    def _session_actor(db: Session, session_id: Optional[int]) -> Optional[LoaderUser]:
        """The loader signed in when the tap happened.

        An ended session is still accepted: an offline tap is often replayed
        after the idle timeout has signed that loader out.
        """
        if session_id is None:
            return None
        session = db.get(LoaderSession, session_id)
        if session is None:
            raise NotFoundError(
                f"Loader session {session_id} not found.",
                entity="LoaderSession",
                entity_id=session_id,
            )
        return session.loader_user

    @staticmethod
    def acknowledge_plan(
        db: Session,
        run_code: str,
        version: int,
        payload: schemas.AcknowledgePlanRequest,
    ) -> DeliveryRun:
        """The loader has read the plan-change diff. Returns the run.

        Same order as apply_order_action: replay first, then the stale-plan
        check, then the write in a savepoint.

        Stacked changes are confirmed once: acknowledging v4 while v3 is also
        unread stamps both, because the loader read them as one diff (v2 -> v4).
        The client_action_id goes on the version named in the path only; the
        column is unique, and that is the revision the tap was for.
        """
        run = LoaderService.get_run(db, run_code)
        action_id = str(payload.client_action_id)

        existing = db.execute(
            select(PlanRevision).filter_by(client_action_id=action_id)
        ).scalars().first()
        if existing is not None:
            if existing.run_id == run.id and existing.version == version:
                return run
            raise ClientActionIdReusedError(action_id, entity="PlanRevision")

        if version != run.current_plan_version:
            raise StalePlanVersionError(run, version)

        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())

        if run.status == RunStatus.GATED_OUT:
            raise InvalidStateTransitionError(
                f"{run.code} has left the gate; plan changes go to the Driver.",
                current_state=run.status.value,
                target_state="acknowledged",
                entity="DeliveryRun",
            )

        revision = LoaderService.get_revision(db, run, version)
        if revision is None:
            raise NotFoundError(
                f"{run.code} has no plan v{version}.", entity="PlanRevision", entity_id=version
            )
        # Someone else already acknowledged it (another tablet, another id).
        if revision.acknowledged_at is not None:
            return run

        actor = LoaderService._session_actor(db, payload.loader_session_id)
        now = datetime.now(timezone.utc)
        unread = db.execute(
            select(PlanRevision).where(
                PlanRevision.run_id == run.id,
                PlanRevision.version <= version,
                PlanRevision.acknowledged_at.is_(None),
            )
        ).scalars().all()

        try:
            with db.begin_nested():
                for rev in unread:
                    rev.acknowledged_at = now
                    rev.acknowledged_by_id = actor.id if actor else None
                revision.client_action_id = action_id
                # TODO(L2): loader_session_id becomes required; drop "unknown loader".
                who = actor.full_name if actor else "unknown loader"
                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.LOADER,
                    event_type="plan_acknowledged", actor_id=actor.id if actor else None,
                    message=f"Plan v{version} received · {who}",
                )
                db.flush()
        except IntegrityError:
            replay = db.execute(
                select(PlanRevision).filter_by(client_action_id=action_id)
            ).scalars().first()
            if replay is not None and replay.run_id == run.id and replay.version == version:
                db.refresh(run)
                return run
            raise

        return run

    @staticmethod
    def return_area(order: Order) -> str:
        """Where an unloaded order goes back to: chilled to the chiller dock."""
        return "chiller" if order_temperature(order) == TemperatureClass.CHILLED else "staging"

    @staticmethod
    def refresh_stop_status(stop: RunStop) -> None:
        """complete when every active order is loaded or flagged, loading when
        any is aboard or resolved, otherwise pending. The seed uses this too."""
        active = [r for r in stop.orders if r.state not in OFF_PLAN_STATES]
        if active and all(r.state in RESOLVED_STATES for r in active):
            stop.status = StopStatus.COMPLETE
        elif any(r.state in RESOLVED_STATES | ON_TRUCK_STATES for r in active):
            stop.status = StopStatus.LOADING
        else:
            stop.status = StopStatus.PENDING

    @staticmethod
    def _refresh_run_status(db: Session, run: DeliveryRun) -> None:
        """not_started -> loading -> loaded, and back to loading on an uncheck.

        issue_flagged is left alone: it clears when the issue is decided (L8),
        not when rows change. A run never returns to not_started once touched.
        """
        if run.status == RunStatus.ISSUE_FLAGGED:
            return
        checked, total = LoaderService.progress(db, run)
        run.status = RunStatus.LOADED if total and checked == total else RunStatus.LOADING

    # --- helpers ----------------------------------------------------------

    @staticmethod
    def progress(db: Session, run: DeliveryRun) -> Tuple[int, int]:
        """(orders_checked, orders_total) for the current plan - the review gate."""
        active = [s for s in LoaderService._current_states(db, run) if s not in OFF_PLAN_STATES]
        return sum(1 for s in active if s in RESOLVED_STATES), len(active)

    @staticmethod
    def _current_states(db: Session, run: DeliveryRun) -> List[RunOrderState]:
        """Every row's state on the current plan version."""
        return list(
            db.execute(
                select(RunStopOrder.state)
                .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
                .where(
                    RunStop.run_id == run.id,
                    RunStop.plan_version == run.current_plan_version,
                )
            ).scalars()
        )

    @staticmethod
    def get_revision(db: Session, run: DeliveryRun, version: int) -> Optional[PlanRevision]:
        return db.execute(
            select(PlanRevision).filter_by(run_id=run.id, version=version)
        ).scalars().first()

    @staticmethod
    def recalculate_capacity(db: Session, run: DeliveryRun) -> None:
        """Recompute planned and loaded totals from the current plan's rows."""
        rows = db.execute(
            select(RunStopOrder)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .where(
                RunStop.run_id == run.id,
                RunStop.plan_version == run.current_plan_version,
            )
        ).scalars().all()

        planned_w = planned_v = loaded_w = loaded_v = 0.0
        for row in rows:
            # An order taken off the plan is not part of what the run should carry.
            if row.state in (RunOrderState.TAKE_OFF, RunOrderState.MOVED):
                continue
            planned_w += row.weight_kg or 0.0
            planned_v += row.volume_m3 or 0.0
            if row.state in ON_TRUCK_STATES:
                loaded_w += row.weight_kg or 0.0
                loaded_v += row.volume_m3 or 0.0

        run.planned_weight_kg = round(planned_w, 2)
        run.planned_volume_m3 = round(planned_v, 2)
        run.loaded_weight_kg = round(loaded_w, 2)
        run.loaded_volume_m3 = round(loaded_v, 2)

    @staticmethod
    def log(
        db: Session,
        run: DeliveryRun,
        *,
        at: datetime,
        actor_kind: ActorKind,
        event_type: str,
        message: str,
        actor_label: Optional[str] = None,
        actor_id: Optional[int] = None,
        order_id: Optional[int] = None,
    ) -> LoaderActivity:
        entry = LoaderActivity(
            run_id=run.id,
            at=at,
            actor_kind=actor_kind,
            actor_id=actor_id,
            actor_label=actor_label,
            event_type=event_type,
            order_id=order_id,
            message=message,
        )
        db.add(entry)
        return entry

    # --- publishing a plan ------------------------------------------------

    @staticmethod
    def publish_plan(
        db: Session,
        run: DeliveryRun,
        *,
        unload: List[str],
        dont_load: List[str],
        load_new: List[str],
        recheck: Optional[List[str]] = None,
        reasons: Optional[Dict[str, str]] = None,
        summary: Optional[str] = None,
        source: str = "Dispatcher",
        stop_order: Optional[List[int]] = None,
        actor_label: Optional[str] = None,
    ) -> PlanRevision:
        """Publish the next plan version for a run.

        Copies the current version's stops and rows forward, applies the three
        kinds of change, and leaves the revision unacknowledged so the checklist
        blocks until the loader reads it.

        What happens to each row:

        - unload / dont_load follow where the order actually is, whichever list
          it came in: aboard -> take_off (it has to come back off), still in
          staging -> moved. The change is recorded under the kind that applied.
        - recheck names the loaded orders the loader must re-confirm - the ones
          moved to reach an order coming off (Figma 2a: ORD0092305/06). Every
          other check is kept. With recheck=None, every order aboard is put to
          re_check, the safe default when nobody said which ones moved.
        - A load_new order already on the run is re-added in place: re_check if
          it is still aboard (a take_off nobody unloaded yet), new otherwise.
        - take_off and re_check rows are carried forward as they are, so a
          stacked change never loses an outstanding task or a check.
        - reasons are the dispatcher's words per order, shown in the diff.
        - stop_order (outlet ids) puts those stops first, in that delivery
          order; the others follow in their existing order. Without it a brand
          new stop goes first and the rest keep their order.

        The dev plan-change endpoint is the only caller today; the dispatcher's
        real publish is meant to call this too, so every rule about what a new
        version does to the run lives here and not in the simulation.
        """
        if run.status == RunStatus.GATED_OUT:
            raise InvalidStateTransitionError(
                "The run has already left the gate; plan changes are the driver's problem now.",
                current_state=run.status.value,
                target_state="plan_changed",
                entity="DeliveryRun",
            )

        old_version = run.current_plan_version
        new_version = old_version + 1

        unload = set(unload)
        dont_load = set(dont_load)
        load_new = list(load_new)
        recheck = None if recheck is None else set(recheck)
        readded = set(load_new)
        readded_rows: set = set()
        # (kind, order number) as actually applied, for the change records.
        applied: List[Tuple[PlanChangeKind, str]] = []

        old_stops = sorted(
            db.execute(
                select(RunStop).filter_by(run_id=run.id, plan_version=old_version)
            ).scalars(),
            key=lambda s: s.stop_sequence,
        )

        # Resolve the incoming orders first, so the final stop sequence can be
        # assigned in one pass. Renumbering existing stops afterwards would
        # collide with uq_run_stop_sequence partway through the UPDATE.
        new_orders: List[Order] = []
        for number in load_new:
            order = db.execute(
                select(Order).filter_by(order_number=number)
            ).scalars().first()
            if order is None:
                raise NotFoundError(
                    f"Order '{number}' not found.", entity="Order", entity_id=number
                )
            new_orders.append(order)

        existing_outlet_ids = {s.outlet_id for s in old_stops}
        prepended_outlet_ids: List[int] = []
        for order in new_orders:
            if (
                order.outlet_id is not None
                and order.outlet_id not in existing_outlet_ids
                and order.outlet_id not in prepended_outlet_ids
            ):
                prepended_outlet_ids.append(order.outlet_id)

        # A brand new stop goes first in delivery order, so it loads last -
        # nearest the door, first off the truck - unless stop_order says otherwise.
        default_order = prepended_outlet_ids + [s.outlet_id for s in old_stops]
        named = [o for o in dict.fromkeys(stop_order or []) if o in default_order]
        final_order = named + [o for o in default_order if o not in named]
        sequence_of = {outlet_id: index + 1 for index, outlet_id in enumerate(final_order)}
        total_stops = len(final_order)

        def load_position_for(sequence: int) -> int:
            return total_stops - sequence + 1

        carried: List[RunStop] = []
        for outlet_id in prepended_outlet_ids:
            sequence = sequence_of[outlet_id]
            new_stop = RunStop(
                run_id=run.id,
                plan_version=new_version,
                stop_sequence=sequence,
                load_position=load_position_for(sequence),
                outlet_id=outlet_id,
                eta=None,
                handling_minutes=None,
            )
            db.add(new_stop)
            db.flush()
            carried.append(new_stop)

        # Copy each existing stop and its rows forward into the new version.
        for old_stop in old_stops:
            sequence = sequence_of[old_stop.outlet_id]
            new_stop = RunStop(
                run_id=run.id,
                plan_version=new_version,
                stop_sequence=sequence,
                load_position=load_position_for(sequence),
                outlet_id=old_stop.outlet_id,
                eta=old_stop.eta,
                handling_minutes=old_stop.handling_minutes,
                status=old_stop.status,
            )
            db.add(new_stop)
            db.flush()
            for old_row in old_stop.orders:
                number = old_row.order.order_number
                if number in unload or number in dont_load:
                    if old_row.state in ON_TRUCK_STATES | {RunOrderState.TAKE_OFF}:
                        # On the truck: it has to physically come back off.
                        state = RunOrderState.TAKE_OFF
                        applied.append((PlanChangeKind.UNLOAD_FROM_TRUCK, number))
                    else:
                        # Never left staging, so it is simply dropped.
                        state = RunOrderState.MOVED
                        applied.append((PlanChangeKind.DONT_LOAD, number))
                elif number in readded:
                    readded_rows.add(number)
                    if old_row.state in OFF_PLAN_STATES:
                        # Back on the plan: still aboard (never unloaded) needs a
                        # re-check, otherwise it is loaded like any new order.
                        state = (
                            RunOrderState.RE_CHECK
                            if old_row.state == RunOrderState.TAKE_OFF
                            else RunOrderState.NEW
                        )
                        applied.append((PlanChangeKind.LOAD_NEW, number))
                    else:
                        state = old_row.state  # already on the plan
                elif old_row.state == RunOrderState.LOADED and (
                    recheck is None or number in recheck
                ):
                    state = RunOrderState.RE_CHECK
                else:
                    state = old_row.state
                db.add(
                    RunStopOrder(
                        run_stop_id=new_stop.id,
                        order_id=old_row.order_id,
                        plan_version=new_version,
                        state=state,
                        units=old_row.units,
                        weight_kg=old_row.weight_kg,
                        volume_m3=old_row.volume_m3,
                        checked_at=old_row.checked_at,
                        checked_by_id=old_row.checked_by_id,
                    )
                )
            carried.append(new_stop)

        # Attach the incoming orders to their stop, new or existing.
        for order in new_orders:
            if order.order_number in readded_rows:
                continue
            applied.append((PlanChangeKind.LOAD_NEW, order.order_number))
            stop = next((s for s in carried if s.outlet_id == order.outlet_id), None)
            if stop is None:
                raise NotFoundError(
                    f"No stop on {run.code} serves order '{order.order_number}'.",
                    entity="RunStop",
                    entity_id=order.order_number,
                )
            db.add(
                RunStopOrder(
                    run_stop_id=stop.id,
                    order_id=order.id,
                    plan_version=new_version,
                    state=RunOrderState.NEW,
                    units=order.units,
                    weight_kg=order.weight_kg,
                    volume_m3=order.volume_m3,
                )
            )

        run.current_plan_version = new_version
        db.flush()
        LoaderService.recalculate_capacity(db, run)

        now = datetime.now(timezone.utc)
        revision = PlanRevision(
            run_id=run.id,
            version=new_version,
            published_at=now,
            source=source,
            summary=summary or f"Plan v{old_version} -> v{new_version}",
            planned_weight_kg=run.planned_weight_kg,
            planned_volume_m3=run.planned_volume_m3,
        )
        db.add(revision)
        db.flush()

        # The diff's three groups, in the order the takeover shows them.
        groups = [PlanChangeKind.UNLOAD_FROM_TRUCK, PlanChangeKind.DONT_LOAD, PlanChangeKind.LOAD_NEW]
        for kind, number in sorted(applied, key=lambda a: (groups.index(a[0]), a[1])):
            order = db.execute(
                select(Order).filter_by(order_number=number)
            ).scalars().first()
            db.add(
                PlanRevisionChange(
                    revision_id=revision.id,
                    change_kind=kind,
                    order_id=order.id if order else None,
                    outlet_id=order.outlet_id if order else None,
                    reason=(reasons or {}).get(number),
                    position=groups.index(kind),
                )
            )

        LoaderService.log(
            db, run, at=now, actor_kind=ActorKind.DISPATCHER,
            event_type="plan_published", actor_label=actor_label or source,
            message=f"{source} published plan v{new_version}",
        )

        # A new plan reopens a signed-off load: the loader acknowledges, works
        # the diff and releases again. released_at is kept so the reopen screen
        # can say "was Ready 01:48"; the next release overwrites it.
        if run.status == RunStatus.READY_TO_DEPART:
            run.status = RunStatus.LOADING
            LoaderService.log(
                db, run, at=now, actor_kind=ActorKind.SYSTEM,
                event_type="load_reopened", actor_label="System",
                message=f"Load reopened · plan changed after Ready · v{old_version} -> v{new_version}",
            )
        elif run.status == RunStatus.LOADED:
            LoaderService._refresh_run_status(db, run)
        db.flush()
        return revision

    # --- integration slice 1: dispatcher -> loader ----------------------

    @staticmethod
    def run_for_dispatch_trip(db: Session, trip_id: int) -> Optional[DeliveryRun]:
        return db.execute(
            select(DeliveryRun).filter_by(dispatch_trip_id=trip_id)
        ).scalars().first()

    @staticmethod
    def create_run_for_dispatch_trip(
        db: Session, trip: DispatchTrip, *, dock_code: Optional[str] = None
    ) -> DeliveryRun:
        """Turn a dispatched allocation into a loader run with plan v1.

        The dispatcher calls this inside its own transaction, right after it
        creates the dispatch trip (POST /delivery-runs/from-allocation), so
        both commit or neither does. Nothing is committed here.

        - Idempotent: a run already built for this trip comes back unchanged.
        - 422 RUN_NOT_BUILDABLE lists every reason the trip cannot be loaded:
          no allocation or no orders, an order with no outlet or brand, orders
          of more than one brand, no departure time, no vehicle, no dock at
          the vehicle's depot, a trip code longer than a run code can be.
        - 409 RUN_CODE_TAKEN when a run (say a seeded demo run) already has
          the trip's code.
        - 409 ORDER_ON_ANOTHER_RUN when an order is already on another run's
          current plan and that run has not gated out.

        Stops follow the outlet codes in trip.stop_sequence when it names
        them; the rest go by delivery window, then outlet code. Plan v1 is
        left unacknowledged: the loader accepts it before the first tick.
        """
        existing = LoaderService.run_for_dispatch_trip(db, trip.id)
        if existing is not None:
            return existing

        violations: List[dict] = []

        def violation(code: str, message: str, order: Optional[Order] = None) -> None:
            entry = {"code": code, "message": message}
            if order is not None:
                entry["order_number"] = order.order_number
            violations.append(entry)

        orders: List[Order] = []
        if trip.allocation_id is None:
            violation("NO_ALLOCATION", "The trip was not dispatched from an allocation.")
        else:
            orders = list(
                db.execute(
                    select(Order).filter_by(allocation_id=trip.allocation_id).order_by(Order.id)
                ).scalars()
            )
            if not orders:
                violation("NO_ORDERS", "The allocation has no orders.")

        for order in orders:
            if order.outlet_id is None:
                violation("ORDER_WITHOUT_OUTLET", f"{order.order_number} has no outlet.", order)

        outlet_ids = {o.outlet_id for o in orders if o.outlet_id is not None}
        outlets = {
            o.id: o
            for o in db.execute(select(Outlet).where(Outlet.id.in_(outlet_ids))).scalars()
        } if outlet_ids else {}

        brands = set()
        for order in orders:
            brand = LoaderService._order_brand(order, outlets.get(order.outlet_id))
            if brand is None:
                violation("ORDER_WITHOUT_BRAND", f"{order.order_number} has no brand.", order)
            else:
                brands.add(brand)
        if len(brands) > 1:
            names = ", ".join(sorted(BRAND_LABELS[b] for b in brands))
            violation("MIXED_BRANDS", f"A loader run carries one brand; this trip has {names}.")

        if trip.departure_time is None:
            violation("NO_DEPARTURE_TIME", "The trip has no departure time.")

        vehicle = db.get(Vehicle, trip.vehicle_id) if trip.vehicle_id is not None else None
        dock = None
        if vehicle is None:
            violation("NO_VEHICLE", "The trip has no vehicle.")
        else:
            dock = LoaderService._dock_for(db, vehicle, dock_code)
            if dock is None:
                where = f"dock {dock_code}" if dock_code else f"dock at {vehicle.depot_name}"
                violation("NO_DOCK", f"There is no {where} to load {vehicle.code}.")

        if len(trip.trip_code) > RUN_CODE_MAX:
            violation(
                "RUN_CODE_TOO_LONG",
                f"{trip.trip_code} is longer than {RUN_CODE_MAX} characters.",
            )

        if violations:
            raise RunNotBuildableError(trip, violations)

        taken = db.execute(select(DeliveryRun).filter_by(code=trip.trip_code)).scalars().first()
        if taken is not None:
            raise RunCodeTakenError(trip, taken)

        clashes = LoaderService._orders_on_other_runs(db, [o.id for o in orders])
        if clashes:
            raise OrderOnAnotherRunError(trip, clashes)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        departs_at = _naive_utc(trip.departure_time)
        sequence = LoaderService._stop_order(trip, list(outlets.values()))
        districts = Counter(outlets[o.outlet_id].district for o in orders)

        try:
            with db.begin_nested():
                run = DeliveryRun(
                    code=trip.trip_code,
                    vehicle_id=vehicle.id,
                    dock_id=dock.id,
                    trip_number=LoaderService._next_trip_number(db, vehicle.id, departs_at),
                    brand=brands.pop(),
                    district=districts.most_common(1)[0][0],
                    departs_at=departs_at,
                    status=RunStatus.NOT_STARTED,
                    current_plan_version=1,
                    dispatch_trip_id=trip.id,
                )
                db.add(run)
                db.flush()

                for position, outlet in enumerate(sequence, start=1):
                    stop = RunStop(
                        run_id=run.id,
                        plan_version=1,
                        stop_sequence=position,
                        # Delivery order reversed: the last stop loads first, deepest.
                        load_position=len(sequence) - position + 1,
                        outlet_id=outlet.id,
                        status=StopStatus.PENDING,
                    )
                    db.add(stop)
                    db.flush()
                    for order in orders:
                        if order.outlet_id != outlet.id:
                            continue
                        db.add(
                            RunStopOrder(
                                run_stop_id=stop.id,
                                order_id=order.id,
                                plan_version=1,
                                state=RunOrderState.TO_LOAD,
                                units=LoaderService._order_units(order),
                                weight_kg=order.weight_kg,
                                volume_m3=order.volume_m3,
                            )
                        )
                db.flush()
                LoaderService.recalculate_capacity(db, run)

                db.add(
                    PlanRevision(
                        run_id=run.id,
                        version=1,
                        published_at=now,
                        source="Dispatcher",
                        summary=f"Plan v1 from {trip.trip_code}",
                        planned_weight_kg=run.planned_weight_kg,
                        planned_volume_m3=run.planned_volume_m3,
                    )
                )
                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.DISPATCHER,
                    event_type="plan_published", actor_label="Dispatcher",
                    message="Dispatcher published plan v1",
                )
                db.flush()
        except IntegrityError:
            # Another request built the run for this trip between our lookup
            # and our insert: theirs stands.
            existing = LoaderService.run_for_dispatch_trip(db, trip.id)
            if existing is not None:
                return existing
            raise
        return run

    @staticmethod
    def _order_brand(order: Order, outlet: Optional[Outlet]) -> Optional[Brand]:
        """orders.brand ("Fresh", a string) when it names a brand, else the outlet's."""
        if order.brand:
            try:
                return Brand(order.brand.strip().lower())
            except ValueError:
                pass
        return outlet.brand if outlet is not None else None

    @staticmethod
    def _order_units(order: Order) -> Optional[int]:
        """orders.units when set (the Store Manager sets it), else the sum of
        the order lines, else unknown."""
        if order.units is not None:
            return order.units
        if order.items:
            return sum(item.quantity for item in order.items)
        return None

    @staticmethod
    def _dock_for(db: Session, vehicle: Vehicle, dock_code: Optional[str]) -> Optional[Dock]:
        """The named dock, or else the first dock (by code) at the vehicle's depot."""
        if dock_code:
            return db.execute(select(Dock).filter_by(code=dock_code)).scalars().first()
        try:
            depot = Depot((vehicle.depot_name or "").strip().lower())
        except ValueError:
            return None
        return db.execute(
            select(Dock).filter_by(depot=depot).order_by(Dock.code)
        ).scalars().first()

    @staticmethod
    def _stop_order(trip: DispatchTrip, outlets: List[Outlet]) -> List[Outlet]:
        """Outlets in delivery order.

        trip.stop_sequence entries may be outlet codes, or objects carrying
        "outlet_code" (or "id") = the code. Entries that name no outlet of
        this trip (place names such as "Kelaniya") are ignored. Outlets the
        list does not name follow, by delivery window start, then code.
        """
        by_code = {o.code.upper(): o for o in outlets}
        ordered: List[Outlet] = []
        for entry in trip.stop_sequence or []:
            code = entry.get("outlet_code") or entry.get("id") if isinstance(entry, dict) else entry
            outlet = by_code.get(str(code).upper()) if code is not None else None
            if outlet is not None and outlet not in ordered:
                ordered.append(outlet)
        rest = sorted(
            (o for o in outlets if o not in ordered),
            key=lambda o: (o.window_start or time.max, o.code),
        )
        return ordered + rest

    @staticmethod
    def _next_trip_number(db: Session, vehicle_id: int, departs_at: datetime) -> int:
        """1 + the vehicle's other runs departing the same depot day."""
        day = _depot_date(departs_at)
        same_day = [
            r for r in db.execute(select(DeliveryRun).filter_by(vehicle_id=vehicle_id)).scalars()
            if _depot_date(r.departs_at) == day
        ]
        return len(same_day) + 1

    @staticmethod
    def _orders_on_other_runs(db: Session, order_ids: List[int]) -> List[dict]:
        """Orders still on another run's current plan, that run not gated out.

        A row taken off that plan (take_off, moved) does not count: the order
        has left that run, or is about to.
        """
        if not order_ids:
            return []
        rows = db.execute(
            select(Order.order_number, DeliveryRun.code)
            .select_from(RunStopOrder)
            .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
            .join(DeliveryRun, RunStop.run_id == DeliveryRun.id)
            .join(Order, RunStopOrder.order_id == Order.id)
            .where(
                RunStopOrder.order_id.in_(order_ids),
                RunStop.plan_version == DeliveryRun.current_plan_version,
                DeliveryRun.status != RunStatus.GATED_OUT,
                RunStopOrder.state.notin_(OFF_PLAN_STATES),
            )
            .order_by(Order.order_number)
        ).all()
        return [{"order_number": number, "run_code": code} for number, code in rows]

    # --- dispatcher plan change (integration) ----------------------------

    @staticmethod
    def require_run_for_dispatch_trip(db: Session, trip_id: int) -> DeliveryRun:
        run = LoaderService.run_for_dispatch_trip(db, trip_id)
        if run is None:
            raise NotFoundError(
                f"No loader run for dispatch trip {trip_id}.", entity="DeliveryRun", entity_id=trip_id
            )
        return run

    @staticmethod
    def _active_rows(db: Session, run: DeliveryRun) -> Dict[str, RunStopOrder]:
        """Current-plan rows still on the plan, by order number."""
        return {
            row.order.order_number: row
            for stop in LoaderService.current_stops(db, run)
            for row in stop.orders
            if row.state not in OFF_PLAN_STATES
        }

    @staticmethod
    def publish_dispatcher_plan(
        db: Session, run: DeliveryRun, payload: schemas.DispatcherPlanRequest
    ) -> Tuple[Optional[PlanRevision], bool]:
        """The dispatcher changes the plan of a run built from a dispatch trip.

        Returns (revision, replayed). revision is None when only departs_at
        changed: a new departure time alone is not a new plan version.

        - gated_out -> 409 PLAN_LOCKED. Any other status is allowed; a
          ready_to_depart run reopens (publish_plan, L7).
        - base_version must be the current version, else 409
          PLAN_VERSION_STALE - unless the current version is exactly this
          request, already applied (a retry): then it is returned as a replay.
        - 422 PLAN_CHANGE_INVALID lists everything wrong with the request.
        - 409 ORDER_ON_ANOTHER_RUN for an added order planned elsewhere.

        remove / move / defer all take the order off this run: off the truck
        (take_off) when it is aboard, otherwise moved. Rows aboard nearer the
        door than an order coming off are put to re_check (they are moved to
        reach it); a new stop order re-checks everything aboard.
        """
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())
        if run.status == RunStatus.GATED_OUT:
            raise PlanLockedError(run)

        removed = [r.order_number for r in (*payload.remove, *payload.move, *payload.defer)]
        added = [r.order_number for r in payload.add]

        if payload.base_version != run.current_plan_version:
            if LoaderService._plan_replay(db, run, payload, removed, added):
                return LoaderService.get_revision(db, run, run.current_plan_version), True
            raise StalePlanVersionError(run, payload.base_version)

        violations: List[dict] = []

        def violation(code: str, message: str, **extra) -> None:
            violations.append({"code": code, "message": message, **extra})

        seen: set = set()
        for number in removed + added:
            if number in seen:
                violation("DUPLICATE_ORDER", f"{number} is named more than once.", order_number=number)
            seen.add(number)

        active = LoaderService._active_rows(db, run)
        for number in removed:
            if number not in active:
                violation("ORDER_NOT_ON_RUN", f"{number} is not on {run.code}'s plan.", order_number=number)

        new_orders: List[Order] = []
        for number in added:
            order = db.execute(select(Order).filter_by(order_number=number)).scalars().first()
            if order is None:
                violation("ORDER_NOT_FOUND", f"{number} does not exist.", order_number=number)
                continue
            if order.outlet_id is None:
                violation("ORDER_WITHOUT_OUTLET", f"{number} has no outlet.", order_number=number)
                continue
            brand = LoaderService._order_brand(order, order.outlet)
            if brand != run.brand:
                violation("BRAND_MISMATCH", f"{number} is not a {BRAND_LABELS[run.brand]} order.",
                          order_number=number)
                continue
            new_orders.append(order)

        current_stops = LoaderService.current_stops(db, run)
        outlet_by_code = {s.outlet.code.upper(): s.outlet for s in current_stops}
        for order in new_orders:
            outlet_by_code.setdefault(order.outlet.code.upper(), order.outlet)
        stop_ids: List[int] = []
        for code in payload.stop_order or []:
            outlet = outlet_by_code.get(code.upper())
            if outlet is None:
                violation("UNKNOWN_STOP", f"{code} is not a stop on {run.code}.", outlet_code=code)
            elif outlet.id not in stop_ids:
                stop_ids.append(outlet.id)

        current_sequence = [s.outlet_id for s in sorted(current_stops, key=lambda s: s.stop_sequence)]
        resequenced = bool(stop_ids) and stop_ids != current_sequence[: len(stop_ids)]
        if not (removed or added or resequenced or payload.departs_at):
            violation("EMPTY_CHANGE", "Nothing to change: no orders, stop order or departure time.")

        if violations:
            raise PlanChangeInvalidError(run, violations)

        clashes = [
            c for c in LoaderService._orders_on_other_runs(db, [o.id for o in new_orders])
            if c["run_code"] != run.code
        ]
        if clashes:
            raise OrderOnAnotherRunError(_TripRef(run), clashes)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if payload.departs_at is not None:
            new_departure = _naive_utc(payload.departs_at)
            if new_departure != run.departs_at:
                LoaderService.log(
                    db, run, at=now, actor_kind=ActorKind.DISPATCHER,
                    event_type="departure_changed", actor_label=payload.dispatcher,
                    message=(
                        f"{payload.dispatcher} moved departure "
                        f"{_depot_hhmm(run.departs_at)} -> {_depot_hhmm(new_departure)}"
                    ),
                )
                run.departs_at = new_departure

        if not (removed or added or resequenced):
            db.flush()
            return None, False

        reasons = {}
        for ref in (*payload.remove, *payload.move, *payload.defer, *payload.add):
            if ref.reason:
                reasons[ref.order_number] = ref.reason

        revision = LoaderService.publish_plan(
            db,
            run,
            unload=removed,
            dont_load=[],
            load_new=added,
            recheck=None if resequenced else LoaderService._rows_to_reach(active, removed),
            reasons=reasons,
            summary=payload.summary,
            stop_order=stop_ids or None,
            actor_label=payload.dispatcher,
        )
        return revision, False

    @staticmethod
    def _rows_to_reach(active: Dict[str, RunStopOrder], removed: List[str]) -> List[str]:
        """Loaded orders that have to be moved to get the removed ones off.

        load_position 1 is deepest; anything aboard at a stop nearer the door
        (a higher load_position) than the deepest order coming off is in the way.
        """
        aboard = {n: r for n, r in active.items() if r.state in ON_TRUCK_STATES}
        coming_off = [aboard[n].run_stop.load_position for n in removed if n in aboard]
        if not coming_off:
            return []
        deepest = min(coming_off)
        return sorted(
            n for n, r in aboard.items()
            if n not in removed and r.run_stop.load_position > deepest
        )

    @staticmethod
    def _plan_replay(
        db: Session,
        run: DeliveryRun,
        payload: schemas.DispatcherPlanRequest,
        removed: List[str],
        added: List[str],
    ) -> bool:
        """True when the current plan version is this very request, already
        applied: one version past base_version, from the dispatcher, with the
        same orders off and on, the named stops first, and the same departure."""
        if run.current_plan_version != payload.base_version + 1:
            return False
        revision = LoaderService.get_revision(db, run, run.current_plan_version)
        if revision is None or revision.source != "Dispatcher":
            return False
        off_kinds = {PlanChangeKind.UNLOAD_FROM_TRUCK, PlanChangeKind.DONT_LOAD}
        off = {c.order.order_number for c in revision.changes if c.order and c.change_kind in off_kinds}
        on = {c.order.order_number for c in revision.changes
              if c.order and c.change_kind == PlanChangeKind.LOAD_NEW}
        if off != set(removed) or on != set(added):
            return False
        if payload.stop_order:
            sequence = [
                s.outlet.code.upper()
                for s in sorted(LoaderService.current_stops(db, run), key=lambda s: s.stop_sequence)
            ]
            named = list(dict.fromkeys(c.upper() for c in payload.stop_order))
            if sequence[: len(named)] != named:
                return False
        if payload.departs_at is not None and _naive_utc(payload.departs_at) != run.departs_at:
            return False
        return True

    @staticmethod
    def order_destination(db: Session, run: DeliveryRun, row: RunStopOrder) -> dict:
        """moved_to / deferred_to for an order this run's plan has dropped.

        Read from where the order is now, so nothing extra is stored: moved_to
        when another loader run (not gated out) has it on its current plan,
        deferred_to when the order is DEFERRED to a later operating day.
        """
        if row.state not in OFF_PLAN_STATES:
            return {}
        fields: dict = {}
        other = db.execute(
            select(DeliveryRun)
            .join(RunStop, RunStop.run_id == DeliveryRun.id)
            .join(RunStopOrder, RunStopOrder.run_stop_id == RunStop.id)
            .where(
                RunStopOrder.order_id == row.order_id,
                DeliveryRun.id != run.id,
                RunStop.plan_version == DeliveryRun.current_plan_version,
                DeliveryRun.status != RunStatus.GATED_OUT,
                RunStopOrder.state.notin_(OFF_PLAN_STATES),
            )
        ).scalars().first()
        if other is not None:
            fields["moved_to"] = schemas.MovedToRead(
                run_code=other.code,
                vehicle_code=other.vehicle.code,
                trip_number=other.trip_number,
                departs_at=other.departs_at,
            )
        order = row.order
        if order.status == OrderStatus.DEFERRED and order.operating_date:
            try:
                day = date.fromisoformat(order.operating_date[:10])
            except ValueError:
                day = None
            if day is not None and day > _depot_date(run.departs_at):
                fields["deferred_to"] = day
        return fields

    # --- dispatcher decision (integration, L8) ---------------------------

    @staticmethod
    def decide_issue(
        db: Session, issue: LoaderIssue, payload: schemas.IssueDecisionRequest
    ) -> Tuple[LoaderIssue, bool]:
        """The dispatcher's decision on a flag. Returns (issue, replayed).

        option is the option's id, or its label. 422 INVALID_OPTION when the
        issue has no such option. Deciding again with the option already
        chosen is a replay (200, nothing written); any other option on a
        decided or defaulted issue is 409 ISSUE_ALREADY_DECIDED. A run through
        the gate is 409 too.
        """
        chosen = LoaderService._find_option(issue, payload.option)
        if chosen is None:
            raise InvalidOptionError(issue, payload.option)
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == issue.run_id).with_for_update())

        if issue.status in (IssueStatus.DECIDED, IssueStatus.DEFAULT_APPLIED):
            current = next((o for o in issue.options if o.is_chosen), None)
            if current is not None and current.id == chosen.id:
                return issue, True
            raise IssueAlreadyDecidedError(issue, current)
        if issue.run.status == RunStatus.GATED_OUT:
            raise InvalidStateTransitionError(
                f"{issue.run.code} has gone through the gate.",
                current_state=issue.run.status.value,
                target_state=IssueStatus.DECIDED.value,
                entity="LoaderIssue",
            )

        message = f"{issue.order.order_number}: {chosen.label}"
        if payload.note:
            message += f" · {payload.note}"
        LoaderService._record_decision(
            db, issue, chosen,
            status=IssueStatus.DECIDED, decided_by=payload.decided_by,
            actor_kind=ActorKind.DISPATCHER, event_type="issue_decided", message=message,
        )
        return issue, False

    @staticmethod
    def _find_option(issue: LoaderIssue, option) -> Optional[LoaderIssueOption]:
        if isinstance(option, int):
            return next((o for o in issue.options if o.id == option), None)
        text = str(option).strip()
        if text.isdigit():
            by_id = next((o for o in issue.options if o.id == int(text)), None)
            if by_id is not None:
                return by_id
        return next((o for o in issue.options if o.label.lower() == text.lower()), None)

    @staticmethod
    def _record_decision(
        db: Session,
        issue: LoaderIssue,
        chosen: LoaderIssueOption,
        *,
        status: IssueStatus,
        decided_by: str,
        actor_kind: ActorKind,
        event_type: str,
        message: str,
    ) -> None:
        """Mark the option chosen, apply the outcome to the run (which lifts
        the release lock once nothing waits) and log it. Shared by the real
        decision, the dev decision and the decide-by default."""
        now = datetime.now(timezone.utc)
        for option in issue.options:
            option.is_chosen = option is chosen
        issue.status = status
        issue.decided_at = now
        issue.decided_by = decided_by
        if issue.seen_at is None and status == IssueStatus.DECIDED:
            issue.seen_at = now
        LoaderService._apply_issue_outcome(db, issue, chosen)
        LoaderService.log(
            db, issue.run, at=now, actor_kind=actor_kind, event_type=event_type,
            actor_label=decided_by if actor_kind == ActorKind.DISPATCHER else "System",
            order_id=issue.order_id, message=message,
        )
        db.flush()

    @staticmethod
    def apply_default_decision(db: Session, issue: LoaderIssue) -> LoaderIssue:
        """Apply the pre-agreed default because decide-by passed (L8 timeout)."""
        if issue.status in (IssueStatus.DECIDED, IssueStatus.DEFAULT_APPLIED):
            raise InvalidStateTransitionError(
                "This issue has already been resolved.",
                current_state=issue.status.value,
                target_state="default_applied",
                entity="LoaderIssue",
            )
        chosen = next((o for o in issue.options if o.is_default), None)
        if chosen is None:
            raise NotFoundError(
                f"Issue {issue.id} has no default option to apply.",
                entity="LoaderIssueOption",
                entity_id=issue.id,
            )
        LoaderService._record_decision(
            db, issue, chosen,
            status=IssueStatus.DEFAULT_APPLIED, decided_by="System (decide-by passed)",
            actor_kind=ActorKind.SYSTEM, event_type="issue_default_applied",
            message=f"No decision by decide-by; applied default: {chosen.label}",
        )
        return issue

    @staticmethod
    def apply_overdue_defaults(
        db: Session, now: Optional[datetime] = None, *, linked_only: bool = True
    ) -> List[LoaderIssue]:
        """Apply the default to every waiting issue whose decide-by has passed.

        Called on the loader and dispatcher reads, so an overdue issue is
        never shown as still waiting. linked_only (the default on reads) keeps
        it to runs built from a dispatch trip: seeded demo runs such as
        LDR-RUN-1002 have no dispatcher to answer and are left to the dev
        /expire endpoint. Runs through the gate and issues with no default
        are skipped.
        """
        cutoff = _naive_utc(now or datetime.now(timezone.utc))
        query = (
            select(LoaderIssue)
            .join(DeliveryRun, LoaderIssue.run_id == DeliveryRun.id)
            .where(
                LoaderIssue.status.in_([IssueStatus.SENT, IssueStatus.SEEN]),
                LoaderIssue.decide_by.is_not(None),
                LoaderIssue.decide_by < cutoff,
                DeliveryRun.status != RunStatus.GATED_OUT,
            )
            .order_by(LoaderIssue.decide_by, LoaderIssue.id)
        )
        if linked_only:
            query = query.where(DeliveryRun.dispatch_trip_id.is_not(None))
        applied = []
        for issue in db.execute(query).scalars().all():
            if any(o.is_default for o in issue.options):
                applied.append(LoaderService.apply_default_decision(db, issue))
        return applied

    # --- driver hand-off and gate-out (integration) ----------------------

    @staticmethod
    def handoff(db: Session, run: DeliveryRun) -> schemas.HandoffRead:
        """What is on the truck, for the driver. 409 RUN_NOT_RELEASED until
        the loader has released the run (ready_to_depart or gated_out)."""
        if run.status not in CLOSED_RUN_STATES:
            raise RunNotReleasedError(run)

        latest = LoaderService._latest_issues(db, run)
        shortfalls = {
            order_id: LoaderService._shortfall_read(issue)
            for order_id, issue in latest.items()
            if issue.status in (IssueStatus.DECIDED, IssueStatus.DEFAULT_APPLIED)
        }
        stops = []
        units_ordered = units_loaded = 0
        for stop in sorted(LoaderService.current_stops(db, run), key=lambda s: s.stop_sequence):
            orders = []
            for row in sorted(stop.orders, key=lambda r: r.order.order_number):
                if row.state in OFF_PLAN_STATES:
                    continue
                loaded = LoaderService.loaded_units(row, latest.get(row.order_id))
                units_ordered += row.units or 0
                units_loaded += loaded
                orders.append(schemas.HandoffOrderRead(
                    order_number=row.order.order_number,
                    temperature_class=order_temperature(row.order),
                    units_ordered=row.units,
                    loaded_units=loaded,
                    weight_kg=row.weight_kg,
                    volume_m3=row.volume_m3,
                    shortfall=shortfalls.get(row.order_id),
                ))
            if not orders:
                continue  # every order of this stop left the plan
            stops.append(schemas.HandoffStopRead(
                stop_sequence=stop.stop_sequence,
                load_position=stop.load_position,
                outlet_code=stop.outlet.code,
                outlet_name=stop.outlet.name,
                district=stop.outlet.district,
                eta=stop.eta,
                orders=orders,
            ))

        return schemas.HandoffRead(
            dispatch_trip_id=run.dispatch_trip_id,
            run_code=run.code,
            status=run.status,
            plan_version=run.current_plan_version,
            vehicle_code=run.vehicle.code,
            dock=run.dock.code,
            departs_at=run.departs_at,
            gated_out_at=run.gated_out_at,
            units_ordered=units_ordered,
            units_loaded=units_loaded,
            stops=stops,
            shortfalls=sorted(shortfalls.values(), key=lambda s: s.order_number),
            **LoaderService.release_fields(run),
        )

    @staticmethod
    def _shortfall_read(issue: LoaderIssue) -> schemas.HandoffShortfallRead:
        chosen = next((o for o in issue.options if o.is_chosen), None)
        return schemas.HandoffShortfallRead(
            issue_id=issue.id,
            order_number=issue.order.order_number,
            outlet_code=issue.order.outlet.code if issue.order.outlet else None,
            issue_type=issue.issue_type,
            units_affected=issue.units_affected,
            units_total=issue.units_total,
            status=issue.status,
            decision=chosen.label if chosen else None,
            decided_by=issue.decided_by,
            decided_at=issue.decided_at,
        )

    @staticmethod
    def gate_out(
        db: Session, run: DeliveryRun, payload: schemas.GateOutRequest
    ) -> Tuple[DeliveryRun, bool]:
        """The truck leaves: ready_to_depart -> gated_out. Returns (run, replayed).

        A run already gated out is a replay (200). Anything not released is
        409 RUN_NOT_RELEASED. Once gated out the run leaves the loader queue,
        release and undo answer 409, and dispatcher plan changes 409 PLAN_LOCKED.
        """
        db.execute(select(DeliveryRun.id).where(DeliveryRun.id == run.id).with_for_update())
        if run.status == RunStatus.GATED_OUT:
            return run, True
        if run.status != RunStatus.READY_TO_DEPART:
            raise RunNotReleasedError(run)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        run.status = RunStatus.GATED_OUT
        run.gated_out_at = now
        who = payload.by or "Driver"
        LoaderService.log(
            db, run, at=now, actor_kind=ActorKind.SYSTEM, event_type="gated_out",
            actor_label=who, message=f"Gated out · {who}",
        )
        db.flush()
        return run, False

    # --- integration slice 1: loader -> dispatcher ----------------------

    @staticmethod
    def dispatcher_view(
        db: Session, dispatch_trip_ids: List[int]
    ) -> Dict[int, schemas.DispatcherLoadingRead]:
        """The dock's side of each dispatch trip, by trip id, for the
        dispatcher's delivery runs list and Loading readiness dialog.

        Field names follow what that dialog already reads off a dispatch trip
        (stop_count, stops_completed, open_shortfalls, loading_events), so the
        dispatcher can show `run.loader` where it showed `run`. Trips with no
        loader run are simply absent.
        """
        if not dispatch_trip_ids:
            return {}
        runs = db.execute(
            select(DeliveryRun).where(DeliveryRun.dispatch_trip_id.in_(dispatch_trip_ids))
        ).scalars().all()
        return {run.dispatch_trip_id: LoaderService._dispatcher_read(db, run) for run in runs}

    @staticmethod
    def _dispatcher_read(db: Session, run: DeliveryRun) -> schemas.DispatcherLoadingRead:
        stops = LoaderService.current_stops(db, run)
        # A stop whose every order left the plan is no longer a stop to load.
        active_stops = [
            s for s in stops if any(r.state not in OFF_PLAN_STATES for r in s.orders)
        ]
        checked, total = LoaderService.progress(db, run)
        revision = LoaderService.get_revision(db, run, run.current_plan_version)
        waiting = db.execute(
            select(func.count(LoaderIssue.id)).where(
                LoaderIssue.run_id == run.id,
                LoaderIssue.status.in_([IssueStatus.SENT, IssueStatus.SEEN]),
            )
        ).scalar()
        activity = db.execute(
            select(LoaderActivity)
            .filter_by(run_id=run.id)
            .order_by(LoaderActivity.at, LoaderActivity.id)
        ).scalars().all()
        stop_of = LoaderService._stops_by_order(db, run) if activity else {}

        events = []
        for row in activity:
            note = row.message
            if row.event_type == "issue_flagged" and row.order_id in stop_of:
                # The shortfall dialog reads the note as "stop · issue".
                note = f"{stop_of[row.order_id].outlet.code} · {row.message}"
            events.append(
                schemas.DispatcherLoadingEventRead(
                    event=DISPATCHER_EVENT_TITLES.get(
                        row.event_type, row.event_type.replace("_", " ").capitalize()
                    ),
                    time=_depot_hhmm(row.at),
                    note=note,
                    status=DISPATCHER_EVENT_STATUS.get(row.event_type, "ok"),
                    at=row.at,
                    type=row.event_type,
                )
            )

        return schemas.DispatcherLoadingRead(
            run_code=run.code,
            status=run.status,
            dock=run.dock.code,
            departs_at=run.departs_at,
            plan_version=run.current_plan_version,
            plan_acknowledged=revision is None or revision.acknowledged_at is not None,
            stop_count=len(active_stops),
            stops_completed=sum(1 for s in active_stops if s.status == StopStatus.COMPLETE),
            orders_checked=checked,
            orders_total=total,
            open_shortfalls=waiting or 0,
            planned_weight_kg=run.planned_weight_kg,
            loaded_weight_kg=run.loaded_weight_kg,
            planned_volume_m3=run.planned_volume_m3,
            loaded_volume_m3=run.loaded_volume_m3,
            last_update_at=activity[-1].at if activity else None,
            loading_events=events,
            **LoaderService.release_fields(run),
        )

    # --- dev-only simulation ---------------------------------------------

    @staticmethod
    def simulate_plan_change(
        db: Session,
        run: DeliveryRun,
        payload: schemas.SimulatedPlanChangeRequest,
    ) -> PlanRevision:
        """Publish the next plan version, as the dispatcher would."""
        return LoaderService.publish_plan(
            db,
            run,
            unload=payload.unload_order_numbers or [],
            dont_load=payload.dont_load_order_numbers or [],
            load_new=payload.load_new_order_numbers or [],
            recheck=payload.recheck_order_numbers,
            reasons=payload.reasons,
            summary=payload.summary,
        )

    @staticmethod
    def simulate_decision(
        db: Session,
        issue: LoaderIssue,
        payload: schemas.SimulatedDecisionRequest,
    ) -> LoaderIssue:
        """Apply a dispatcher decision to a waiting issue."""
        if issue.status in (IssueStatus.DECIDED, IssueStatus.DEFAULT_APPLIED):
            raise InvalidStateTransitionError(
                "This issue has already been resolved.",
                current_state=issue.status.value,
                target_state="decided",
                entity="LoaderIssue",
            )

        options = {o.label: o for o in issue.options}
        label = payload.option_label
        if label is None:
            chosen = next((o for o in issue.options if o.is_default), None)
        else:
            chosen = options.get(label)
            if chosen is None:
                raise NotFoundError(
                    f"Option '{label}' is not on issue {issue.id}.",
                    entity="LoaderIssueOption",
                    entity_id=label,
                )
        if chosen is None:
            raise NotFoundError(
                f"Issue {issue.id} has no default option to apply.",
                entity="LoaderIssueOption",
                entity_id=issue.id,
            )

        LoaderService._record_decision(
            db, issue, chosen,
            status=IssueStatus.DECIDED, decided_by=payload.decided_by,
            actor_kind=ActorKind.DISPATCHER, event_type="issue_decided",
            message=f"{issue.order.order_number}: {chosen.label}",
        )
        return issue

    @staticmethod
    def simulate_decision_timeout(db: Session, issue: LoaderIssue) -> LoaderIssue:
        """Apply the pre-agreed default because decide-by passed (dev /expire)."""
        return LoaderService.apply_default_decision(db, issue)

    @staticmethod
    def _apply_issue_outcome(
        db: Session, issue: LoaderIssue, chosen: LoaderIssueOption
    ) -> None:
        """Take the flagged order off the run when the decision removes it.

        "Send without it" and "Move to ..." both mean the order stops being this
        run's problem; "Hold ..." keeps it aboard and only delays departure.
        """
        label = chosen.label.lower()
        removes_order = label.startswith("send without") or label.startswith("move to")

        if removes_order:
            row = db.execute(
                select(RunStopOrder)
                .join(RunStop, RunStopOrder.run_stop_id == RunStop.id)
                .where(
                    RunStop.run_id == issue.run_id,
                    RunStop.plan_version == issue.run.current_plan_version,
                    RunStopOrder.order_id == issue.order_id,
                )
            ).scalars().first()
            if row is not None:
                row.state = RunOrderState.MOVED
            LoaderService.recalculate_capacity(db, issue.run)

        # With nothing left waiting, the run can be released again.
        outstanding = db.execute(
            select(LoaderIssue).where(
                LoaderIssue.run_id == issue.run_id,
                LoaderIssue.status.in_([IssueStatus.SENT, IssueStatus.SEEN]),
                LoaderIssue.id != issue.id,
            )
        ).scalars().first()
        if outstanding is None and issue.run.status == RunStatus.ISSUE_FLAGGED:
            issue.run.status = RunStatus.LOADING


def _naive_utc(value: datetime) -> datetime:
    """Compare stored (naive UTC) and fresh (aware UTC) datetimes safely."""
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


class PlanDiff:
    """The latest plan change read against the plan before it.

    Built by LoaderService._plan_diff; this only turns it into the extra fields
    on the checklist read. Which group an order is in follows where the order
    is NOW, not only what each version said, so stacked changes collapse:
    added in v3 and dropped again in v4 before loading is no change at all.
    """

    def __init__(
        self,
        *,
        base_version: int,
        window: List[PlanRevision],
        base_stops: List[RunStop],
        changes: List[PlanRevisionChange],
        rechecked: dict,
        unloaded_in_window: set,
        current_stops: List[RunStop],
    ):
        self.base_version = base_version
        self.window = window
        self.to_version = window[-1].version
        self.base_sequence = {s.outlet_id: s.stop_sequence for s in base_stops}
        self.base_rows = {row.order_id: row for s in base_stops for row in s.orders}
        # Latest change per order across the window: the dispatcher's words.
        self.changes = {c.order_id: c for c in changes if c.order_id is not None}
        # Re-confirmed in this change: checked again while it was already aboard.
        self.rechecked = {
            order_id: version
            for order_id, version in rechecked.items()
            if order_id in self.base_rows and self.base_rows[order_id].state in ON_TRUCK_STATES
        }
        self.unloaded = unloaded_in_window
        # Orders coming off the truck, with their stop's load position, so a
        # re-check row can say which order it was moved to reach.
        self.coming_off = [
            (stop.load_position, row.order.order_number)
            for stop in current_stops
            for row in stop.orders
            if self._is_unload(row)
        ]

    def _is_unload(self, row: RunStopOrder) -> bool:
        return row.state == RunOrderState.TAKE_OFF or (
            row.state == RunOrderState.MOVED and row.order_id in self.unloaded
        )

    def _kind(self, row: RunStopOrder) -> Optional[PlanChangeKind]:
        base = self.base_rows.get(row.order_id)
        was_on_plan = base is not None and base.state not in OFF_PLAN_STATES
        if self._is_unload(row):
            return PlanChangeKind.UNLOAD_FROM_TRUCK
        if row.state == RunOrderState.MOVED:
            return PlanChangeKind.DONT_LOAD if was_on_plan else None
        if not was_on_plan:
            return PlanChangeKind.LOAD_NEW
        return None

    def order_fields(self, row: RunStopOrder, stop: RunStop) -> dict:
        kind = self._kind(row)
        if kind is not None:
            change = self.changes.get(row.order_id)
            note = None
            if row.state == RunOrderState.TAKE_OFF:
                note = "Take off the truck"
            elif kind == PlanChangeKind.UNLOAD_FROM_TRUCK:
                note = f"Off truck · back in {LoaderService.return_area(row.order)}"
            return {
                "change_kind": kind,
                "changed_in_version": change.revision.version if change else self.to_version,
                "reason": change.reason if change else None,
                "note": note,
            }
        if row.state == RunOrderState.RE_CHECK:
            reach = sorted(n for position, n in self.coming_off if position < stop.load_position)
            return {
                "changed_in_version": self.to_version,
                "note": (
                    f"Re-check · moved to reach {', '.join(reach)}"
                    if reach else "Re-check · plan changed"
                ),
            }
        if row.state == RunOrderState.LOADED and row.order_id in self.rechecked:
            return {"changed_in_version": self.rechecked[row.order_id]}
        return {}

    def stop_fields(self, stop: RunStop) -> dict:
        before = self.base_sequence.get(stop.outlet_id)
        if before is None:
            return {"note": "new stop", "is_new": True}
        if before != stop.stop_sequence:
            return {"note": f"was Stop {before}"}
        return {}

    def summary(self, db: Session, run: DeliveryRun, stops: List[RunStop]) -> schemas.PlanDiffRead:
        latest = self.window[-1]
        before = [r for r in self.base_rows.values() if r.state not in OFF_PLAN_STATES]

        # "was Ready 01:48" only when this change is what reopened the run.
        published = _naive_utc(self.window[0].published_at)
        reopened = any(
            _naive_utc(entry.at) >= published
            for entry in db.execute(
                select(LoaderActivity).filter_by(run_id=run.id, event_type="load_reopened")
            ).scalars()
        )
        was_ready_at = (
            run.released_at
            if reopened and run.released_at and run.status not in CLOSED_RUN_STATES
            else None
        )

        return schemas.PlanDiffRead(
            from_version=self.base_version,
            to_version=latest.version,
            published_at=latest.published_at,
            summary=latest.summary,
            planned_weight_before_kg=round(sum(r.weight_kg or 0.0 for r in before), 2),
            planned_weight_after_kg=run.planned_weight_kg,
            planned_volume_before_m3=round(sum(r.volume_m3 or 0.0 for r in before), 2),
            planned_volume_after_m3=run.planned_volume_m3,
            checks_saved=sum(1 for s in stops for r in s.orders if r.checked_at is not None),
            was_ready_at=was_ready_at,
        )


loader_service = LoaderService()
