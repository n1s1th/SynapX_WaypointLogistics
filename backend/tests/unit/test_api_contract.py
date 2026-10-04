"""Guards docs/reference/loader/API_CONTRACT.md against drifting from the code.

The contract is what the other loader branch builds against, so a stale enum
value there is a real defect - it just fails in the frontend instead of here.
"""
import re
from pathlib import Path

import pytest

from app.models.delivery_run import RunOrderState, RunStatus, StopStatus
from app.models.loader_activity import ActorKind
from app.models.loader_issue import IssueStatus, IssueType
from app.models.plan_revision import PlanChangeKind
from app.models.reference import Brand, DockType, TempCapability, TemperatureClass, VehicleType

CONTRACT = Path(__file__).resolve().parents[2].parent / "docs" / "reference" / "loader" / "API_CONTRACT.md"

# Every enum the contract publishes, against the enum it must mirror.
DOCUMENTED_ENUMS = {
    "run_status": RunStatus,
    "order_state": RunOrderState,
    "temperature_class": TemperatureClass,
    "brand": Brand,
    "dock_type": DockType,
    "vehicle_type": VehicleType,
    "temp_capability": TempCapability,
    "issue_type": IssueType,
    "issue_status": IssueStatus,
    "change_kind": PlanChangeKind,
    "actor_kind": ActorKind,
    "stop_status": StopStatus,
}


@pytest.fixture(scope="module")
def contract_text() -> str:
    assert CONTRACT.exists(), f"contract missing at {CONTRACT}"
    return CONTRACT.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def documented_values(contract_text: str) -> dict:
    """Parse the `| `enum` | `a` · `b` |` rows out of the Shared enums table."""
    values = {}
    for line in contract_text.splitlines():
        match = re.match(r"^\|\s*`(\w+)`\s*\|\s*(.+?)\s*\|\s*$", line)
        if match and match.group(1) in DOCUMENTED_ENUMS:
            values[match.group(1)] = re.findall(r"`([a-z_]+)`", match.group(2))
    return values


@pytest.mark.parametrize("name", sorted(DOCUMENTED_ENUMS))
def test_documented_enum_matches_the_code(name, documented_values):
    assert name in documented_values, f"{name} is not in the Shared enums table"
    expected = [member.value for member in DOCUMENTED_ENUMS[name]]
    assert documented_values[name] == expected, (
        f"{name} in API_CONTRACT.md is out of date with the model"
    )


def test_the_six_enums_the_team_asked_for_are_all_documented(documented_values):
    required = {
        "run_status",
        "order_state",
        "temperature_class",
        "dock_type",
        "issue_type",
        "issue_status",
    }
    assert required <= set(documented_values)


def test_client_action_id_contract_is_stated(contract_text):
    """The three things a client must know, not just the field name."""
    assert "## `client_action_id` — the write contract" in contract_text

    section = contract_text.split("## `client_action_id`")[1].split("\n---")[0]
    # Collapse line wrapping, so rewrapping a paragraph cannot break a phrase check.
    section = " ".join(section.split())
    lowered = section.lower()

    # A UUID the tablet generates.
    assert "uuid" in lowered
    # In the JSON body, not a header or query param.
    assert "json request body" in lowered
    assert "not a header" in lowered
    # A duplicate is a 200 with the resource as it is now, not an error, and not
    # a stored copy of the first response.
    assert "returns `200` with the resource's current state" in section
    assert "not a stored copy of the first response" in section
    assert "not applied twice" in lowered


def test_write_contract_states_where_each_action_id_is_stored(contract_text):
    """The storage table replaced an earlier "not built yet" caveat.

    If it ever reverts to saying a column is missing, that is wrong now and would
    send whoever builds the write down a pointless migration.
    """
    section = contract_text.split("## `client_action_id`")[1].split("\n---")[0]

    for store in (
        "`loading_checks`",
        "`loader_issues.client_action_id`",
        "`plan_revisions.client_action_id`",
        "`run_release_actions`",
    ):
        assert store in section, f"write contract does not say where {store} lives"

    assert "all four paths are ready" in section.lower()
    assert "do **not** have one" not in section, "the stale storage caveat is back"


def test_write_contract_names_the_endpoints_it_covers(contract_text):
    section = contract_text.split("## `client_action_id`")[1].split("\n---")[0]

    for verb in ("check", "flag", "acknowledge", "release"):
        assert verb in section.lower(), f"write contract does not mention {verb}"
    # The dev endpoints are explicitly exempt - they are not tablet-originated.
    assert "/loader/dev/*" in section


