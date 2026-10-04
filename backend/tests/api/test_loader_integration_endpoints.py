"""Loader-side integration endpoints: dispatcher plan change, dispatcher
decision (with the decide-by default), driver hand-off and gate-out
(docs/loader/INTEGRATION_DESIGN.md, sections 8 and 9)."""
from datetime import datetime, timedelta, time
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.delivery_run import RunOrderState, RunStatus, RunStop
from app.models.loader_activity import LoaderActivity
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssueOption
from app.models.order import OrderStatus
from app.models.plan_revision import PlanRevision
from app.models.reference import Brand
from app.services.loader_service import LoaderService
from tests.conftest_loader import (  # noqa: F401  (loader_client, trip_setup are fixtures)
    at,
    loader_client,
    make_issue,
    make_loader,
    make_order,
    make_outlet,
    make_revision,
    make_run,
    make_run_order,
    make_stop,
    make_trip,
    trip_setup,
)

BASE = "/api/v1/loader"


def built(setup, **trip_kwargs):
    """A trip with its loader run, plan v1 acknowledged so the dock can work it."""
    db = setup["db"]
    trip = make_trip(db, setup["vehicle"], setup["orders"], **trip_kwargs)
    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    revision = LoaderService.get_revision(db, run, 1)
    revision.acknowledged_at = at("01:00")
    db.flush()
    return trip, run


def rows(db, run):
    stops = db.execute(
        select(RunStop).filter_by(run_id=run.id, plan_version=run.current_plan_version)
    ).scalars()
    return {r.order.order_number: r for s in stops for r in s.orders}


def load(db, run, *numbers):
    for number, row in rows(db, run).items():
        if not numbers or number in numbers:
            row.state = RunOrderState.LOADED
            row.checked_at = at("01:30")
    for stop in run.stops:
        LoaderService.refresh_stop_status(stop)
    LoaderService.recalculate_capacity(db, run)
    db.flush()


def release(db, run, loader=None):
    run.status = RunStatus.READY_TO_DEPART
    run.released_at = at("02:50")
    run.released_by_id = loader.id if loader else None
    db.flush()


def events(db, run, event_type):
    return db.execute(
        select(LoaderActivity).filter_by(run_id=run.id, event_type=event_type)
    ).scalars().all()


def plan(client, trip, **body):
    body.setdefault("client_action_id", str(uuid4()))
    body.setdefault("base_version", 1)
    return client.post(f"{BASE}/dispatch-trips/{trip.id}/plan", json=body)


# --- POST /dispatch-trips/{id}/plan ----------------------------------------------


