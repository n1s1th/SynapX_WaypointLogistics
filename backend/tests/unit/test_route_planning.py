from dataclasses import replace
from datetime import datetime

import pytest

from app.models.reference import Depot
from app.services.district_travel import DistrictTravel
from app.services.route_planning import (
    InternalRouteProvider, RoutePlanRequest, RoutePlanningService, RouteStopInput,
)


def at(hhmm):
    return datetime.fromisoformat(f"2026-10-05T{hhmm}:00+05:30")


def stop(code, opens="06:00", closes="12:00", service=15):
    return RouteStopInput(code, code, "colombo", ((at(opens), at(closes)),), service, 0)


def request(*stops):
    return RoutePlanRequest(Depot.PELIYAGODA, at("06:00"), tuple(stops),
                            {"colombo": DistrictTravel(12, 24, 4, 8)}, vehicle_id=1, km_per_l=5)


def test_critical_closing_window_beats_alphabetical_order_and_early_opening():
    plan = InternalRouteProvider().plan(request(stop("AAA", service=40), stop("ZZZ", opens="06:20", closes="06:50")))
    assert plan.ordered_outlet_codes == ["ZZZ", "AAA"]
    assert plan.route_feasible is True
    assert plan.arrivals[0]["arrival_at"] == at("06:24").isoformat()


def test_travel_service_waiting_and_fuel_accumulate_from_one_route():
    plan = InternalRouteProvider().plan(request(stop("ONE", opens="07:00"), stop("TWO")), ["ONE", "TWO"])
    assert plan.total_travel_minutes == 32
    assert plan.total_service_minutes == 30
    assert plan.estimated_duration_minutes == 62
    assert plan.scheduled_elapsed_minutes == 98
    assert plan.estimated_distance_km == 16
    assert plan.estimated_fuel_liters == 3.2
    assert plan.arrivals[0]["service_start_at"] == at("07:00").isoformat()
    assert plan.arrivals[0]["depart_at"] == at("07:15").isoformat()
    assert plan.arrivals[1]["arrival_at"] == at("07:23").isoformat()


def test_impossible_window_has_specific_stop_and_reason():
    plan = InternalRouteProvider().plan(request(stop("LATE", closes="06:30", service=15)))
    assert plan.route_feasible is False
    assert plan.window_feasible is False
    assert plan.late_outlets == ["LATE"]
    assert plan.arrivals[0]["window_status"] == "FAIL"
    assert plan.violations[0]["outlet_code"] == "LATE"


def test_manual_order_recalculates_and_can_fail():
    data = request(stop("FLEX", service=40), stop("URGENT", closes="06:50"))
    planner = InternalRouteProvider()
    assert planner.plan(data).route_feasible
    manual = planner.plan(data, ["FLEX", "URGENT"])
    assert not manual.route_feasible
    assert manual.arrivals[1]["arrival_at"] == at("07:12").isoformat()


def test_risk_margin_is_visible_but_still_feasible():
    plan = InternalRouteProvider().plan(request(stop("TIGHT", closes="06:45")))
    assert plan.route_feasible
    assert plan.arrivals[0]["window_status"] == "AT_RISK"
    assert plan.arrivals[0]["slack_minutes"] == 6


def test_extra_order_handling_must_finish_inside_window():
    item = replace(stop("MULTI", closes="06:45"), handling_minutes=8)
    plan = InternalRouteProvider().plan(request(item))
    assert not plan.route_feasible
    assert plan.arrivals[0]["depart_at"] == at("06:47").isoformat()


def test_split_windows_wait_for_next_feasible_period():
    item = replace(stop("SPLIT"), windows=((at("06:00"), at("06:30")), (at("08:00"), at("10:00"))))
    plan = InternalRouteProvider().plan(request(item))
    assert plan.route_feasible
    assert plan.arrivals[0]["service_start_at"] == at("08:00").isoformat()


def test_deterministic_output_and_internal_default_without_external_provider():
    service = RoutePlanningService()
    assert isinstance(service.provider, InternalRouteProvider)
    data = request(stop("Z"), stop("A"))
    assert service.provider.plan(data).as_dict() == service.provider.plan(data).as_dict()
    # The input adapter normalizes stop order before calling a provider.
    assert service.provider.plan(data).ordered_outlet_codes == service.provider.plan(replace(data, stops=tuple(reversed(data.stops)))).ordered_outlet_codes


@pytest.mark.parametrize("order", [["A"], ["A", "A"], ["A", "UNKNOWN"]])
def test_invalid_stop_membership_is_rejected(order):
    with pytest.raises(ValueError, match="every active outlet exactly once"):
        InternalRouteProvider().plan(request(stop("A"), stop("B")), order)


def test_missing_and_cross_district_travel_are_not_invented():
    data = request(stop("A"), replace(stop("B"), district="gampaha"))
    plan = InternalRouteProvider().plan(data)
    assert not plan.route_feasible
    assert plan.window_feasible is None
    assert plan.estimated_distance_km is None
    assert plan.estimated_fuel_liters is None


def test_access_restriction_blocks_route():
    plan = InternalRouteProvider().plan(request(replace(stop("VAN"), access_status="fail", access_reason="Van required.")))
    assert plan.window_feasible
    assert not plan.route_feasible
    assert any(item["constraint"] == "ACCESS" for item in plan.violations)