def test_page_routes_are_listed_with_owners(contract_text):
    assert "## Page routes" in contract_text
    section = contract_text.split("## Page routes")[1].split("\n## ")[0]

    # Sanduni's pages, named in the task.
    for route in ("/loader/sign-in", "/loader/issues", "/loader/runs/[code]/review"):
        assert route in section, f"{route} missing from the page routes"
    # And this branch's, so the two do not collide on the same files.
    for route in ("/loader/runs/[code]", "/loader/issues/[id]", "/loader/log"):
        assert route in section, f"{route} missing from the page routes"

    assert "Sanduni's pages" in section
    assert "Sachintha's pages" in section


def test_both_activity_endpoints_are_documented(contract_text):
    assert "### `GET /loader/activity`" in contract_text
    assert "### `GET /loader/runs/{code}/activity`" in contract_text
    # Both are newest first; the Change log card reversing it is the surprise.
    assert "**Oldest first.**" not in contract_text
    assert "**Newest first** — the Log tab" in contract_text
    assert "reverses the list" in contract_text


def test_log_types_for_sanduni_endpoints_are_documented(contract_text):
    """L5/L6 writes must log, under these types, to show up in the Log."""
    for event_type in ("issue_flagged", "run_released", "run_release_undone"):
        assert f"`{event_type}`" in contract_text


def test_both_progress_counts_are_documented(contract_text):
    """Loaded (queue) and checked-or-flagged (review lock) must not be conflated."""
    flat = " ".join(contract_text.split())
    assert '"orders_loaded"' in contract_text
    assert '"orders_checked"' in contract_text
    assert "`orders_loaded` counts only `loaded`" in flat
    assert "`orders_checked` counts `loaded` and `flagged`" in flat


def test_every_loader_error_code_is_documented(contract_text):
    """A code the tablet can receive but the contract never names is a defect."""
    section = contract_text.split("### Errors")[1].split("\n---")[0]

    for code in (
        "NOT_FOUND",
        "INVALID_STATE_TRANSITION",
        "PLAN_VERSION_STALE",
        "PLAN_NOT_ACKNOWLEDGED",
        "CLIENT_ACTION_ID_REUSED",
        "PLAN_VERSION_MISMATCH",
        "RELEASE_LOCKED",
        "UNDO_WINDOW_EXPIRED",
    ):
        assert f"`{code}`" in section, f"{code} missing from the Errors table"


def test_release_blocker_codes_are_documented(contract_text):
    section = contract_text.split("### Release lock")[1].split("\n### ")[0]

    for code in (
        "plan_not_acknowledged",
        "unload_pending",
        "re_check_pending",
        "orders_open",
        "issue_waiting",
    ):
        assert f"`{code}`" in section, f"release blocker {code} is not documented"


def test_the_l7_writes_are_documented(contract_text):
    assert "`POST /loader/runs/{code}/plan/{version}/acknowledge`" in contract_text
    assert "`POST /loader/runs/{code}/orders/{order_number}/unload`" in contract_text
    # Optional now, required after sign-in: both halves must stay stated.
    section = " ".join(contract_text.split("### Acknowledge · unload")[1].split("\n### ")[0].split())
    assert "optional until L2 sign-in is merged" in section
    assert "becomes **required** after L2" in section


def test_wave_values_match_the_seed_and_the_frontend(contract_text):
    """wave has no Python enum (the column is free text), so pin the values."""
    row = next(line for line in contract_text.splitlines() if line.startswith("| `wave` |"))
    assert re.findall(r"`([a-z_]+)`", row.split("|")[2]) == ["night", "day"]


def test_the_helpers_sanduni_calls_exist_and_are_named(contract_text):
    """The contract tells L3/L6 which helper to call; each must really exist."""
    from app.services.loader_service import LoaderService

    for helper in (
        "release_blockers",
        "check_release_allowed",
        "check_undo_allowed",
        "release_fields",
        "plan_updated_at",
        "dock_plan_updated_at",
    ):
        assert f"`{helper}" in contract_text or f".{helper}(" in contract_text, helper
        assert callable(getattr(LoaderService, helper)), helper


def test_the_new_card_fields_are_documented(contract_text):
    for field in ("released_at", "released_by", "plan_updated_at", "pre_stage_note", "loaded_units"):
        assert f'"{field}"' in contract_text or f"`{field}`" in contract_text, field
    assert "Source TBD with dispatcher" in contract_text or "source TBD with dispatcher" in contract_text
