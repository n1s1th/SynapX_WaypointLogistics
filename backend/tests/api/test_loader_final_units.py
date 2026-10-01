"""Final units not sent on a loader issue (the Store Manager page reads
loader_issues.units_affected once decided). Every decision option, the
decide-by default, the units_not_sent override, and one issue per order per run."""
from uuid import uuid4

import pytest

from app.models.delivery_run import RunOrderState, RunStatus
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue, LoaderIssueOption
from app.models.reference import DockTablet
from app.services import loader_service as loader_module
from app.services.loader_service import LoaderService
from tests.api.test_loader_order_status import (  # noqa: F401  (setup is a fixture)
    BASE,
    LATER,
    released,
    rows,
    sent,
    setup,
)
from tests.conftest_loader import at, loader_client, trip_setup  # noqa: F401


def flag_with_real_options(s, number, issue_type, affected, total=None, extra=()):
    """A flagged row with the options POST /loader/issues files (_issue_options)."""
    row = rows(s.db, s.run)[number]
    total = row.units if total is None else total
    row.state = RunOrderState.FLAGGED
    issue = LoaderIssue(
        run_id=s.run.id, order_id=row.order_id, issue_type=issue_type,
        units_affected=affected, units_total=total, reported_by_id=s.loader.id,
        reported_at=at("02:03"), status=IssueStatus.SENT, decide_by=LATER,
    )
    options = list(loader_module._issue_options(issue_type, affected or 0, total or 0)) + list(extra)
    for position, (label, detail, default) in enumerate(options):
        issue.options.append(LoaderIssueOption(label=label, detail=detail, is_default=default,
                                               is_chosen=False, position=position))
    s.db.add(issue)
    s.run.status = RunStatus.ISSUE_FLAGGED
    s.db.flush()
    return issue


def decide(client, issue, option, **extra):
    return client.post(f"{BASE}/issues/{issue.id}/decision",
                       json={"option": option, "client_action_id": str(uuid4()), **extra})


def loaded(s, number, issue):
    s.db.refresh(issue)
    return LoaderService.loaded_units(rows(s.db, s.run)[number], issue)


# ORD1002: 8 units (two items), OUT027.
@pytest.mark.parametrize("issue_type, affected, option, not_sent, loaded_after", [
    # missing: the tablet sends how many are missing (the whole order by default)
    (IssueType.MISSING, 8, "Send without it", 8, 0),
    (IssueType.MISSING, 8, "Hold the vehicle", 0, 8),
    (IssueType.MISSING, 5, "Send without it", 8, 0),   # the order is deferred: nothing goes
    (IssueType.MISSING, 5, "Hold the vehicle", 0, 8),
    # short / damaged: send what is there, or wait for replacement stock
    (IssueType.SHORT, 3, "Send 5 of 8", 3, 5),
    (IssueType.SHORT, 3, "Hold the vehicle", 0, 8),
    (IssueType.DAMAGED, 2, "Send 6 of 8", 2, 6),
    (IssueType.DAMAGED, 2, "Hold the vehicle", 0, 8),
    # won't fit: leave the overflow, or a bigger truck takes it all
    (IssueType.WONT_FIT, 3, "Leave the overflow for the next run", 3, 5),
    (IssueType.WONT_FIT, 8, "Leave the overflow for the next run", 8, 0),
    (IssueType.WONT_FIT, 3, "Swap to a larger vehicle", 0, 8),
])
def test_each_option_leaves_the_final_units_not_sent(loader_client, setup, issue_type, affected,
                                                     option, not_sent, loaded_after):
    s = setup
    issue = flag_with_real_options(s, "ORD1002", issue_type, affected)

    response = decide(loader_client, issue, option)

    assert response.status_code == 200, response.json()
    assert response.json()["units_affected"] == not_sent
    assert response.json()["units_total"] == 8
    s.db.refresh(issue)
    assert issue.units_affected == not_sent
    assert loaded(s, "ORD1002", issue) == loaded_after


def test_move_to_another_vehicle_is_every_unit(loader_client, setup):
    s = setup
    issue = flag_with_real_options(s, "ORD1002", IssueType.MISSING, 8,
                                   extra=[("Move to VEH036 · Trip 1", "Goes on VEH036.", False)])
    decide(loader_client, issue, "Move to VEH036 · Trip 1")
    s.db.refresh(issue)
    assert issue.units_affected == 8


def test_a_partial_top_up_is_sent_as_units_not_sent(loader_client, setup):
    s = setup
    issue = flag_with_real_options(s, "ORD1002", IssueType.SHORT, 3)

    response = decide(loader_client, issue, "Hold the vehicle", units_not_sent=1)

    assert response.json()["units_affected"] == 1
    assert loaded(s, "ORD1002", issue) == 7


def test_units_not_sent_above_the_order_is_422(loader_client, setup):
    s = setup
    issue = flag_with_real_options(s, "ORD1002", IssueType.SHORT, 3)

    response = decide(loader_client, issue, "Hold the vehicle", units_not_sent=9)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_UNITS_NOT_SENT"
    s.db.refresh(issue)
    assert (issue.status, issue.units_affected) == (IssueStatus.SENT, 3)


