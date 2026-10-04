"""Approximate map positions for the driver's route map.

outlets.csv has no coordinates: only district, dock type, parking rule and
delivery window. Travel in the brief is modelled per district
(district_travel.csv). So each outlet is placed near its district's main town,
at a fixed offset derived from its code: the same outlet always lands on the
same spot, and the app labels these positions as approximate.

Coastal districts keep their offsets inland, so no pin lands in the sea.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Optional, Tuple

KM_PER_DEGREE_LAT = 111.32


@dataclass(frozen=True)
class District:
    latitude: float
    longitude: float
    # Bearings (degrees clockwise from north) the offsets may use: start and span.
    # The full circle for inland towns; a half circle pointing inland on the coast.
    bearing_start: float = 0.0
    bearing_span: float = 360.0


# The 12 districts in the outlets table, at (or just inland of) the main town.
DISTRICTS = {
    # Peliyagoda depot
    "Colombo": District(6.9020, 79.8740, 0, 180),  # sea to the west
    "Gampaha": District(7.0873, 80.0144),
    "Kalutara": District(6.5900, 79.9800, 0, 180),  # sea to the west
    "Galle": District(6.0670, 80.2400, 0, 90),  # sea to the south and west
    "Matara": District(5.9700, 80.5500, 300, 120),  # sea to the south
    "Kurunegala": District(7.4863, 80.3647),
    "Puttalam": District(8.0330, 79.8400, 0, 180),  # lagoon to the west
    # Kandy hub
    "Kandy": District(7.2906, 80.6337),
    "Matale": District(7.4675, 80.6234),
    "Nuwara Eliya": District(6.9497, 80.7891),
    "Badulla": District(6.9934, 81.0550),
    "Kegalle": District(7.2513, 80.3464),
}


@dataclass(frozen=True)
class Place:
    name: str
    latitude: float
    longitude: float


DEPOTS = {
    "peliyagoda": Place("Peliyagoda distribution centre", 6.9640, 79.8860),
    "kandy": Place("Kandy regional hub", 7.2780, 80.6050),
}

MIN_OFFSET_KM = 0.8
MAX_OFFSET_KM = 3.0


def depot_place(depot: Optional[str]) -> Place:
    """The depot a vehicle runs from; Peliyagoda when unknown."""
    key = (depot or "").strip().lower()
    return DEPOTS.get(key, DEPOTS["peliyagoda"])


def _fractions(code: str) -> Tuple[float, float]:
    digest = hashlib.sha256(code.encode("utf-8")).digest()
    first = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    second = int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF
    return first, second


def offset(latitude: float, longitude: float, bearing_deg: float, distance_km: float) -> Tuple[float, float]:
    """A point distance_km away on the given bearing (flat-earth; fine at this scale)."""
    bearing = math.radians(bearing_deg)
    d_lat = distance_km * math.cos(bearing) / KM_PER_DEGREE_LAT
    d_lng = distance_km * math.sin(bearing) / (KM_PER_DEGREE_LAT * math.cos(math.radians(latitude)))
    return round(latitude + d_lat, 6), round(longitude + d_lng, 6)


def approx_outlet_location(code: str, district: Optional[str], depot: Optional[str] = None) -> Tuple[float, float]:
    """Where to pin an outlet: its district town plus a fixed, code-derived offset.

    An unknown district falls back to the outlet's depot, so the pin still lands
    in the right part of the country.
    """
    area = DISTRICTS.get((district or "").strip())
    if area is None:
        base = depot_place(depot)
        area = District(base.latitude, base.longitude)
    angle_fraction, distance_fraction = _fractions(code)
    bearing = (area.bearing_start + angle_fraction * area.bearing_span) % 360
    distance = MIN_OFFSET_KM + distance_fraction * (MAX_OFFSET_KM - MIN_OFFSET_KM)
    return offset(area.latitude, area.longitude, bearing, distance)


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Great-circle distance in kilometres between two (lat, lng) points."""
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))
