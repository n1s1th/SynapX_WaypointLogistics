"""Store Manager ordering rules (docs/reference/store-manager-contract.md §6 and kickoff answers Q1–Q3).

Pure functions with no database access, so they can be unit-tested directly. The frontend mirrors
these in frontend/components/store/new-request/delivery-rules.ts — keep the two in step.
"""
from datetime import date, datetime, time, timedelta
from typing import Callable, Iterable, List, Optional

CUTOFF_TIME = time(16, 0)  # 4 PM, Asia/Colombo

IsOperatingDay = Callable[[date], bool]


def cutoff_for(delivery_date: date) -> datetime:
    """Orders for a delivery date close at 4 PM the day before (Q2)."""
    return datetime.combine(delivery_date - timedelta(days=1), CUTOFF_TIME)


def is_past_cutoff(delivery_date: date, now: datetime) -> bool:
    """The cutoff is strict: an order placed at exactly 16:00:00 is too late."""
    return now >= cutoff_for(delivery_date)


def nth_operating_day_after(start: date, n: int, is_operating_day: IsOperatingDay) -> date:
    current = start
    found = 0
    while found < n:
        current += timedelta(days=1)
        if is_operating_day(current):
            found += 1
    return current


def next_operating_day(after: date, is_operating_day: IsOperatingDay) -> date:
    return nth_operating_day_after(after, 1, is_operating_day)


def earliest_delivery_date(now: datetime, is_high_priority: bool, is_operating_day: IsOperatingDay) -> date:
    """Default = 2 operating days out, High Priority = next operating day; both obey the cutoff (Q3)."""
    candidate = nth_operating_day_after(now.date(), 1 if is_high_priority else 2, is_operating_day)
    while is_past_cutoff(candidate, now):
        candidate = next_operating_day(candidate, is_operating_day)
    return candidate


def split_by_temperature(zones: Iterable[str]) -> List[str]:
    """Distinct temperature zones in a request, chilled first (Q1: one order per zone)."""
    unique = {zone for zone in zones}
    return sorted(unique, key=lambda zone: (zone != "Chilled", zone))


def duplicate_zones(
    brand: Optional[str],
    requested_zones: Iterable[str],
    existing_zones: Iterable[str],
) -> List[str]:
    """Zones that clash with orders the outlet already has for the same delivery date.

    Fresh outlets may have one chilled and one ambient order per day. Style and Tech outlets may have
    one order per day in total, so any existing order clashes.
    """
    requested = list(requested_zones)
    existing = set(existing_zones)
    if brand == "fresh":
        return [zone for zone in requested if zone in existing]
    return requested if existing else []
