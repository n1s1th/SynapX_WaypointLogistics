"""Read the team's service_allowance.csv by brand and outlet dock type.

No fallback minutes are fabricated. A missing file or row leaves the route
unverifiable and therefore blocks allocation confirmation.
"""

import csv
import math
from pathlib import Path

from app.core.config import settings
from app.models.reference import Brand, DockType


def allowances() -> dict[tuple[Brand, DockType], float]:
    path = Path(settings.SERVICE_ALLOWANCE_CSV)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    if not path.is_file():
        return {}
    result: dict[tuple[Brand, DockType], float] = {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        for row in csv.DictReader(stream):
            if not row:
                continue
            try:
                brand = Brand((row.get("brand") or "").strip().lower())
                dock_type = DockType((row.get("dock_type") or "").strip().lower())
                minutes = float(row.get("service_allowance_min") or "")
            except (ValueError, TypeError):
                continue
            if math.isfinite(minutes) and minutes > 0:
                result[(brand, dock_type)] = minutes
    return result
