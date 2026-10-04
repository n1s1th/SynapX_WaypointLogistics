"""Loader endpoints.

Scope: L2 (loaders and sign-in sessions), L3 (queue and summary), L4
(checklist read, and check / uncheck / recheck), L5 (flag an issue, the issue
list), L6 (release and undo), L7 (acknowledge a plan change, unload a take-off
order), the reads for L8 (decision) and L9 (activity, per-run and depot-wide),
the pick lock, the driver's "Arrived at dock", plus the dev-only simulation
endpoints from L0.

A loader belongs to a depot and sees every dock of it. Tablet reads name the
session in the X-Loader-Session header; tablet writes carry loader_session_id,
and only the loader who picked the run may write to it.

Every backend route here is owned by Sachintha (docs/reference/loader/API_CONTRACT.md).
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.models.loader_activity import CheckAction
from app.models.loader_user import LoaderSession
from app.models.reference import Brand, Depot, Dock
from app.models.shipment import DispatchTrip
from app.models.user import User
from app.schemas import loader as schemas
from app.services.loader_service import FlagRequestError, IncorrectPinError, loader_service

router = APIRouter()


def _catch_up(db: Session) -> None:
    """What would happen on a timer, done on the next read (there is no worker):
    - an overdue issue gets its default option (runs built from a dispatch
      trip only; LoaderService.apply_overdue_defaults);
    - a release whose undo window has closed moves its orders to
      READY_FOR_DISPATCH (LoaderService.finalize_due_releases) and tells the
      driver and the dispatcher (LoaderService.notify_due_releases)."""
    changed = bool(loader_service.apply_overdue_defaults(db))
    changed = bool(loader_service.finalize_due_releases(db)) or changed
    changed = bool(loader_service.notify_due_releases(db)) or changed
    if changed:
        db.commit()


def tablet_session(
    x_loader_session: int = Header(..., alias="X-Loader-Session", description="The tablet's loader session id"),
    db: Session = Depends(deps.get_db),
) -> LoaderSession:
    """The signed-in loader for a tablet read: 404 unknown, 403 ended or no
    depot. Marks the session seen, which keeps its picked run locked."""
    return loader_service.open_session(db, x_loader_session)


def _depot_dock(db: Session, session: LoaderSession, dock: Optional[str]) -> Optional[Dock]:
    """The ?dock= filter: a dock of the loader's depot, else 404."""
    if dock is None:
        return None
    found = loader_service.resolve_dock(db, dock)
    if found.depot != loader_service.loader_depot(session.loader_user):
        raise NotFoundError(f"Dock '{dock}' not found.", entity="Dock", entity_id=dock)
    return found


DOCK_FILTER = Query(None, description="Only this dock of the depot: 3, DOCK3 or 'Dock 3'")


# ---------------------------------------------------------------------------
# L2 sign-in: loaders and sessions
# ---------------------------------------------------------------------------


@router.get("/users", response_model=List[schemas.LoaderUserRead])
def list_users(
    depot: Depot = Query(..., description="The depot being signed into: peliyagoda or kandy"),
    q: str | None = Query(None, description="Match the full or short name, case-insensitive"),
    db: Session = Depends(deps.get_db),
):
    """Active loaders of one depot for the sign-in tiles, by full name. No PINs."""
    return loader_service.list_users(db, depot, q)


@router.post("/session", response_model=schemas.LoaderSessionRead)
def start_session(
    payload: schemas.SessionRequest,
    db: Session = Depends(deps.get_db),
    token: Optional[str] = Depends(deps.reusable_oauth2),
):
    """Sign a loader in with their Keycloak token (Authorization: Bearer): 200
    with the session. The account's loader record is found by its full name
    and created on the first sign-in (LoaderService.loader_for_account).
    403 NOT_A_LOADER / LOADER_INACTIVE / LOADER_NO_DEPOT / LOADER_OTHER_DEPOT,
    409 LOADER_ACCOUNT_AMBIGUOUS, 404 for a tablet label that is not registered.

    Without a token, name + PIN (loader_user_id, pin) works only when
    settings.LOADER_PIN_SIGN_IN is on (tests, local demos); a wrong PIN is 401.
    """
    if token:
        user = deps.get_current_user(db=db, token=token)
        session = loader_service.start_account_session(db, user, payload)
    elif settings.LOADER_PIN_SIGN_IN and payload.loader_user_id is not None:
        try:
            session = loader_service.start_session(db, payload)
        except IncorrectPinError as exc:
            raise HTTPException(
                status_code=401, detail={"code": "AUTHORIZATION_FAILED", "message": exc.message}
            )
    else:
        raise HTTPException(
            status_code=401, detail={"code": "NOT_AUTHENTICATED", "message": "Sign in with your Waypoint account."}
        )
    db.commit()
    return loader_service.session_read(session)


