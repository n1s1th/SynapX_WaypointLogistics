from types import SimpleNamespace

from app.models.loader_issue import IssueStatus, IssueType
from app.schemas.store_order import summarise_shortfall


def issue(issue_type=IssueType.SHORT, status=IssueStatus.DECIDED, units_affected=3, units_total=46):
    return SimpleNamespace(issue_type=issue_type, status=status, units_affected=units_affected, units_total=units_total)


def test_no_issues_means_no_shortfall():
    assert summarise_shortfall([]) is None
    assert summarise_shortfall(None) is None


def test_damaged_goods_are_an_issue_not_a_shortfall():
    assert summarise_shortfall([issue(IssueType.DAMAGED)]) is None


def test_decided_shortfall_shows_units_short_of_total():
    shortfall = summarise_shortfall([issue()])
    assert shortfall.state == "confirmed"
    assert (shortfall.units_short, shortfall.units_total) == (3, 46)
    assert shortfall.reasons == ["short"]


def test_default_applied_counts_as_decided():
    assert summarise_shortfall([issue(status=IssueStatus.DEFAULT_APPLIED)]).state == "confirmed"


def test_undecided_issue_shows_under_review_without_a_number():
    shortfall = summarise_shortfall([issue(status=IssueStatus.SEEN), issue()])
    assert shortfall.state == "under_review"
    assert shortfall.units_short is None


def test_several_issues_on_one_order_are_added_up():
    shortfall = summarise_shortfall([issue(units_affected=3), issue(IssueType.WONT_FIT, units_affected=5)])
    assert shortfall.units_short == 8
    assert shortfall.reasons == ["short", "wont_fit"]


def test_decision_that_covers_the_shortfall_clears_it():
    assert summarise_shortfall([issue(units_affected=0)]) is None


def test_unknown_unit_count_still_reports_the_shortfall():
    shortfall = summarise_shortfall([issue(IssueType.MISSING, units_affected=None)])
    assert shortfall.state == "confirmed"
    assert shortfall.units_short is None
