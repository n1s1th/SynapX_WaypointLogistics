"""The database must reject a replayed client_action_id.

These cover the storage half of the write contract in docs/reference/loader/API_CONTRACT.md.
The "duplicate returns the original result with 200" half belongs to the write
endpoints, which are L4-L8 and not built yet - but without a unique constraint
underneath, those endpoints could not detect a replay at all, so this is the part
that has to be right first.

The tablet queues actions in IndexedDB while offline and replays them on
reconnect, so the same id genuinely arrives twice.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.models.delivery_run import RunStopOrder
from app.models.loader_activity import (
    CheckAction,
    LoaderActivity,
    LoadingCheck,
    ReleaseAction,
    RunReleaseAction,
)
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue
from app.models.plan_revision import PlanRevision
from tests.conftest_loader import at, build_run_021, make_loader

ACTION_ID = "8f14e45f-ea8f-4b6d-9c11-2b4c1a2f0001"


def _issue(run, order, reporter, client_action_id):
    return LoaderIssue(
        run_id=run.id,
        order_id=order.id,
        issue_type=IssueType.DAMAGED,
        units_affected=3,
        units_total=56,
        reported_by_id=reporter.id,
        reported_at=at("02:13"),
        status=IssueStatus.SENT,
        client_action_id=client_action_id,
    )


def _revision(run, version, client_action_id):
    return PlanRevision(
        run_id=run.id,
        version=version,
        published_at=at("02:14"),
        source="Dispatcher",
        client_action_id=client_action_id,
    )


def _release(run, action, client_action_id, actor=None):
    return RunReleaseAction(
        run_id=run.id,
        action=action,
        actor_id=actor.id if actor else None,
        at=at("03:06"),
        client_action_id=client_action_id,
    )


def test_duplicate_flag_action_id_is_rejected(db_session):
    run, orders = build_run_021(db_session)
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")

    db_session.add(_issue(run, orders["ORD0092301"], reporter, ACTION_ID))
    db_session.flush()

    with pytest.raises(IntegrityError):
        # A savepoint, so the failed insert does not poison the test's outer
        # transaction and leave the fixture rolling back a dead one.
        with db_session.begin_nested():
            db_session.add(_issue(run, orders["ORD0092302"], reporter, ACTION_ID))
            db_session.flush()


def test_duplicate_acknowledge_action_id_is_rejected(db_session):
    run, _ = build_run_021(db_session)

    db_session.add(_revision(run, 3, ACTION_ID))
    db_session.flush()

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            db_session.add(_revision(run, 4, ACTION_ID))
            db_session.flush()


def test_duplicate_release_action_id_is_rejected(db_session):
    run, _ = build_run_021(db_session)

    db_session.add(_release(run, ReleaseAction.RELEASE, ACTION_ID))
    db_session.flush()

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            db_session.add(_release(run, ReleaseAction.RELEASE, ACTION_ID))
            db_session.flush()


def test_duplicate_check_action_id_is_rejected(db_session):
    """loading_checks already had the column; asserted so it cannot regress."""
    run, _ = build_run_021(db_session)
    rows = db_session.query(RunStopOrder).all()

    db_session.add(
        LoadingCheck(
            run_stop_order_id=rows[0].id,
            action=CheckAction.CHECK,
            at=at("02:20"),
            client_action_id=ACTION_ID,
        )
    )
    db_session.flush()

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            db_session.add(
                LoadingCheck(
                    run_stop_order_id=rows[1].id,
                    action=CheckAction.CHECK,
                    at=at("02:21"),
                    client_action_id=ACTION_ID,
                )
            )
            db_session.flush()


def test_release_and_undo_can_repeat_on_one_run_with_distinct_ids(db_session):
    """Why release is a table and not a column on delivery_runs.

    Mark ready -> undo -> mark ready again is a normal sequence. All three are
    separate actions with their own ids, and all three must survive; a single
    column on the run row would keep only the last one.
    """
    run, _ = build_run_021(db_session)
    loader = make_loader(db_session, "Nimal Senanayake", "Nimal S.")

    db_session.add(_release(run, ReleaseAction.RELEASE, "release-1", loader))
    db_session.add(_release(run, ReleaseAction.UNDO, "undo-1", loader))
    db_session.add(_release(run, ReleaseAction.RELEASE, "release-2", loader))
    db_session.flush()

    stored = (
        db_session.query(RunReleaseAction)
        .filter_by(run_id=run.id)
        .order_by(RunReleaseAction.id)
        .all()
    )
    assert [a.action for a in stored] == [
        ReleaseAction.RELEASE,
        ReleaseAction.UNDO,
        ReleaseAction.RELEASE,
    ]
    assert [a.client_action_id for a in stored] == ["release-1", "undo-1", "release-2"]


def test_null_action_ids_do_not_collide(db_session):
    """Seeded and dispatcher-originated rows have no client action behind them.

    They must be able to coexist, so the column is nullable and NULLs repeat.
    """
    run, orders = build_run_021(db_session)
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")

    db_session.add(_issue(run, orders["ORD0092301"], reporter, None))
    db_session.add(_issue(run, orders["ORD0092302"], reporter, None))
    db_session.add(_revision(run, 3, None))
    db_session.add(_revision(run, 4, None))
    db_session.add(_release(run, ReleaseAction.RELEASE, None))
    db_session.add(_release(run, ReleaseAction.UNDO, None))
    db_session.flush()

    assert db_session.query(LoaderIssue).filter_by(client_action_id=None).count() == 2
    assert db_session.query(PlanRevision).filter_by(client_action_id=None).count() >= 2
    assert db_session.query(RunReleaseAction).filter_by(client_action_id=None).count() == 2


def test_the_same_id_may_be_reused_across_different_tables(db_session):
    """Uniqueness is per table, which is what we want.

    A check and a release are different actions and would never share an id in
    practice, but nothing should break if they did - the constraint exists to
    catch a replay of the same action, not to enforce a global id space.
    """
    run, _ = build_run_021(db_session)
    rows = db_session.query(RunStopOrder).all()

    db_session.add(
        LoadingCheck(
            run_stop_order_id=rows[0].id,
            action=CheckAction.CHECK,
            at=at("02:20"),
            client_action_id=ACTION_ID,
        )
    )
    db_session.add(_release(run, ReleaseAction.RELEASE, ACTION_ID))
    db_session.flush()  # must not raise


def test_release_actions_are_not_in_the_activity_log(db_session):
    """RunReleaseAction is the idempotency record, not the human-readable log.

    LoaderActivity stays the single source for the Log tab, so a release writes
    one of each rather than the feed reading from two places.
    """
    run, _ = build_run_021(db_session)
    db_session.add(_release(run, ReleaseAction.RELEASE, "release-1"))
    db_session.flush()

    assert db_session.query(LoaderActivity).filter_by(run_id=run.id).count() == 0
