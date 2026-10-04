"""Official district-level travel reference for allocation estimates."""

import csv
import math
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.models.reference import Depot


@dataclass(frozen=True)
class DistrictTravel:
    depot_to_district_km: float
    depot_to_district_freeflow_min: float
    inter_stop_km: float
    inter_stop_freeflow_min: float


def district_travel() -> dict[tuple[Depot, str], DistrictTravel]:
    path = Path(settings.DISTRICT_TRAVEL_CSV)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    if not path.is_file():
        return {}
    result: dict[tuple[Depot, str], DistrictTravel] = {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        for row in csv.DictReader(stream):
            try:
                depot = Depot((row.get("depot") or "").strip().lower())
                district = (row.get("district") or "").strip().casefold()
                values = DistrictTravel(
                    depot_to_district_km=float(row["depot_to_district_km"]),
                    depot_to_district_freeflow_min=float(row["depot_to_district_freeflow_min"]),
                    inter_stop_km=float(row["inter_stop_km"]),
                    inter_stop_freeflow_min=float(row["inter_stop_freeflow_min"]),
                )
            except (KeyError, TypeError, ValueError):
                continue
            if district and all(math.isfinite(value) and value >= 0 for value in vars(values).values()):
                result[(depot, district)] = values
    return result
