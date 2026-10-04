"""Loader API endpoints."""
import importlib

from app.models.delivery_run import RunStatus
from app.models.loader_activity import ActorKind
from app.services.loader_service import LoaderService
from tests.conftest_loader import (  # noqa: F401  (loader_client is a fixture)
    at,
    build_run_021,
    loader_client,
    make_dock,
    make_issue,
    make_loader,
    make_run,
    put_on_truck,
)

BASE = "/api/v1/loader"


def test_get_run_returns_stops_in_load_order(loader_client, db_session):
    build_run_021(db_session)
    db_session.flush()

    response = loader_client.get(f"{BASE}/runs/RUN-021")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == "RUN-021"
    assert body["status"] == RunStatus.LOADING.value
    assert [stop["outlet"]["code"] for stop in body["stops"]] == [
        "OUT027", "OUT031", "OUT030", "OUT026",
    ]
    assert [stop["load_position"] for stop in body["stops"]] == [1, 2, 3, 4]


def test_get_run_exposes_the_capacity_the_design_shows(loader_client, db_session):
    build_run_021(db_session)
    db_session.flush()

    body = loader_client.get(f"{BASE}/runs/RUN-021").json()

    assert body["capacity"] == {
        "loaded_weight_kg": 3410.0,
        "planned_weight_kg": 4920.0,
        "max_weight_kg": 5510.0,
        "loaded_volume_m3": 16.6,
        "planned_volume_m3": 23.9,
        "max_volume_m3": 26.4,
    }
    assert (body["orders_checked"], body["orders_total"]) == (5, 8)


def test_datetimes_are_sent_as_utc_with_a_z(loader_client, db_session):
    """Stored naive UTC must not reach the browser as naive (read as local time)."""
    run, _ = build_run_021(db_session)
    LoaderService.log(
        db_session, run, at=at("02:14"), actor_kind=ActorKind.DISPATCHER,
        event_type="plan_published", message="Dispatcher published plan v2",
    )
    db_session.flush()

    body = loader_client.get(f"{BASE}/runs/RUN-021").json()
    activity = loader_client.get(f"{BASE}/runs/RUN-021/activity").json()

    assert body["departs_at"] == "2026-05-28T03:30:00Z"
    assert body["plan"]["published_at"].endswith("Z")
    stamped = [o["checked_at"] for s in body["stops"] for o in s["orders"] if o["checked_at"]]
    assert stamped and all(value.endswith("Z") for value in stamped)
    assert activity[0]["at"] == "2026-05-28T02:14:00Z"


def test_get_run_includes_order_detail_for_the_checklist_rows(loader_client, db_session):
    build_run_021(db_session)
    db_session.flush()

    body = loader_client.get(f"{BASE}/runs/RUN-021").json()
    rows = {o["order_number"]: o for stop in body["stops"] for o in stop["orders"]}

    assert rows["ORD0092301"]["units"] == 56
    assert rows["ORD0092301"]["weight_kg"] == 820.0
    assert rows["ORD0092301"]["volume_m3"] == 4.0
    assert rows["ORD0092301"]["temperature_class"] == "ambient"
    assert rows["ORD0092301"]["state"] == "loaded"
    assert rows["ORD0092301"]["checked_by"] == "Saman J."
    assert rows["ORD0092302"]["temperature_class"] == "chilled"
    assert rows["ORD0092302"]["state"] == "to_load"
    assert rows["ORD0092302"]["checked_by"] is None


def test_get_run_404s_for_an_unknown_code(loader_client, db_session):
    response = loader_client.get(f"{BASE}/runs/RUN-999")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "NOT_FOUND"


