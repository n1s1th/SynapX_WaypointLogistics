"""Structured outlet vehicle-access requirements shared by planning checks."""

from app.models.reference import Outlet


def outlet_requires_van(outlet: Outlet) -> bool:
    return bool(outlet.van_only) or (outlet.parking_constraint or "").strip().casefold() == "van_only"