@router.delete("/session/{session_id}", response_model=schemas.LoaderSessionRead)
def end_session(
    session_id: int, payload: schemas.EndSessionRequest, db: Session = Depends(deps.get_db)
):
    """End a session (idle_timeout, switch_user or sign_out). Lifts the pick
    lock on any run it held. Ending it again returns it unchanged; offline
    sign-outs are replayed."""
    session = loader_service.end_session(db, session_id, payload)
    db.commit()
    return loader_service.session_read(session)


# ---------------------------------------------------------------------------
# L3 queue and summary
# ---------------------------------------------------------------------------


@router.get("/docks", response_model=List[schemas.DockRead])
def list_docks(
    depot: Depot = Query(..., description="peliyagoda or kandy"),
    db: Session = Depends(deps.get_db),
):
    """A depot's docks, by code: the dispatcher's dock picker and the tablet."""
    return loader_service.list_docks(db, depot)


@router.get("/runs", response_model=schemas.RunQueueRead)
def get_queue(
    dock: str | None = DOCK_FILTER,
    brand: Brand | None = Query(None, description="Only this brand's runs"),
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """The depot's loading queue: every dock, each with the runs whose truck
    has arrived, by arrival. Runs still awaiting their truck are hidden."""
    _catch_up(db)
    queue = loader_service.build_queue(db, session, _depot_dock(db, session, dock), brand)
    db.commit()
    return queue


@router.get("/summary", response_model=schemas.QueueSummaryRead)
def get_summary(
    dock: str | None = DOCK_FILTER,
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """The queue's metric cards, counted from the same runs as GET /loader/runs."""
    _catch_up(db)
    summary = loader_service.build_summary(db, session, _depot_dock(db, session, dock))
    db.commit()
    return summary


@router.get("/runs/{code}", response_model=schemas.RunDetailRead)
def get_run(
    code: str,
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """The loading checklist for one run, stops in load order (deepest first).
    404 for another depot's run or one whose truck has not arrived; 409
    RUN_PICKED_BY_OTHER while another loader holds it."""
    _catch_up(db)
    run = loader_service.loader_run(db, code, session)
    loader_service.require_open(db, run, session)
    detail = loader_service.build_run_detail(db, run)
    db.commit()
    return detail


@router.post("/runs/{code}/pick", response_model=schemas.RunDetailRead)
def pick_run(code: str, payload: schemas.PickRequest, db: Session = Depends(deps.get_db)):
    """Take the run: only this loader can open, tick, flag or release it
    while their session is live (open, seen in the last 11 minutes). 409
    RUN_PICKED_BY_OTHER while someone else holds it. Needs a connection."""
    run = loader_service.pick_run(db, code, payload.loader_session_id)
    db.commit()
    return loader_service.build_run_detail(db, run)


@router.post("/runs/{code}/unpick", response_model=schemas.RunDetailRead)
def unpick_run(code: str, payload: schemas.PickRequest, db: Session = Depends(deps.get_db)):
    """Put the run back for any loader to pick. A no-op on a free run."""
    run = loader_service.unpick_run(db, code, payload.loader_session_id)
    db.commit()
    return loader_service.build_run_detail(db, run)


@router.get("/runs/{code}/activity", response_model=List[schemas.RunActivityEventRead])
def get_run_activity(
    code: str,
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """One run's activity log, NEWEST first - the Log tab (L9).

    The checklist's Change log card reverses it to read oldest first.
    For the depot-wide feed, see GET /loader/activity.
    """
    run = loader_service.loader_run(db, code, session)
    events = loader_service.list_activity(db, run)
    db.commit()
    return events


@router.get("/activity", response_model=List[schemas.ActivityRead])
def get_dock_activity(
    dock: str | None = DOCK_FILTER,
    run_code: str | None = Query(None, description="Narrow the feed to one run"),
    limit: int = Query(100, ge=1, le=500),
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """Everything that happened at the depot's docks, NEWEST first - the Log tab.

    Deliberately the opposite order to the per-run timeline: this is a feed, and
    a loader returning to the Log tab wants the most recent entry at the top,
    across every run.
    """
    feed = loader_service.list_dock_activity(
        db, session, _depot_dock(db, session, dock), run_code=run_code, limit=limit
    )
    db.commit()
    return feed


# ---------------------------------------------------------------------------
# L4 writes - check, uncheck and re-check one checklist row
#
# Every body carries client_action_id (a replay returns the run with 200 and
# applies nothing) and plan_version (a stale one is refused with 409
# PLAN_VERSION_STALE). A replay answers with the run's CURRENT state: the
# original response is not stored. Uncheck is DELETE on the check resource,
# with a JSON body, because that is what the tablet's offline outbox sends.
# ---------------------------------------------------------------------------

ORDER_PATH = "/runs/{code}/orders/{order_number}"


def _order_action(
    db: Session,
    code: str,
    order_number: str,
    action: CheckAction,
    payload: schemas.OrderActionRequest,
) -> schemas.RunDetailRead:
    run = loader_service.apply_order_action(db, code, order_number, action, payload)
    db.commit()
    return loader_service.build_run_detail(db, run)


@router.post(f"{ORDER_PATH}/check", response_model=schemas.RunDetailRead)
def check_order(
    code: str,
    order_number: str,
    payload: schemas.OrderActionRequest,
    db: Session = Depends(deps.get_db),
):
    """Tick an order as loaded (to_load, new or re_check -> loaded)."""
    return _order_action(db, code, order_number, CheckAction.CHECK, payload)


@router.delete(f"{ORDER_PATH}/check", response_model=schemas.RunDetailRead)
def uncheck_order(
    code: str,
    order_number: str,
    payload: schemas.OrderActionRequest,
    db: Session = Depends(deps.get_db),
):
    """Untick an order (loaded -> to_load, or -> new if this plan added it)."""
    return _order_action(db, code, order_number, CheckAction.UNCHECK, payload)


@router.post(f"{ORDER_PATH}/recheck", response_model=schemas.RunDetailRead)
def recheck_order(
    code: str,
    order_number: str,
    payload: schemas.OrderActionRequest,
    db: Session = Depends(deps.get_db),
):
    """Confirm an order a plan change put back to re_check (re_check -> loaded)."""
    return _order_action(db, code, order_number, CheckAction.RECHECK, payload)


# ---------------------------------------------------------------------------
# L7 writes - acknowledge a plan change, unload a take-off order
# ---------------------------------------------------------------------------


@router.post(f"{ORDER_PATH}/unload", response_model=schemas.RunDetailRead)
def unload_order(
    code: str,
    order_number: str,
    payload: schemas.OrderActionRequest,
    db: Session = Depends(deps.get_db),
):
    """The loader took a plan-removed order back off the truck (take_off -> moved).

    Same body, replay and stale-plan rules as check.
    """
    return _order_action(db, code, order_number, CheckAction.UNLOAD, payload)


@router.post("/runs/{code}/plan/{version}/acknowledge", response_model=schemas.RunDetailRead)
def acknowledge_plan(
    code: str,
    version: int,
    payload: schemas.AcknowledgePlanRequest,
    db: Session = Depends(deps.get_db),
):
    """The loader has read the plan-change diff; unblocks the checklist.

    Acknowledging the latest version also acknowledges any unread version
    before it, so stacked changes are confirmed once.
    """
    if payload.plan_version != version:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PLAN_VERSION_MISMATCH",
                "message": f"Body plan_version {payload.plan_version} does not match v{version} in the path.",
            },
        )
    run = loader_service.acknowledge_plan(db, code, version, payload)
    db.commit()
    return loader_service.build_run_detail(db, run)


# ---------------------------------------------------------------------------
# L5 flags and L6 release - tablet writes, same contract as the L4 writes
# (client_action_id replay first, then 409 PLAN_VERSION_STALE)
# ---------------------------------------------------------------------------


@router.post("/issues", response_model=schemas.IssueDetailRead)
def flag_issue(payload: schemas.FlagIssueRequest, db: Session = Depends(deps.get_db)):
    """Flag an order (missing, short, damaged, won't fit) and send it to the
    Dispatcher. Returns the issue; a replay returns the one already filed."""
    try:
        issue = loader_service.flag_issue(db, payload)
    except FlagRequestError as exc:
        raise HTTPException(status_code=422, detail={"code": "INVALID_FLAG", "message": exc.message})
    from app.email.service import queue_loader_issue
    queue_loader_issue(db, issue)
    db.commit()
    return loader_service.build_issue_detail(db, issue)


# A flag photo: JPEG, PNG or WebP up to 5 MB. The tablet shrinks it first
# (longest side 1600 px), so a real one is a few hundred KB.
FLAG_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
FLAG_PHOTO_MAX_BYTES = 5 * 1024 * 1024


@router.post("/issues/by-action/{client_action_id}/photo", response_model=schemas.IssueDetailRead)
async def upload_issue_photo(
    client_action_id: UUID, file: UploadFile = File(...), db: Session = Depends(deps.get_db)
):
    """Attach a photo to a flag, found by the flag's client_action_id (known
    to the tablet before the flag syncs). 404 until the flag is on the server;
    413 over 5 MB; 415 for anything but JPEG, PNG or WebP. A flag that already
    has a photo keeps it and is returned unchanged."""
    if file.content_type not in FLAG_PHOTO_TYPES:
        raise HTTPException(
            status_code=415,
            detail={"code": "UNSUPPORTED_PHOTO_TYPE", "message": "Send a JPEG, PNG or WebP photo."},
        )
    contents = await file.read(FLAG_PHOTO_MAX_BYTES + 1)
    if len(contents) > FLAG_PHOTO_MAX_BYTES:
        raise HTTPException(
            status_code=413, detail={"code": "PHOTO_TOO_LARGE", "message": "The photo is over 5 MB."}
        )
    issue = loader_service.attach_issue_photo(db, str(client_action_id), contents, file.content_type)
    db.commit()
    return loader_service.build_issue_detail(db, issue)


@router.get("/issues", response_model=List[schemas.IssueDetailRead])
def list_issues(
    dock: str | None = DOCK_FILTER,
    run: str | None = Query(None, description="Only this run's issues"),
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """The Issues tab: every issue on the depot's runs, newest first."""
    _catch_up(db)
    issues = loader_service.list_issues(db, session, _depot_dock(db, session, dock), run)
    details = [loader_service.build_issue_detail(db, issue) for issue in issues]
    db.commit()
    return details


@router.post("/runs/{code}/release", response_model=schemas.RunDetailRead)
def release_run(code: str, payload: schemas.ReleaseRequest, db: Session = Depends(deps.get_db)):
    """Mark ready to depart. 409 RELEASE_LOCKED, with the blockers, while
    anything still blocks it; a run already ready is returned unchanged."""
    run = loader_service.release_run(db, code, payload)
    db.commit()
    return loader_service.build_run_detail(db, run)


@router.post("/runs/{code}/release/undo", response_model=schemas.RunDetailRead)
def undo_release(code: str, payload: schemas.ReleaseRequest, db: Session = Depends(deps.get_db)):
    """Undo within 10 s of the release (2 s grace); after that 409
    UNDO_WINDOW_EXPIRED."""
    run = loader_service.undo_release(db, code, payload)
    db.commit()
    return loader_service.build_run_detail(db, run)


@router.get("/issues/{issue_id}", response_model=schemas.IssueDetailRead)
def get_issue(
    issue_id: int,
    session: LoaderSession = Depends(tablet_session),
    db: Session = Depends(deps.get_db),
):
    """One flagged issue with the options the dispatcher had. 404 for an
    issue at another depot."""
    _catch_up(db)
    issue = loader_service.get_issue(db, issue_id)
    if loader_service.run_depot(issue.run) != loader_service.loader_depot(session.loader_user):
        raise NotFoundError(f"Issue '{issue_id}' not found.", entity="LoaderIssue", entity_id=issue_id)
    detail = loader_service.build_issue_detail(db, issue)
    db.commit()
    return detail


# ---------------------------------------------------------------------------
# Integration slice 1: dispatch trips (docs/reference/loader/INTEGRATION_DESIGN.md)
#
# The dispatcher's own from-allocation endpoint should call
# loader_service.create_run_for_dispatch_trip inside its transaction; these
# two are for backfilling a trip dispatched before that, and for the
# dispatcher frontend to read one trip's loading state directly.
# ---------------------------------------------------------------------------


def _dispatch_trip(db: Session, trip_id: int) -> DispatchTrip:
    trip = db.get(DispatchTrip, trip_id)
    if trip is None:
        raise NotFoundError(f"Dispatch trip {trip_id} not found.", entity="DispatchTrip", entity_id=trip_id)
    return trip


@router.post("/dispatch-trips/{trip_id}/run", response_model=schemas.DispatchTripRunRead)
def create_run_for_dispatch_trip(
    trip_id: int,
    response: Response,
    dock: Optional[str] = Query(None, description="Dock code; default is the first dock at the vehicle's depot"),
    db: Session = Depends(deps.get_db),
):
    """Build the loader run (plan v1) for a dispatch trip. Idempotent: 201 when
    built now, 200 with the same run when it already existed."""
    trip = _dispatch_trip(db, trip_id)
    existed = loader_service.run_for_dispatch_trip(db, trip.id) is not None
    run = loader_service.create_run_for_dispatch_trip(db, trip, dock_code=dock)
    db.commit()
    response.status_code = 200 if existed else 201
    return schemas.DispatchTripRunRead(
        dispatch_trip_id=trip.id,
        run_code=run.code,
        created=not existed,
        loading=loader_service.dispatcher_view(db, [trip.id])[trip.id],
    )


@router.post("/dispatch-trips/{trip_id}/arrived", response_model=schemas.ArrivedRead)
def truck_arrived(
    trip_id: int,
    payload: schemas.ArrivedRequest,
    db: Session = Depends(deps.get_db),
    driver: User = Depends(deps.require_driver),
):
    """The driver is at the dock ("Arrived at dock"). Only marks the truck as
    arrived (time + dock) and makes the run visible in the loader queue; the
    run's orders came from the dispatcher. Idempotent, first arrival wins.
    A different dock at the same depot moves the run there; another depot's
    dock is 422 DOCK_NOT_AT_DEPOT; anyone but the trip's driver 403; 404
    when the trip has no loader run yet."""
    trip = _dispatch_trip(db, trip_id)
    run, replayed = loader_service.mark_arrived(db, trip, driver, payload.dock_code, payload.arrived_at)
    db.commit()
    return schemas.ArrivedRead(
        dispatch_trip_id=trip.id,
        run_code=run.code,
        dock=run.dock.name,
        dock_code=run.dock.code,
        arrived_at=run.arrived_at,
        stage=loader_service.stage(run),
        replayed=replayed,
    )


@router.post("/dispatch-trips/{trip_id}/dock", response_model=schemas.DispatcherLoadingRead)
def change_dock(
    trip_id: int,
    payload: schemas.DockChangeRequest,
    db: Session = Depends(deps.get_db),
    depot_scope: Depot = Depends(deps.get_dispatcher_depot),
):
    """The dispatcher sends the run to another dock of its depot. Only before
    the truck arrives: 409 TRUCK_ALREADY_ARRIVED after. 422 DOCK_NOT_AT_DEPOT
    for another depot's dock; 404 for another depot's trip."""
    trip = _dispatch_trip(db, trip_id)
    run = loader_service.require_run_for_dispatch_trip(db, trip.id)
    if loader_service.run_depot(run) != depot_scope:
        raise NotFoundError(f"Dispatch trip {trip_id} not found.", entity="DispatchTrip", entity_id=trip_id)
    loader_service.change_dock(db, trip, payload.dock_code)
    db.commit()
    return loader_service.dispatcher_view(db, [trip.id])[trip.id]


@router.get("/dispatch-trips/{trip_id}/loading", response_model=schemas.DispatcherLoadingRead)
def get_dispatch_trip_loading(trip_id: int, db: Session = Depends(deps.get_db)):
    """The dock's side of one dispatch trip; 404 when no loader run is built for it."""
    _catch_up(db)
    trip = _dispatch_trip(db, trip_id)
    view = loader_service.dispatcher_view(db, [trip.id]).get(trip.id)
    if view is None:
        raise NotFoundError(
            f"No loader run for dispatch trip {trip_id}.", entity="DeliveryRun", entity_id=trip_id
        )
    return view


@router.post("/dispatch-trips/{trip_id}/plan", response_model=schemas.DispatcherPlanResult)
def change_plan(
    trip_id: int, payload: schemas.DispatcherPlanRequest, db: Session = Depends(deps.get_db)
):
    """The dispatcher changes the plan: stop order, orders added / removed /
    moved / deferred, departure time. Publishes the next plan version (the
    tablet shows the L7 plan-change screen); a Ready run reopens. 409
    PLAN_LOCKED after gate-out, 409 PLAN_VERSION_STALE when base_version is
    behind, 422 PLAN_CHANGE_INVALID with the reasons."""
    trip = _dispatch_trip(db, trip_id)
    run = loader_service.require_run_for_dispatch_trip(db, trip.id)
    with db.begin_nested():
        revision, replayed = loader_service.publish_dispatcher_plan(db, run, payload)
        if not replayed and (trip.route_plan or payload.stop_order or payload.departs_at):
            from app.services.dispatch_route_planning import (
                current_stop_codes, persist_trip_route, require_feasible, route_for_trip,
            )
            trip.departure_time = run.departs_at
            route = route_for_trip(db, trip, order=current_stop_codes(db, trip))
            require_feasible(route)
            persist_trip_route(db, trip, route)
    db.commit()
    changes = revision.changes if revision is not None else []
    return schemas.DispatcherPlanResult(
        dispatch_trip_id=trip_id,
        run_code=run.code,
        plan_version=run.current_plan_version,
        published=revision is not None,
        replayed=replayed,
        run_status=run.status,
        departs_at=run.departs_at,
        changes=[
            schemas.PlanChangeRead(
                change_kind=change.change_kind,
                order_number=change.order.order_number if change.order else None,
                outlet_code=change.outlet.code if change.outlet else None,
                reason=change.reason,
            )
            for change in sorted(changes, key=lambda c: (c.position, c.id))
        ],
    )


@router.get("/dispatch-trips/{trip_id}/handoff", response_model=schemas.HandoffRead)
def get_handoff(trip_id: int, db: Session = Depends(deps.get_db)):
    """For the driver: the released run's stops in delivery order, each order's
    loaded vs ordered units and any decided shortfall. 409 RUN_NOT_RELEASED
    until the loader has released it."""
    _catch_up(db)
    run = loader_service.require_run_for_dispatch_trip(db, _dispatch_trip(db, trip_id).id)
    return loader_service.handoff(db, run)


@router.post("/dispatch-trips/{trip_id}/gate-out", response_model=schemas.GateOutRead)
def gate_out(trip_id: int, payload: schemas.GateOutRequest, db: Session = Depends(deps.get_db)):
    """The truck leaves the depot: ready_to_depart -> gated_out. Locks release,
    undo and plan changes. 409 RUN_NOT_RELEASED before release; a run already
    gated out is returned unchanged."""
    run = loader_service.require_run_for_dispatch_trip(db, _dispatch_trip(db, trip_id).id)
    run, replayed = loader_service.gate_out(db, run, payload)
    db.commit()
    return schemas.GateOutRead(
        dispatch_trip_id=trip_id,
        run_code=run.code,
        status=run.status,
        gated_out_at=run.gated_out_at,
        replayed=replayed,
    )


@router.post("/issues/{issue_id}/decision", response_model=schemas.IssueDetailRead)
def decide_issue(
    issue_id: int, payload: schemas.IssueDecisionRequest, db: Session = Depends(deps.get_db)
):
    """The dispatcher's decision on a flag (L8). option = the option id or its
    label. Lifts the release lock once nothing else waits. Repeating the same
    decision returns the issue unchanged; another option on a decided issue is
    409 ISSUE_ALREADY_DECIDED; an unknown option 422 INVALID_OPTION."""
    issue = loader_service.get_issue(db, issue_id)
    issue, _ = loader_service.decide_issue(db, issue, payload)
    db.commit()
    return loader_service.build_issue_detail(db, issue)


# ---------------------------------------------------------------------------
# Dev-only simulation
#
# There is no dispatcher UI yet, so these stand in for the dispatcher acting on a
# run. The sub-router is only mounted when LOADER_DEV_ENDPOINTS is on and the
# environment is not production - not merely guarded inside the handlers - so in
# production the paths 404 and never appear in the OpenAPI schema at all.
# ---------------------------------------------------------------------------

dev_router = APIRouter(prefix="/dev", tags=["Loader · dev only"])

# The Figma v2 -> v3 change on RUN-021 (frames 2a, T2a), used when the request
# body is empty. The design has ORD0092308 loaded deepest by then; the seed's
# t0 does not (it matches the 1c capacity bars), so check ORD0092308 first to
# get the unload - otherwise it is, correctly, a don't-load.
# moved_to / deferred_to (VEH003 · Trip 1 · 03:45, Fri 29 May) join this once
# plan_revision_changes can store them (migration fix).
FIGMA_PLAN_CHANGE = schemas.SimulatedPlanChangeRequest(
    unload_order_numbers=["ORD0092308"],
    dont_load_order_numbers=["ORD0092304"],
    load_new_order_numbers=["ORD0092319"],
    recheck_order_numbers=["ORD0092305", "ORD0092306"],
    reasons={
        "ORD0092308": (
            "Store reported a cold-room fault at 02:05. Already loaded, deepest. "
            "Move ORD0092305 and ORD0092306 to reach it, then return it to the chiller dock."
        ),
        "ORD0092304": "Not loaded yet. Leave it in staging; VEH003's loader already has it on their list.",
        "ORD0092319": (
            "OUT028 was deferred yesterday and must go today. It loads last, by the door, "
            "so nothing already loaded has to move."
        ),
    },
    summary="Cold-room fault at OUT027; OUT028 must go tonight.",
)


@dev_router.post("/runs/{code}/plan-change", response_model=schemas.SimulationResult)
def simulate_plan_change(
    code: str,
    payload: schemas.SimulatedPlanChangeRequest | None = None,
    db: Session = Depends(deps.get_db),
):
    """Publish the next plan version, as the dispatcher would.

    With no body this reproduces the Figma v2 -> v3 change exactly.
    """
    run = loader_service.get_run(db, code)
    if payload is None or not any(
        [
            payload.unload_order_numbers,
            payload.dont_load_order_numbers,
            payload.load_new_order_numbers,
        ]
    ):
        payload = FIGMA_PLAN_CHANGE

    revision = loader_service.simulate_plan_change(db, run, payload)
    db.commit()
    return schemas.SimulationResult(
        detail=f"Published plan v{revision.version} for {run.code}.",
        run_code=run.code,
        plan_version=revision.version,
        changes=[
            schemas.PlanChangeRead(
                change_kind=change.change_kind,
                order_number=change.order.order_number if change.order else None,
                outlet_code=change.outlet.code if change.outlet else None,
                reason=change.reason,
            )
            for change in revision.changes
        ],
    )


@dev_router.post("/issues/{issue_id}/decide", response_model=schemas.SimulationResult)
def simulate_decision(
    issue_id: int,
    payload: schemas.SimulatedDecisionRequest | None = None,
    db: Session = Depends(deps.get_db),
):
    """Apply a dispatcher decision. With no option named, the default is used."""
    issue = loader_service.get_issue(db, issue_id)
    issue = loader_service.simulate_decision(
        db, issue, payload or schemas.SimulatedDecisionRequest()
    )
    db.commit()
    chosen = next((o.label for o in issue.options if o.is_chosen), None)
    return schemas.SimulationResult(
        detail=f"Dispatcher decided: {chosen}.",
        run_code=issue.run.code,
        issue_id=issue.id,
    )


@dev_router.post("/issues/{issue_id}/expire", response_model=schemas.SimulationResult)
def simulate_decision_timeout(issue_id: int, db: Session = Depends(deps.get_db)):
    """Let decide-by pass so the pre-agreed default is applied instead."""
    issue = loader_service.get_issue(db, issue_id)
    issue = loader_service.simulate_decision_timeout(db, issue)
    db.commit()
    chosen = next((o.label for o in issue.options if o.is_chosen), None)
    return schemas.SimulationResult(
        detail=f"Decide-by passed; applied default: {chosen}.",
        run_code=issue.run.code,
        issue_id=issue.id,
    )


if settings.LOADER_DEV_ENDPOINTS and settings.ENVIRONMENT != "production":
    router.include_router(dev_router)