def test_get_issue_returns_the_options_the_dispatcher_had(loader_client, db_session):
    run, orders = build_run_021(db_session)
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")
    issue = make_issue(db_session, run, orders["ORD0092308"], reporter)
    db_session.flush()

    response = loader_client.get(f"{BASE}/issues/{issue.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["order_number"] == "ORD0092308"
    assert body["issue_type"] == "missing"
    assert (body["units_affected"], body["units_total"]) == (8, 8)
    assert body["status"] == "sent"
    assert body["reported_by"] == "Tharindu J."
    assert [o["label"] for o in body["options"]] == [
        "Send without it", "Move to VEH036 · Trip 1", "Hold VEH035",
    ]
    assert [o["is_default"] for o in body["options"]] == [True, False, False]


def test_get_issue_404s_for_an_unknown_id(loader_client, db_session):
    response = loader_client.get(f"{BASE}/issues/4242")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "NOT_FOUND"


def test_dev_plan_change_publishes_the_next_version(loader_client, db_session):
    run, _ = build_run_021(db_session)
    put_on_truck(db_session, run, "ORD0092308")

    response = loader_client.post(
        f"{BASE}/dev/runs/RUN-021/plan-change",
        json={
            "unload_order_numbers": ["ORD0092308"],
            "dont_load_order_numbers": ["ORD0092304"],
            "load_new_order_numbers": ["ORD0092319"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan_version"] == 3
    assert {c["change_kind"]: c["order_number"] for c in body["changes"]} == {
        "unload_from_truck": "ORD0092308",
        "dont_load": "ORD0092304",
        "load_new": "ORD0092319",
    }

    after = loader_client.get(f"{BASE}/runs/RUN-021").json()
    assert after["current_plan_version"] == 3
    assert after["unacknowledged_plan_version"] == 3
    assert after["capacity"]["planned_weight_kg"] == 4690.0
    assert after["capacity"]["planned_volume_m3"] == 22.6
    assert after["orders_total"] == 7


def test_dev_plan_change_defaults_to_the_figma_change(loader_client, db_session):
    """Posting no body reproduces the design's v2 -> v3 change (2a, T2a)."""
    run, _ = build_run_021(db_session)
    put_on_truck(db_session, run, "ORD0092308")

    response = loader_client.post(f"{BASE}/dev/runs/RUN-021/plan-change")

    assert response.status_code == 200, response.text
    changes = {c["order_number"]: c for c in response.json()["changes"]}
    assert {n: c["change_kind"] for n, c in changes.items()} == {
        "ORD0092308": "unload_from_truck",
        "ORD0092304": "dont_load",
        "ORD0092319": "load_new",
    }
    assert changes["ORD0092308"]["reason"].startswith("Store reported a cold-room fault")
    after = loader_client.get(f"{BASE}/runs/RUN-021").json()
    assert after["capacity"]["planned_weight_kg"] == 4690.0
    states = {o["order_number"]: o["state"] for s in after["stops"] for o in s["orders"]}
    # Only the two orders moved to reach ORD0092308 need re-checking.
    assert [n for n, s in sorted(states.items()) if s == "re_check"] == ["ORD0092305", "ORD0092306"]
    assert states["ORD0092307"] == "loaded"
    diff = {o["order_number"]: o for s in after["stops"] for o in s["orders"]}
    assert diff["ORD0092305"]["note"] == "Re-check · moved to reach ORD0092308"
    assert diff["ORD0092304"]["reason"].startswith("Not loaded yet")


def test_dev_plan_change_default_on_the_seeded_t0_is_a_dont_load(loader_client, db_session):
    """At the seed's t0 ORD0092308 is still in staging, so nothing comes off."""
    build_run_021(db_session)
    db_session.flush()

    response = loader_client.post(f"{BASE}/dev/runs/RUN-021/plan-change")

    kinds = {c["order_number"]: c["change_kind"] for c in response.json()["changes"]}
    assert kinds["ORD0092308"] == "dont_load"


def test_dev_decision_then_activity_is_logged(loader_client, db_session):
    run, orders = build_run_021(db_session)
    run.status = RunStatus.ISSUE_FLAGGED
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")
    issue = make_issue(db_session, run, orders["ORD0092308"], reporter)
    db_session.flush()

    decided = loader_client.post(
        f"{BASE}/dev/issues/{issue.id}/decide",
        json={"option_label": "Move to VEH036 · Trip 1", "decided_by": "Kasun Perera"},
    )
    assert decided.status_code == 200, decided.text

    detail = loader_client.get(f"{BASE}/issues/{issue.id}").json()
    assert detail["status"] == "decided"
    assert detail["decided_by"] == "Kasun Perera"

    activity = loader_client.get(f"{BASE}/runs/RUN-021/activity").json()
    assert any(entry["type"] == "issue_decided" for entry in activity)
    assert any(entry["actor"]["kind"] == "dispatcher" for entry in activity)


def test_dev_expire_applies_the_default(loader_client, db_session):
    run, orders = build_run_021(db_session)
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")
    issue = make_issue(db_session, run, orders["ORD0092308"], reporter)
    db_session.flush()

    response = loader_client.post(f"{BASE}/dev/issues/{issue.id}/expire")

    assert response.status_code == 200, response.text
    detail = loader_client.get(f"{BASE}/issues/{issue.id}").json()
    assert detail["status"] == "default_applied"
    chosen = [o["label"] for o in detail["options"] if o["is_chosen"]]
    assert chosen == ["Send without it"]


def test_resolving_a_settled_issue_returns_409(loader_client, db_session):
    run, orders = build_run_021(db_session)
    reporter = make_loader(db_session, "Tharindu Jayasuriya", "Tharindu J.")
    issue = make_issue(db_session, run, orders["ORD0092308"], reporter)
    db_session.flush()
    loader_client.post(f"{BASE}/dev/issues/{issue.id}/expire")

    response = loader_client.post(f"{BASE}/dev/issues/{issue.id}/expire")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "INVALID_STATE_TRANSITION"


def test_dock_activity_spans_runs_and_is_newest_first(loader_client, db_session):
    run_a, orders = build_run_021(db_session)
    dock = run_a.dock
    run_b = make_run(db_session, run_a.vehicle, dock, code="RUN-027")
    LoaderService.log(
        db_session, run_a, at=at("02:14"), actor_kind=ActorKind.DISPATCHER,
        event_type="plan_published", message="Dispatcher published plan v3",
    )
    LoaderService.log(
        db_session, run_b, at=at("02:20"), actor_kind=ActorKind.LOADER,
        event_type="order_checked", message="ORD0092315 loaded",
    )
    LoaderService.log(
        db_session, run_a, at=at("02:16"), actor_kind=ActorKind.LOADER,
        event_type="plan_acknowledged", message="Acknowledged - Saman J.",
    )
    db_session.flush()

    body = loader_client.get(f"{BASE}/activity?dock=3").json()

    assert [entry["message"] for entry in body] == [
        "ORD0092315 loaded",              # 02:20
        "Acknowledged - Saman J.",        # 02:16
        "Dispatcher published plan v3",   # 02:14
    ]
    # The feed spans every run on the dock, so each entry names its run.
    assert [entry["run_code"] for entry in body] == ["RUN-027", "RUN-021", "RUN-021"]


def test_dock_activity_can_be_narrowed_to_one_run(loader_client, db_session):
    run_a, _ = build_run_021(db_session)
    run_b = make_run(db_session, run_a.vehicle, run_a.dock, code="RUN-027")
    LoaderService.log(
        db_session, run_a, at=at("02:14"), actor_kind=ActorKind.DISPATCHER,
        event_type="plan_published", message="on RUN-021",
    )
    LoaderService.log(
        db_session, run_b, at=at("02:20"), actor_kind=ActorKind.LOADER,
        event_type="order_checked", message="on RUN-027",
    )
    db_session.flush()

    body = loader_client.get(f"{BASE}/activity?dock=3&run_code=RUN-021").json()

    assert [entry["message"] for entry in body] == ["on RUN-021"]


def test_dock_activity_accepts_number_code_or_name(loader_client, db_session):
    run, _ = build_run_021(db_session)
    LoaderService.log(
        db_session, run, at=at("02:14"), actor_kind=ActorKind.LOADER,
        event_type="order_checked", message="something happened",
    )
    db_session.flush()

    for dock in ("3", "DOCK3", "Dock 3"):
        response = loader_client.get(f"{BASE}/activity", params={"dock": dock})
        assert response.status_code == 200, f"{dock}: {response.text}"
        assert len(response.json()) == 1, dock


def test_dock_activity_respects_limit(loader_client, db_session):
    run, _ = build_run_021(db_session)
    for minute in range(5):
        LoaderService.log(
            db_session, run, at=at(f"02:{10 + minute:02d}"),
            actor_kind=ActorKind.LOADER, event_type="order_checked",
            message=f"entry {minute}",
        )
    db_session.flush()

    body = loader_client.get(f"{BASE}/activity?dock=3&limit=2").json()

    # Newest two.
    assert [entry["message"] for entry in body] == ["entry 4", "entry 3"]


def test_dock_activity_404s_for_an_unknown_dock(loader_client, db_session):
    build_run_021(db_session)
    db_session.flush()

    response = loader_client.get(f"{BASE}/activity?dock=9")

    assert response.status_code == 404
    assert response.json()["detail"]["entity"] == "Dock"


def test_dock_activity_404s_when_the_run_is_at_another_dock(loader_client, db_session):
    run, _ = build_run_021(db_session)
    other_dock = make_dock(db_session, code="DOCK4", name="Dock 4")
    make_run(db_session, run.vehicle, other_dock, code="RUN-099")
    db_session.flush()

    response = loader_client.get(f"{BASE}/activity?dock=3&run_code=RUN-099")

    assert response.status_code == 404
    assert response.json()["detail"]["entity"] == "DeliveryRun"


def test_dock_activity_requires_a_dock(loader_client, db_session):
    response = loader_client.get(f"{BASE}/activity")

    assert response.status_code == 422


def test_run_activity_and_the_dock_feed_are_both_newest_first(loader_client, db_session):
    """Both newest first; the checklist's Change log card reverses the run's list."""
    run, _ = build_run_021(db_session)
    LoaderService.log(
        db_session, run, at=at("02:20"), actor_kind=ActorKind.LOADER,
        event_type="order_checked", message="later",
    )
    LoaderService.log(
        db_session, run, at=at("02:14"), actor_kind=ActorKind.DISPATCHER,
        event_type="plan_published", message="earlier",
    )
    db_session.flush()

    timeline = loader_client.get(f"{BASE}/runs/RUN-021/activity").json()
    feed = loader_client.get(f"{BASE}/activity?dock=3&run_code=RUN-021").json()

    assert [e["summary"] for e in timeline] == ["later", "earlier"]
    assert [e["message"] for e in feed] == ["later", "earlier"]


def test_dev_endpoints_are_not_mounted_in_production(monkeypatch):
    """The sub-router is not registered at all, so the paths never exist."""
    from app.core import config

    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")

    from app.api.v1.endpoints import loader as loader_endpoints

    reloaded = importlib.reload(loader_endpoints)
    try:
        dev_paths = [
            route.path for route in reloaded.router.routes if "/dev/" in route.path
        ]
        live_paths = {
            route.path for route in reloaded.router.routes if "/dev/" not in route.path
        }
        assert dev_paths == []
        # The ordinary reads and the tablet's writes are untouched.
        assert live_paths == {
            "/users",
            "/session",
            "/session/{session_id}",
            "/runs",
            "/summary",
            "/runs/{code}",
            "/runs/{code}/activity",
            "/activity",
            "/issues/{issue_id}",
            "/dispatch-trips/{trip_id}/run",
            "/dispatch-trips/{trip_id}/loading",
            "/dispatch-trips/{trip_id}/plan",
            "/dispatch-trips/{trip_id}/handoff",
            "/dispatch-trips/{trip_id}/gate-out",
            "/issues/{issue_id}/decision",
            "/issues/by-action/{client_action_id}/photo",
            "/runs/{code}/orders/{order_number}/check",
            "/runs/{code}/orders/{order_number}/recheck",
            "/runs/{code}/plan/{version}/acknowledge",
            "/runs/{code}/orders/{order_number}/unload",
            "/issues",
            "/runs/{code}/release",
            "/runs/{code}/release/undo",
        }
    finally:
        # Restore the module for the rest of the session.
        monkeypatch.undo()
        importlib.reload(loader_endpoints)

