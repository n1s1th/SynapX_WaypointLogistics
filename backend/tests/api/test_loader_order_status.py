"""The loader moves orders through order_service: PROCESSING on the first tick,
READY_FOR_DISPATCH once a release can no longer be undone (with
order_items.quantity_sent), and DEFERRED when a dispatcher decision defers it."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.exceptions import InvalidStateTransitionError
from app.models.delivery_run import RunOrderState, RunStatus, RunStop
from app.models.loader_issue import IssueType
from app.models.order import OrderItem, OrderStatus
from app.services import loader_service as loader_module
from app.services.loader_service import LoaderService, _quantity_sent_for_order
from tests.conftest_loader import (  # noqa: F401  (loader_client, trip_setup are fixtures)
    at,
    loader_client,
    make_issue,
    make_loader,
    make_order,
    make_outlet,
    make_trip,
    trip_setup,
)

BASE = "/api/v1/loader"
LATER = datetime(2030, 1, 1, 3, 10)


def add_items(db, order, *quantities):
    for i, quantity in enumerate(quantities):
        db.add(OrderItem(order_id=order.id, sku=f"{order.order_number}-{i}", item_name=f"Item {i}",
                         quantity=quantity, unit_price=1.0))
    db.flush()
    db.refresh(order)


@pytest.fixture
def setup(trip_setup):
    """RUN-0024 built from a trip, plan v1 acknowledged, every order ALLOCATED.

    ORD1001 OUT026 12 u, one item          ORD1004 OUT026 3 u, one item
    ORD1002 OUT027  8 u, two items (5 + 3)  ORD1003 OUT030 5 u, one item
    ORD1046 OUT031 46 u, one item (the "43 of 46" order)
    """
    db = trip_setup["db"]
    big = make_order(db, "ORD1046", make_outlet(db, "OUT031"), units=46, kg=460.0, m3=4.6)
    orders = trip_setup["orders"] + [big]
    for order in orders:
        order.status = OrderStatus.ALLOCATED
    by_number = {o.order_number: o for o in orders}
    add_items(db, by_number["ORD1001"], 12)
    add_items(db, by_number["ORD1002"], 5, 3)
    add_items(db, by_number["ORD1003"], 5)
    add_items(db, by_number["ORD1004"], 3)
    add_items(db, big, 46)
    trip = make_trip(db, trip_setup["vehicle"], orders)
    run = LoaderService.create_run_for_dispatch_trip(db, trip)
    LoaderService.get_revision(db, run, 1).acknowledged_at = at("01:00")
    db.flush()
    return SimpleNamespace(db=db, trip=trip, run=run, orders=by_number, loader=make_loader(db))


def rows(db, run):
    stops = db.execute(
        select(RunStop).filter_by(run_id=run.id, plan_version=run.current_plan_version)
    ).scalars()
    return {r.order.order_number: r for s in stops for r in s.orders}


def status(s, number):
    s.db.refresh(s.orders[number])
    return s.orders[number].status


def sent(s, number):
    s.db.refresh(s.orders[number])
    return [item.quantity_sent for item in sorted(s.orders[number].items, key=lambda i: i.id)]


def tap(client, s, number, action="check", method="post"):
    """A tablet tap: POST check, or DELETE check (untick)."""
    return client.request(
        method.upper(), f"{BASE}/runs/{s.run.code}/orders/{number}/{action}", json=_body(s)
    )


def _body(s):
    return {"client_action_id": str(uuid4()), "plan_version": s.run.current_plan_version}


def released(s, *, seconds_ago=13, short=None, flag=None):
    """Every order loaded and the run released `seconds_ago`. short: an order
    flagged SHORT for that many units and kept on (decided "Hold")."""
    for number, row in rows(s.db, s.run).items():
        row.state = RunOrderState.LOADED
        s.orders[number].status = OrderStatus.PROCESSING
    for number, units in (short or {}).items():
        row = rows(s.db, s.run)[number]
        row.state = RunOrderState.FLAGGED
        issue = make_issue(s.db, s.run, row.order, s.loader)
        issue.issue_type = IssueType.SHORT
        issue.units_affected = units
        issue.units_total = row.units
        issue.status = loader_module.IssueStatus.DECIDED
    s.run.status = RunStatus.READY_TO_DEPART
    s.run.released_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=seconds_ago)
    s.run.released_by_id = s.loader.id
    s.db.flush()


# --- first tick -> PROCESSING -----------------------------------------------------


def test_the_first_tick_moves_the_order_to_processing(loader_client, setup):
    s = setup

    assert tap(loader_client, s, "ORD1001").status_code == 200
    assert status(s, "ORD1001") == OrderStatus.PROCESSING
    assert status(s, "ORD1003") == OrderStatus.ALLOCATED  # untouched until ticked

    assert tap(loader_client, s, "ORD1001", method="delete").status_code == 200  # untick
    assert status(s, "ORD1001") == OrderStatus.PROCESSING
    assert tap(loader_client, s, "ORD1001").status_code == 200  # ticked again
    assert status(s, "ORD1001") == OrderStatus.PROCESSING


def test_acknowledging_a_plan_changes_no_order(loader_client, setup):
    s = setup
    revision = LoaderService.get_revision(s.db, s.run, 1)
    revision.acknowledged_at = None
    s.db.flush()

    response = loader_client.post(f"{BASE}/runs/{s.run.code}/plan/1/acknowledge",
                                  json={"client_action_id": str(uuid4()), "plan_version": 1})

    assert response.status_code == 200
    assert {status(s, n) for n in s.orders} == {OrderStatus.ALLOCATED}


def test_a_status_the_order_cannot_leave_never_breaks_a_tick(loader_client, setup, monkeypatch):
    s = setup
    s.orders["ORD1003"].status = OrderStatus.CANCELLED
    s.db.flush()

    assert tap(loader_client, s, "ORD1003").status_code == 200
    assert status(s, "ORD1003") == OrderStatus.CANCELLED
    assert rows(s.db, s.run)["ORD1003"].state == RunOrderState.LOADED

    def refuse(db, order_id, new_status):
        raise InvalidStateTransitionError("no", current_state="x", target_state="y")

    monkeypatch.setattr(loader_module.order_service, "update_order_status", refuse)
    assert tap(loader_client, s, "ORD1001").status_code == 200
    assert rows(s.db, s.run)["ORD1001"].state == RunOrderState.LOADED


# --- release -> READY_FOR_DISPATCH after the undo window --------------------------


def test_inside_the_undo_window_nothing_happens_and_undo_leaves_orders_alone(loader_client, setup):
    s = setup
    for number in s.orders:
        assert tap(loader_client, s, number).status_code == 200
    response = loader_client.post(f"{BASE}/runs/{s.run.code}/release", json=_body(s))
    assert response.status_code == 200

    loader_client.get(f"{BASE}/runs/{s.run.code}")
    loader_client.get(f"{BASE}/dispatch-trips/{s.trip.id}/loading")
    loader_client.get(f"{BASE}/dispatch-trips/{s.trip.id}/handoff")
    assert {status(s, n) for n in s.orders} == {OrderStatus.PROCESSING}

    assert loader_client.post(f"{BASE}/runs/{s.run.code}/release/undo", json=_body(s)).status_code == 200
    assert {status(s, n) for n in s.orders} == {OrderStatus.PROCESSING}
    assert sent(s, "ORD1001") == [None]


def test_a_read_after_the_window_finalizes_the_release(loader_client, setup):
    s = setup
    released(s, short={"ORD1046": 3, "ORD1002": 2})
    # Not finalized: one deferred upstream, one moved off the plan.
    s.orders["ORD1004"].status = OrderStatus.DEFERRED
    rows(s.db, s.run)["ORD1003"].state = RunOrderState.MOVED
    s.db.flush()

    assert loader_client.get(f"{BASE}/runs?dock=DOCK3").status_code == 200  # the queue

    assert status(s, "ORD1001") == OrderStatus.READY_FOR_DISPATCH
    assert sent(s, "ORD1001") == [12]
    assert status(s, "ORD1046") == OrderStatus.READY_FOR_DISPATCH  # short, still on
    assert sent(s, "ORD1046") == [43]  # "43 of 46"
    assert status(s, "ORD1002") == OrderStatus.READY_FOR_DISPATCH
    assert sent(s, "ORD1002") == [None, None]  # short, two items: rule C
    assert status(s, "ORD1004") == OrderStatus.DEFERRED
    assert sent(s, "ORD1004") == [None]
    assert status(s, "ORD1003") == OrderStatus.PROCESSING
    assert sent(s, "ORD1003") == [None]


@pytest.mark.parametrize("read", [
    lambda c, s: c.get(f"{BASE}/runs/{s.run.code}"),
    lambda c, s: c.get(f"{BASE}/summary?dock=DOCK3"),
    lambda c, s: c.get(f"{BASE}/dispatch-trips/{s.trip.id}/loading"),
    lambda c, s: LoaderService.dispatcher_view(s.db, [s.trip.id]),
])
def test_every_read_finalizes(loader_client, setup, read):
    s = setup
    released(s)
    read(loader_client, s)
    assert status(s, "ORD1003") == OrderStatus.READY_FOR_DISPATCH


def test_an_order_the_loader_never_ticked_goes_through_processing(setup):
    s = setup
    released(s)
    s.orders["ORD1003"].status = OrderStatus.ALLOCATED  # flagged missing, kept on
    s.db.flush()

    LoaderService.finalize_due_releases(s.db)

    assert status(s, "ORD1003") == OrderStatus.READY_FOR_DISPATCH


def test_finalizing_twice_changes_nothing(setup):
    s = setup
    released(s, short={"ORD1046": 3})

    first = LoaderService.finalize_due_releases(s.db)
    s.orders["ORD1001"].items[0].quantity_sent = 999  # someone else's later write
    s.db.flush()
    second = LoaderService.finalize_due_releases(s.db)
    third = LoaderService.finalize_release(s.db, s.run, force=True)

    assert len(first) == 5
    assert second == [] and third == []
    assert sent(s, "ORD1001") == [999]
    assert status(s, "ORD1046") == OrderStatus.READY_FOR_DISPATCH


def test_gate_out_finalizes_first_even_inside_the_window(loader_client, setup):
    s = setup
    released(s, seconds_ago=1)

    response = loader_client.post(f"{BASE}/dispatch-trips/{s.trip.id}/gate-out",
                                  json={"client_action_id": str(uuid4())})

    assert response.status_code == 200
    assert {status(s, n) for n in s.orders} == {OrderStatus.READY_FOR_DISPATCH}
    assert sent(s, "ORD1002") == [5, 3]  # fully loaded: every item in full


def test_the_handoff_finalizes_once_the_window_has_closed(loader_client, setup):
    s = setup
    released(s, seconds_ago=1)
    assert loader_client.get(f"{BASE}/dispatch-trips/{s.trip.id}/handoff").status_code == 200
    assert status(s, "ORD1001") == OrderStatus.PROCESSING  # undo is still possible

    s.run.released_at -= timedelta(seconds=12)
    s.db.flush()
    LoaderService.handoff(s.db, s.run)
    assert status(s, "ORD1001") == OrderStatus.READY_FOR_DISPATCH


# --- dispatcher decision that defers the order -------------------------------------


def flag(s, number="ORD1002", issue_type=IssueType.MISSING, affected=8, total=8, options=None):
    row = rows(s.db, s.run)[number]
    row.state = RunOrderState.FLAGGED
    issue = make_issue(s.db, s.run, row.order, s.loader, with_options=options is None)
    issue.issue_type = issue_type
    issue.units_affected = affected
    issue.units_total = total
    issue.decide_by = LATER
    for position, (label, default) in enumerate(options or []):
        issue.options.append(loader_module.LoaderIssueOption(
            label=label, is_default=default, is_chosen=False, position=position))
    s.run.status = RunStatus.ISSUE_FLAGGED
    s.db.flush()
    return issue


def decide(client, issue, option, **extra):
    return client.post(f"{BASE}/issues/{issue.id}/decision",
                       json={"option": option, "client_action_id": str(uuid4()), **extra})


def test_send_without_defers_the_order_to_the_next_operating_day(loader_client, setup):
    s = setup
    issue = flag(s)

    assert decide(loader_client, issue, "Send without it").status_code == 200

    order = s.orders["ORD1002"]
    s.db.refresh(order)
    assert order.status == OrderStatus.DEFERRED
    # The run's day (Thu 28 May) has passed, so: the next operating day after today.
    expected = LoaderService.deferral_day(s.db, s.run)
    assert expected > datetime.now(timezone.utc).date() - timedelta(days=1)
    assert order.operating_date == expected.isoformat()
    assert order.deferral_count == 1
    assert order.deferral_reason == f"Missing at the loading dock ({s.run.code}): Send without it"
    # The tablet's checklist reads the new day back.
    detail = loader_client.get(f"{BASE}/runs/{s.run.code}").json()
    row = next(o for st in detail["stops"] for o in st["orders"] if o["order_number"] == "ORD1002")
    assert row["state"] == "moved"
    assert row["deferred_to"] == expected.isoformat()


def test_the_decision_date_wins(loader_client, setup):
    s = setup
    issue = flag(s)
    decide(loader_client, issue, "Send without it", deferred_to="2026-06-02")
    s.db.refresh(s.orders["ORD1002"])
    assert s.orders["ORD1002"].operating_date == "2026-06-02"


@pytest.mark.parametrize("affected, deferred", [(8, True), (3, False)])
def test_leave_the_overflow_defers_only_a_whole_order(loader_client, setup, affected, deferred):
    s = setup
    issue = flag(s, issue_type=IssueType.WONT_FIT, affected=affected, options=[
        ("Leave the overflow for the next run", True), ("Swap to a larger vehicle", False)])

    decide(loader_client, issue, "Leave the overflow for the next run")

    assert (status(s, "ORD1002") == OrderStatus.DEFERRED) is deferred


def test_hold_does_not_defer(loader_client, setup):
    s = setup
    issue = flag(s)
    decide(loader_client, issue, "Hold VEH035")
    assert status(s, "ORD1002") == OrderStatus.ALLOCATED


def test_an_order_already_deferred_upstream_is_left_alone(loader_client, setup):
    s = setup
    order = s.orders["ORD1002"]
    order.status = OrderStatus.DEFERRED
    order.operating_date = "2026-06-05"
    order.deferral_count = 1
    order.deferral_reason = "Dispatcher: vehicle full"
    issue = flag(s)

    assert decide(loader_client, issue, "Send without it").status_code == 200

    s.db.refresh(order)
    assert (order.operating_date, order.deferral_count, order.deferral_reason) == (
        "2026-06-05", 1, "Dispatcher: vehicle full")


def test_the_decide_by_default_defers_too(setup):
    s = setup
    issue = flag(s)
    issue.decide_by = at("03:10")
    s.db.flush()

    LoaderService.apply_overdue_defaults(s.db, now=at("03:11"))

    assert status(s, "ORD1002") == OrderStatus.DEFERRED


# --- the quantity_sent rule ---------------------------------------------------------


def items(*quantities):
    return [SimpleNamespace(id=i + 1, quantity=q) for i, q in enumerate(quantities)]


def test_quantity_sent_rules():
    # Fully loaded: every item in full, whatever the rule.
    assert _quantity_sent_for_order(items(30, 16), 46, 46) == {1: 30, 2: 16}
    # One item: what was loaded.
    assert _quantity_sent_for_order(items(46), 46, 43) == {1: 43}
    # Short, several items. C: unknown, so null.
    assert _quantity_sent_for_order(items(30, 16), 46, 43, rule="C") == {1: None, 2: None}
    # B: the whole shortfall on the last item, spilling backwards if it runs out.
    assert _quantity_sent_for_order(items(30, 16), 46, 43, rule="B") == {1: 30, 2: 13}
    assert _quantity_sent_for_order(items(30, 16), 46, 20, rule="B") == {1: 20, 2: 0}
    # units_ordered unknown: the items' total.
    assert _quantity_sent_for_order(items(30, 16), None, 46) == {1: 30, 2: 16}


def test_the_default_rule_is_c():
    assert loader_module.SHORT_MULTI_ITEM_RULE == "C"


def test_rule_b_behind_the_constant(setup, monkeypatch):
    s = setup
    monkeypatch.setattr(loader_module, "SHORT_MULTI_ITEM_RULE", "B")
    released(s, short={"ORD1002": 2})

    LoaderService.finalize_due_releases(s.db)

    assert sent(s, "ORD1002") == [5, 1]  # 6 of 8: both short units off the last item


def test_released_at_is_stored_as_naive_utc():
    run = SimpleNamespace(status=None, released_at=None, released_by_id=None)
    at_ = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)

    LoaderService._set_released(run, None, at_)

    assert run.released_at == datetime(2026, 10, 1, 11, 0)
    assert run.released_at.tzinfo is None


# --- the deferral day ----------------------------------------------------------------
# 2026-10-01 is a Thursday; Sun 4 Oct is the only Sunday in these cases.
NOW = datetime(2026, 10, 1, 4, 30, tzinfo=timezone.utc)  # 10:00 depot time, Thu 1 Oct


def run_on(day: str):
    """A run departing 03:30 depot time on `day` (22:00 UTC the evening before)."""
    departs = datetime.fromisoformat(f"{day}T03:30") - timedelta(hours=5, minutes=30)
    return SimpleNamespace(departs_at=departs)


@pytest.mark.parametrize("run_day, now, expected", [
    ("2026-10-01", NOW, "2026-10-02"),   # a run today -> tomorrow (Fri)
    ("2026-10-09", NOW, "2026-10-10"),   # a future run (Fri) -> its next day (Sat)
    ("2026-05-28", NOW, "2026-10-02"),   # a run in the past -> after TODAY, not 29 May
    ("2026-10-03", NOW, "2026-10-05"),   # Sat run -> Sunday skipped -> Mon
    ("2026-10-01", datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc), "2026-10-03"),  # 00:30 depot Fri 2 Oct
])
def test_deferral_day_is_the_next_working_day(trip_setup, run_day, now, expected):
    day = LoaderService.deferral_day(trip_setup["db"], run_on(run_day), now=now)
    assert day == date.fromisoformat(expected)


def test_deferral_day_skips_calendar_closures(trip_setup):
    db = trip_setup["db"]
    db.add(loader_module.CalendarDay(date=date(2026, 10, 2), is_operating=False, holiday_name="Test closure"))
    db.flush()

    assert LoaderService.deferral_day(db, run_on("2026-10-01"), now=NOW) == date(2026, 10, 3)