@pytest.mark.parametrize("issue_type, affected, not_sent", [
    (IssueType.SHORT, 3, 3),        # default "Send 5 of 8"
    (IssueType.MISSING, 8, 8),      # default "Send without it"
    (IssueType.WONT_FIT, 3, 3),     # default "Leave the overflow ..."
])
def test_the_decide_by_default_sets_the_final_units_too(setup, issue_type, affected, not_sent):
    s = setup
    issue = flag_with_real_options(s, "ORD1002", issue_type, affected)
    issue.decide_by = at("03:10")
    s.db.flush()

    LoaderService.apply_overdue_defaults(s.db, now=at("03:11"))

    s.db.refresh(issue)
    assert issue.status == IssueStatus.DEFAULT_APPLIED
    assert issue.units_affected == not_sent


@pytest.mark.parametrize("issue_type", [IssueType.MISSING, IssueType.SHORT, IssueType.WONT_FIT])
def test_a_decided_issue_never_keeps_a_null_count(loader_client, setup, issue_type):
    """A flag with no count (a seeded or server-side issue) is the whole order."""
    s = setup
    issue = flag_with_real_options(s, "ORD1002", issue_type, None, total=None)
    issue.units_total = None
    s.db.flush()
    default = next(o for o in issue.options if o.is_default)

    assert decide(loader_client, issue, default.id).status_code == 200

    s.db.refresh(issue)
    assert (issue.units_affected, issue.units_total) == (8, 8)  # the whole order, from the plan row


def test_loaded_units_handoff_and_quantity_sent_agree(loader_client, setup):
    s = setup
    issue = flag_with_real_options(s, "ORD1001", IssueType.SHORT, 3)  # 12 units, one item
    decide(loader_client, issue, "Hold the vehicle", units_not_sent=1)
    released(s)  # every other order loaded; ORD1001 stays flagged, released 13 s ago
    rows(s.db, s.run)["ORD1001"].state = RunOrderState.FLAGGED
    s.db.flush()

    handoff = loader_client.get(f"{BASE}/dispatch-trips/{s.trip.id}/handoff").json()

    order = next(o for st in handoff["stops"] for o in st["orders"] if o["order_number"] == "ORD1001")
    assert (order["units_ordered"], order["loaded_units"]) == (12, 11)
    assert order["shortfall"]["units_affected"] == 1
    assert sent(s, "ORD1001") == [11]
    detail = loader_client.get(f"{BASE}/runs/{s.run.code}").json()
    row = next(o for st in detail["stops"] for o in st["orders"] if o["order_number"] == "ORD1001")
    assert row["loaded_units"] == 11


# --- one issue per order per run --------------------------------------------------


@pytest.fixture
def signed_in(loader_client, setup):
    s = setup
    s.db.add(DockTablet(label="Dock tablet 3", dock_id=s.run.dock_id, is_active=True))
    s.db.flush()
    session = loader_client.post(f"{BASE}/session", json={
        "loader_user_id": s.loader.id, "pin": "4417", "dock_tablet_label": "Dock tablet 3"})
    assert session.status_code in (200, 201), session.json()
    s.session = session.json()["session_id"]
    return s


def flag(client, s, number, units=3):
    return client.post(f"{BASE}/issues", json={
        "client_action_id": str(uuid4()), "plan_version": s.run.current_plan_version,
        "loader_session_id": s.session, "run_code": s.run.code, "order_number": number,
        "issue_type": "short", "units_affected": units,
    })


def test_an_order_cannot_be_flagged_twice_on_a_run(loader_client, signed_in):
    s = signed_in
    first = flag(loader_client, s, "ORD1001")
    second = flag(loader_client, s, "ORD1001")

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "ORDER_ALREADY_FLAGGED"
    assert second.json()["detail"]["issue_id"] == first.json()["id"]


def test_an_order_back_on_the_plan_keeps_its_one_issue(loader_client, signed_in):
    s = signed_in
    issue = flag(loader_client, s, "ORD1001").json()
    decide(loader_client, s.db.get(LoaderIssue, issue["id"]), "Send without it")
    # The dispatcher puts it back on the run.
    plan = loader_client.post(f"{BASE}/dispatch-trips/{s.trip.id}/plan", json={
        "client_action_id": str(uuid4()), "base_version": 1, "add": [{"order_number": "ORD1001"}]})
    assert plan.status_code == 200, plan.json()
    s.db.refresh(s.run)
    LoaderService.get_revision(s.db, s.run, 2).acknowledged_at = at("02:30")
    s.db.flush()

    again = flag(loader_client, s, "ORD1001")

    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "ORDER_ALREADY_FLAGGED"


def test_a_different_order_on_the_same_run_can_be_flagged(loader_client, signed_in):
    s = signed_in
    assert flag(loader_client, s, "ORD1001").status_code == 200
    assert flag(loader_client, s, "ORD1003", units=1).status_code == 200
