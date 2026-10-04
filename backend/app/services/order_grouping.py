"""Depot-scoped candidate groups and selected-order validation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.models.order import Order, OrderStatus
from app.models.reference import Brand, Depot, Outlet
from app.services.outlet_access import outlet_requires_van

ELIGIBLE_ORDER_STATUSES = (OrderStatus.SUBMITTED, OrderStatus.CONFIRMED)


def _brand(order: Order) -> Brand | None:
    # Mirrors LoaderService._order_brand: the order's brand takes precedence.
    if order.brand:
        try:
            return Brand(order.brand.strip().lower())
        except ValueError:
            pass
    return order.outlet.brand if order.outlet is not None else None


def _day(order: Order) -> date | None:
    try:
        return date.fromisoformat(order.operating_date) if order.operating_date else None
    except ValueError:
        return None


@dataclass
class OrderGroup:
    orders: list[Order]
    depot: Depot
    brand: Brand | None
    district: str | None
    operating_date: date | None
    required_temperature: str
    total_weight_kg: float | None
    total_volume_m3: float | None
    outlet_count: int
    violations: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        van_only_outlets = sorted({order.outlet.code for order in self.orders
                                   if order.outlet is not None and outlet_requires_van(order.outlet)})
        return {
            "order_ids": [order.id for order in self.orders],
            "depot": self.depot.value,
            "brand": self.brand.value if self.brand else None,
            "district": self.district,
            "operating_date": self.operating_date.isoformat() if self.operating_date else None,
            "total_weight_kg": self.total_weight_kg,
            "total_volume_m3": self.total_volume_m3,
            "required_temperature": self.required_temperature,
            "outlet_count": self.outlet_count,
            "required_vehicle_type": "van" if van_only_outlets else None,
            "van_only_outlets": van_only_outlets,
        }


class OrderGroupingService:
    @staticmethod
    def load_selected(db: Session, order_ids: list[int], depot: Depot, *, lock: bool = False) -> OrderGroup:
        query = db.query(Order).options(
            selectinload(Order.outlet).selectinload(Outlet.receiving_windows)
        ).filter(Order.id.in_(order_ids), Order.depot == depot).order_by(Order.id)
        if lock:
            query = query.with_for_update(of=Order)
        orders = query.all()
        group = OrderGroupingService.from_orders(orders, depot)
        if len(orders) != len(order_ids):
            group.violations.insert(0, {
                "constraint": "ORDER_SCOPE", "message": "One or more orders do not exist in this depot."
            })
        return group

    @staticmethod
    def from_orders(orders: list[Order], depot: Depot) -> OrderGroup:
        violations: list[dict] = []
        brands = {_brand(order) for order in orders}
        days = {_day(order) for order in orders}
        districts = {order.outlet.district if order.outlet is not None else order.district for order in orders}
        zones = {(order.temperature_class.value if order.temperature_class else (order.temperature_zone or "").strip().lower()) for order in orders}
        for order in orders:
            if order.status not in ELIGIBLE_ORDER_STATUSES or order.allocation_id is not None:
                violations.append({"constraint": "ORDER_STATUS", "order_id": order.id,
                                   "message": f"{order.order_number} is not an unallocated submitted or confirmed order."})
            if order.is_late:
                violations.append({"constraint": "LATE_ORDER", "order_id": order.id,
                                   "message": f"{order.order_number} is late and needs explicit rescheduling."})
            if order.outlet is None:
                violations.append({"constraint": "OUTLET", "order_id": order.id,
                                   "message": f"{order.order_number} has no outlet."})
            elif order.outlet.depot != depot:
                violations.append({"constraint": "OUTLET_DEPOT", "order_id": order.id,
                                   "message": f"{order.order_number}'s outlet belongs to another depot."})
            if order.weight_kg is None or order.weight_kg <= 0 or order.volume_m3 is None or order.volume_m3 <= 0:
                violations.append({"constraint": "ORDER_MEASUREMENTS", "order_id": order.id,
                                   "message": f"{order.order_number} needs recorded positive weight and volume."})
            if _brand(order) is None:
                violations.append({"constraint": "BRAND", "order_id": order.id,
                                   "message": f"{order.order_number} has no valid brand."})
            if _day(order) is None:
                violations.append({"constraint": "OPERATING_DATE", "order_id": order.id,
                                   "message": f"{order.order_number} needs a valid operating date."})
        if len(brands) > 1:
            violations.append({"constraint": "MIXED_BRANDS", "message": "A loader run must carry one brand."})
        if len(days) > 1:
            violations.append({"constraint": "MIXED_DATES", "message": "Orders on one allocation must share an operating date."})
        if len(districts) > 1:
            violations.append({"constraint": "MIXED_DISTRICTS", "message": "The district travel reference requires orders in one allocation to share a district."})
        if any(zone not in {"ambient", "chilled"} for zone in zones):
            violations.append({"constraint": "TEMPERATURE", "message": "Every order needs an ambient or chilled temperature class."})
        return OrderGroup(
            orders=orders, depot=depot, brand=next(iter(brands)) if len(brands) == 1 else None,
            district=next(iter(districts)) if len(districts) == 1 else None,
            operating_date=next(iter(days)) if len(days) == 1 else None,
            required_temperature="chilled" if "chilled" in zones else ("ambient" if zones == {"ambient"} else "unknown"),
            total_weight_kg=round(sum(order.weight_kg for order in orders), 2) if orders and all(order.weight_kg is not None and order.weight_kg > 0 for order in orders) else None,
            total_volume_m3=round(sum(order.volume_m3 for order in orders), 3) if orders and all(order.volume_m3 is not None and order.volume_m3 > 0 for order in orders) else None,
            outlet_count=len({order.outlet_id for order in orders if order.outlet_id is not None}),
            violations=violations,
        )

    @staticmethod
    def candidate_groups(db: Session, depot: Depot, operating_date: date | None = None) -> list[OrderGroup]:
        query = db.query(Order).options(selectinload(Order.outlet)).filter(
            Order.depot == depot, Order.status.in_(ELIGIBLE_ORDER_STATUSES),
            Order.allocation_id.is_(None), Order.is_late.is_(False),
        )
        if operating_date is not None:
            query = query.filter(Order.operating_date == operating_date.isoformat())
        buckets: dict[tuple, list[Order]] = {}
        for order in query.order_by(Order.id).all():
            if order.outlet is None or _brand(order) is None or _day(order) is None:
                continue
            key = (order.operating_date, _brand(order), order.outlet.district)
            buckets.setdefault(key, []).append(order)
        return [OrderGroupingService.from_orders(orders, depot) for orders in buckets.values()]


order_grouping_service = OrderGroupingService()