def test_a_plan_change_publishes_the_next_version(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    extra = make_order(db, "ORD1005", make_outlet(db, "OUT031"), units=4, kg=40.0, m3=0.3)

    response = plan(
        loader_client, trip,
        remove=[{"order_number": "ORD1003", "reason": "Store closed for stock-take"}],
        defer=[{"order_number": "ORD1004", "reason": "Vehicle full", "deferred_to": "2026-05-29"}],
        add=[{"order_number": "ORD1005", "reason": "Must go tonight"}],
        summary="Stock-take at OUT030; OUT031 must go tonight.",
        dispatcher="Kasun P.",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert (body["plan_version"], body["published"], body["replayed"]) == (2, True, False)
    assert {(c["change_kind"], c["order_number"]) for c in body["changes"]} == {
        ("dont_load", "ORD1003"), ("dont_load", "ORD1004"), ("load_new", "ORD1005"),
    }
    assert {c["order_number"]: c["reason"] for c in body["changes"]}["ORD1003"] == "Store closed for stock-take"

    # The tablet gets the L7 plan-change screen: v2 waits for acknowledgement.
    detail = loader_client.get(f"{BASE}/runs/{run.code}").json()
    assert detail["unacknowledged_plan_version"] == 2
    assert detail["plan_change"]["summary"] == "Stock-take at OUT030; OUT031 must go tonight."
    new_stop = next(s for s in detail["stops"] if s["outlet"]["code"] == "OUT031")
    assert new_stop["stop_sequence"] == 1  # a new stop goes first, loads last
    assert extra.id in {r.order_id for r in rows(db, run).values()}
    assert events(db, run, "plan_published")[-1].actor_label == "Kasun P."


def test_a_ready_run_reopens(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    load(db, run)
    release(db, run)

    response = plan(loader_client, trip, remove=[{"order_number": "ORD1003"}])

    assert response.status_code == 200
    assert response.json()["run_status"] == "loading"
    assert rows(db, run)["ORD1003"].state == RunOrderState.TAKE_OFF
    assert events(db, run, "load_reopened")


def test_after_gate_out_the_plan_is_locked(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    run.status = RunStatus.GATED_OUT
    db.flush()

    response = plan(loader_client, trip, remove=[{"order_number": "ORD1003"}])

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PLAN_LOCKED"
    assert run.current_plan_version == 1


def test_a_retry_is_a_replay_and_a_stale_change_is_409(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    body = {"client_action_id": str(uuid4()), "base_version": 1,
            "remove": [{"order_number": "ORD1003"}]}

    first = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/plan", json=body)
    again = loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/plan", json=body)
    other = plan(loader_client, trip, base_version=1, remove=[{"order_number": "ORD1001"}])

    assert first.json()["plan_version"] == 2
    assert again.status_code == 200
    assert (again.json()["plan_version"], again.json()["replayed"]) == (2, True)
    assert len(db.execute(select(PlanRevision).filter_by(run_id=run.id)).scalars().all()) == 2
    assert other.status_code == 409
    assert other.json()["detail"]["code"] == "PLAN_VERSION_STALE"


@pytest.mark.parametrize("body, code", [
    ({"remove": [{"order_number": "ORD9999"}]}, "ORDER_NOT_ON_RUN"),
    ({"add": [{"order_number": "ORD9999"}]}, "ORDER_NOT_FOUND"),
    ({"stop_order": ["OUT999"]}, "UNKNOWN_STOP"),
    ({}, "EMPTY_CHANGE"),
    ({"remove": [{"order_number": "ORD1003"}], "defer": [{"order_number": "ORD1003"}]}, "DUPLICATE_ORDER"),
])
def test_a_change_that_cannot_apply_is_422(loader_client, trip_setup, body, code):
    trip, run = built(trip_setup)

    response = plan(loader_client, trip, **body)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "PLAN_CHANGE_INVALID"
    assert code in {v["code"] for v in detail["violations"]}
    assert run.current_plan_version == 1


def test_an_order_of_another_brand_or_on_another_run_is_refused(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    tech = make_order(db, "ORD1006", make_outlet(db, "OUT040", brand=Brand.TECH))
    busy = make_order(db, "ORD1007", make_outlet(db, "OUT041"))
    other = make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="LDR-RUN-1002", plan_version=1)
    make_run_order(db, make_stop(db, other, 1, 1, busy.outlet, plan_version=1), busy, plan_version=1)

    wrong_brand = plan(loader_client, trip, add=[{"order_number": tech.order_number}])
    taken = plan(loader_client, trip, add=[{"order_number": busy.order_number}])

    assert wrong_brand.status_code == 422
    assert wrong_brand.json()["detail"]["violations"][0]["code"] == "BRAND_MISMATCH"
    assert taken.status_code == 409
    assert taken.json()["detail"]["code"] == "ORDER_ON_ANOTHER_RUN"
    assert taken.json()["detail"]["orders"] == [{"order_number": "ORD1007", "run_code": "LDR-RUN-1002"}]


def test_a_new_stop_order_resequences_and_rechecks_the_load(loader_client, trip_setup):
    db = trip_setup["db"]
    for order in trip_setup["orders"]:
        order.outlet.window_end = time(18)  # Fixture departure is UTC, windows are Colombo.
    trip, run = built(trip_setup)  # v1: OUT027, OUT026, OUT030 (by window, then code)
    load(db, run, "ORD1001")

    response = plan(loader_client, trip, stop_order=["OUT030", "OUT026"])

    assert response.status_code == 200
    detail = loader_client.get(f"{BASE}/runs/{run.code}").json()
    by_outlet = {s["outlet"]["code"]: s for s in detail["stops"]}
    assert [by_outlet[c]["stop_sequence"] for c in ("OUT030", "OUT026", "OUT027")] == [1, 2, 3]
    assert by_outlet["OUT027"]["note"] == "was Stop 1"
    assert rows(db, run)["ORD1001"].state == RunOrderState.RE_CHECK


def test_taking_an_order_off_rechecks_only_what_is_in_the_way(trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    # Load positions: OUT030 1 (deepest), OUT026 2, OUT027 3 (door).
    load(db, run)
    payload = {"client_action_id": uuid4(), "base_version": 1, "remove": [{"order_number": "ORD1001"}]}
    from app.schemas.loader import DispatcherPlanRequest

    LoaderService.publish_dispatcher_plan(db, run, DispatcherPlanRequest(**payload))

    states = {n: r.state for n, r in rows(db, run).items()}
    assert states["ORD1001"] == RunOrderState.TAKE_OFF
    assert states["ORD1002"] == RunOrderState.RE_CHECK  # OUT027, nearer the door
    assert states["ORD1003"] == RunOrderState.LOADED  # OUT030, deeper: untouched
    assert states["ORD1004"] == RunOrderState.LOADED  # same stop, not in the way


def test_a_new_departure_time_alone_is_not_a_new_version(loader_client, trip_setup):
    db = trip_setup["db"]
    for order in trip_setup["orders"]:
        order.outlet.window_end = time(18)
    trip, run = built(trip_setup)

    response = plan(loader_client, trip, departs_at="2026-05-28T04:00:00Z")

    assert response.status_code == 200
    body = response.json()
    assert (body["published"], body["plan_version"]) == (False, 1)
    assert body["departs_at"] == "2026-05-28T04:00:00Z"
    assert run.departs_at == at("04:00")
    assert events(db, run, "departure_changed")


def test_moved_to_and_deferred_to_are_read_from_where_the_order_went(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    plan(loader_client, trip,
         move=[{"order_number": "ORD1003", "to_dispatch_trip_id": 999}],
         defer=[{"order_number": "ORD1004"}])
    # The dispatcher puts ORD1003 on another trip; ORD1004 is deferred a day.
    moved = next(o for o in trip_setup["orders"] if o.order_number == "ORD1003")
    deferred = next(o for o in trip_setup["orders"] if o.order_number == "ORD1004")
    deferred.status = OrderStatus.DEFERRED
    deferred.operating_date = "2026-05-29"
    other_trip = make_trip(db, trip_setup["vehicle"], [moved], code="RUN-0025", departs="05:00")
    LoaderService.create_run_for_dispatch_trip(db, other_trip)

    detail = loader_client.get(f"{BASE}/runs/{run.code}").json()
    by_number = {o["order_number"]: o for s in detail["stops"] for o in s["orders"]}
    assert by_number["ORD1003"]["moved_to"] == {
        "run_code": "RUN-0025", "vehicle_code": "VEH014", "trip_number": 2,
        "departs_at": "2026-05-28T05:00:00Z",
    }
    assert by_number["ORD1004"]["deferred_to"] == "2026-05-29"
    assert by_number["ORD1001"]["moved_to"] is None


# --- POST /issues/{id}/decision --------------------------------------------------


# Far ahead, so reads do not apply the default; the timeout tests pass their own.
LATER = datetime(2030, 1, 1, 3, 10)


def flagged(setup, number="ORD1002", issue_type=IssueType.MISSING, affected=8, decide_by=LATER):
    db = setup["db"]
    trip, run = built(setup)
    load(db, run)
    row = rows(db, run)[number]
    row.state = RunOrderState.FLAGGED
    loader = make_loader(db)
    issue = make_issue(db, run, row.order, loader)
    issue.issue_type = issue_type
    issue.units_affected = affected
    issue.decide_by = decide_by
    run.status = RunStatus.ISSUE_FLAGGED
    db.flush()
    return trip, run, issue, loader


def decide(client, issue, option, **body):
    body.setdefault("client_action_id", str(uuid4()))
    return client.post(f"{BASE}/issues/{issue.id}/decision", json={"option": option, **body})


def test_a_decision_resolves_the_issue_and_lifts_the_release_lock(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, _ = flagged(trip_setup)
    hold = next(o for o in issue.options if o.label == "Hold VEH035")
    assert {b["code"] for b in loader_client.get(f"{BASE}/runs/{run.code}").json()["release_blockers"]} == {"issue_waiting"}

    response = decide(loader_client, issue, hold.id, note="Replacement on the 03:00 shuttle",
                      decided_by="Kasun P.")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "decided"
    assert body["decided_by"] == "Kasun P."
    assert [o["is_chosen"] for o in body["options"]] == [False, False, True]
    assert all(o["id"] for o in body["options"])
    assert run.status == RunStatus.LOADING
    assert loader_client.get(f"{BASE}/runs/{run.code}").json()["release_blockers"] == []
    [entry] = events(db, run, "issue_decided")
    assert entry.message == "ORD1002: Hold VEH035 · Replacement on the 03:00 shuttle"
    assert entry.actor_label == "Kasun P."


def test_an_option_may_be_named_by_label_and_send_without_takes_it_off(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, _ = flagged(trip_setup)

    response = decide(loader_client, issue, "send without it")

    assert response.status_code == 200
    assert rows(db, run)["ORD1002"].state == RunOrderState.MOVED


def test_an_unknown_option_is_422(loader_client, trip_setup):
    trip, run, issue, _ = flagged(trip_setup)

    for option in (999999, "Throw it in the river"):
        response = decide(loader_client, issue, option)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "INVALID_OPTION"
    assert issue.status == IssueStatus.SENT


def test_the_same_decision_again_is_a_replay_and_another_is_409(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, _ = flagged(trip_setup)
    hold = next(o for o in issue.options if o.label == "Hold VEH035")

    first = decide(loader_client, issue, hold.id)
    again = decide(loader_client, issue, hold.id)
    other = decide(loader_client, issue, "Send without it")

    assert first.status_code == again.status_code == 200
    assert len(events(db, run, "issue_decided")) == 1
    assert other.status_code == 409
    assert other.json()["detail"]["code"] == "ISSUE_ALREADY_DECIDED"
    assert other.json()["detail"]["chosen_option"] == "Hold VEH035"


def test_a_decision_after_gate_out_is_409(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, _ = flagged(trip_setup)
    run.status = RunStatus.GATED_OUT
    db.flush()

    assert decide(loader_client, issue, "Send without it").status_code == 409


def test_the_default_is_applied_once_decide_by_passes(trip_setup):
    db = trip_setup["db"]
    trip, run, issue, _ = flagged(trip_setup, decide_by=at("03:10"))

    assert LoaderService.apply_overdue_defaults(db, now=at("03:09")) == []
    applied = LoaderService.apply_overdue_defaults(db, now=at("03:11"))

    assert applied == [issue]
    assert issue.status == IssueStatus.DEFAULT_APPLIED
    assert next(o for o in issue.options if o.is_chosen).label == "Send without it"
    assert run.status == RunStatus.LOADING
    assert events(db, run, "issue_default_applied")
    assert LoaderService.apply_overdue_defaults(db, now=at("03:30")) == []


def test_an_overdue_issue_is_defaulted_on_read(loader_client, trip_setup):
    trip, run, issue, _ = flagged(trip_setup, decide_by=at("03:10"))  # 2026-05-28: long past

    body = loader_client.get(f"{BASE}/issues/{issue.id}").json()

    assert body["status"] == "default_applied"
    assert body["decided_by"] == "System (decide-by passed)"


def test_seeded_runs_without_a_trip_are_not_defaulted_on_read(loader_client, trip_setup):
    db = trip_setup["db"]
    loader = make_loader(db)
    seeded = make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="LDR-RUN-1002", plan_version=1)
    order = trip_setup["orders"][0]
    make_run_order(db, make_stop(db, seeded, 1, 1, order.outlet, plan_version=1), order,
                   state=RunOrderState.FLAGGED, plan_version=1)
    issue = make_issue(db, seeded, order, loader)  # decide_by in the past

    body = loader_client.get(f"{BASE}/issues/{issue.id}").json()

    assert body["status"] == "sent"
    # The function itself still works on them when asked to.
    assert LoaderService.apply_overdue_defaults(db, linked_only=False) == [issue]


# --- GET /dispatch-trips/{id}/handoff and POST /gate-out --------------------------


def test_the_handoff_is_409_until_released(loader_client, trip_setup):
    trip, run = built(trip_setup)

    response = loader_client.get(f"{BASE}/dispatch-trips/{trip.id}/handoff")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RUN_NOT_RELEASED"


def test_the_handoff_lists_what_was_loaded(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, loader = flagged(trip_setup, issue_type=IssueType.SHORT, affected=3)
    issue.options.append(LoaderIssueOption(label="Send 5 of 8", is_default=False, is_chosen=False, position=9))
    db.flush()
    decide(loader_client, issue, "Send 5 of 8", decided_by="Kasun P.")
    release(db, run, loader)

    body = loader_client.get(f"{BASE}/dispatch-trips/{trip.id}/handoff").json()

    assert body["run_code"] == "RUN-0024"
    assert body["status"] == "ready_to_depart"
    assert body["released_by"] == {"id": loader.id, "name": "Saman J."}
    assert body["released_at"] == "2026-05-28T02:50:00Z"
    assert body["vehicle_code"] == "VEH014"
    assert [s["outlet_code"] for s in body["stops"]] == ["OUT027", "OUT026", "OUT030"]
    assert [s["stop_sequence"] for s in body["stops"]] == [1, 2, 3]
    out27 = body["stops"][0]["orders"][0]
    assert (out27["order_number"], out27["units_ordered"], out27["loaded_units"]) == ("ORD1002", 8, 5)
    assert out27["temperature_class"] == "chilled"
    assert out27["shortfall"]["decision"] == "Send 5 of 8"
    assert out27["shortfall"]["units_affected"] == 3
    assert out27["shortfall"]["decided_by"] == "Kasun P."
    assert [s["order_number"] for s in body["shortfalls"]] == ["ORD1002"]
    assert (body["units_ordered"], body["units_loaded"]) == (28, 25)


def test_an_order_sent_without_is_only_in_the_shortfalls(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run, issue, loader = flagged(trip_setup)
    decide(loader_client, issue, "Send without it")
    release(db, run, loader)

    body = loader_client.get(f"{BASE}/dispatch-trips/{trip.id}/handoff").json()

    numbers = [o["order_number"] for s in body["stops"] for o in s["orders"]]
    assert "ORD1002" not in numbers
    assert "OUT027" not in [s["outlet_code"] for s in body["stops"]]  # its only order left
    assert body["shortfalls"][0]["order_number"] == "ORD1002"
    assert body["shortfalls"][0]["decision"] == "Send without it"


def test_gate_out_locks_the_run(loader_client, trip_setup):
    db = trip_setup["db"]
    trip, run = built(trip_setup)
    load(db, run)
    gate = f"{BASE}/dispatch-trips/{trip.id}/gate-out"

    early = loader_client.post(gate, json={"client_action_id": str(uuid4())})
    release(db, run)
    first = loader_client.post(gate, json={"client_action_id": str(uuid4()), "by": "Tharindu F."})
    again = loader_client.post(gate, json={"client_action_id": str(uuid4())})

    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "RUN_NOT_RELEASED"
    assert first.status_code == 200
    assert (first.json()["status"], first.json()["replayed"]) == ("gated_out", False)
    assert again.json()["replayed"] is True
    assert again.json()["gated_out_at"] == first.json()["gated_out_at"]
    assert run.gated_out_at is not None
    assert events(db, run, "gated_out")[0].message == "Gated out · Tharindu F."

    # Release, undo and plan changes are locked; the hand-off still reads.
    session = {"client_action_id": str(uuid4()), "plan_version": 1}
    assert loader_client.post(f"{BASE}/runs/{run.code}/release", json=session).status_code == 409
    session["client_action_id"] = str(uuid4())
    assert loader_client.post(f"{BASE}/runs/{run.code}/release/undo", json=session).status_code == 409
    assert plan(loader_client, trip, remove=[{"order_number": "ORD1003"}]).json()["detail"]["code"] == "PLAN_LOCKED"
    assert loader_client.get(f"{BASE}/dispatch-trips/{trip.id}/handoff").json()["status"] == "gated_out"
    # Off the dock's queue.
    queue = loader_client.get(f"{BASE}/runs", params={"dock": "DOCK3"}).json()
    assert run.code not in [r["code"] for g in queue["groups"] for r in g["runs"]]


def test_trips_without_a_loader_run_are_404(loader_client, trip_setup):
    db = trip_setup["db"]
    trip = make_trip(db, trip_setup["vehicle"], trip_setup["orders"])  # no loader run built

    for method, path in [
        ("post", "plan"), ("get", "handoff"), ("post", "gate-out"),
    ]:
        url = f"{BASE}/dispatch-trips/{trip.id}/{path}"
        body = {"client_action_id": str(uuid4()), "base_version": 1, "remove": [{"order_number": "ORD1001"}]}
        response = getattr(loader_client, method)(url, **({"json": body} if method == "post" else {}))
        assert response.status_code == 404, path
    assert loader_client.get(f"{BASE}/dispatch-trips/999999/handoff").status_code == 404


def test_runs_without_a_trip_are_untouched_by_all_of_it(loader_client, trip_setup):
    db = trip_setup["db"]
    for order in trip_setup["orders"]:
        order.outlet.window_end = time(18)
    seeded = make_run(db, trip_setup["vehicle"], trip_setup["dock"], code="LDR-RUN-1002", plan_version=1)
    make_revision(db, seeded, version=1)
    before = (seeded.status, seeded.current_plan_version, seeded.departs_at, seeded.gated_out_at)
    trip, run = built(trip_setup)
    load(db, run)
    release(db, run)

    plan(loader_client, trip, departs_at="2026-05-28T04:00:00Z")
    loader_client.post(f"{BASE}/dispatch-trips/{trip.id}/gate-out", json={"client_action_id": str(uuid4())})
    LoaderService.apply_overdue_defaults(db, now=datetime(2030, 1, 1))

    db.refresh(seeded)
    assert (seeded.status, seeded.current_plan_version, seeded.departs_at, seeded.gated_out_at) == before
    assert not db.execute(select(LoaderActivity).filter_by(run_id=seeded.id)).scalars().all()
    assert run.departs_at - at("03:30") == timedelta(minutes=30)
