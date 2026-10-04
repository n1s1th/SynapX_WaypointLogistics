import re
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Set
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload
from app.core.exceptions import InvalidStateTransitionError, NotFoundError, OrderRuleError
from app.models.allocation import Allocation
from app.models.fleet import DriverProfile
from app.models.notification import NotificationType
from app.models.order import Order, OrderItem, OrderStatus
from app.models.reference import Depot, Outlet
from app.schemas.order import OrderCreate
from app.schemas.store_order import GoodsRequestCreate
from app.services import order_rules
from app.services.calendar_service import calendar_service
from app.services.catalogue_service import catalogue_service, split_name
from app.services.notification_service import notification_service
from app.email.service import queue_store_change

# Statuses that hold a slot for the outlet on its delivery date (Fresh dual-order rule).
BLOCKING_STATUSES = {
    OrderStatus.SUBMITTED,
    OrderStatus.CONFIRMED,
    OrderStatus.ALLOCATED,
    OrderStatus.PROCESSING,
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.DISPATCHED,
    OrderStatus.DELIVERED,
    OrderStatus.COMPLETED,
}

# Statuses the depot is still working on (used by the loader's daily list).
ACTIVE_STATUSES = {
    OrderStatus.SUBMITTED,
    OrderStatus.CONFIRMED,
    OrderStatus.ALLOCATED,
    OrderStatus.PROCESSING,
    OrderStatus.READY_FOR_DISPATCH,
}

# Allowed lifecycle moves (docs/store-manager-contract.md §1).
TRANSITIONS: Dict[OrderStatus, Set[OrderStatus]] = {
    OrderStatus.DRAFT: {OrderStatus.SUBMITTED, OrderStatus.CANCELLED},
    OrderStatus.SUBMITTED: {OrderStatus.CONFIRMED, OrderStatus.ALLOCATED, OrderStatus.PROCESSING, OrderStatus.DEFERRED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.ALLOCATED, OrderStatus.PROCESSING, OrderStatus.DEFERRED, OrderStatus.CANCELLED},
    OrderStatus.ALLOCATED: {OrderStatus.PROCESSING, OrderStatus.DEFERRED},
    OrderStatus.PROCESSING: {OrderStatus.READY_FOR_DISPATCH, OrderStatus.DEFERRED},
    OrderStatus.READY_FOR_DISPATCH: {OrderStatus.DISPATCHED, OrderStatus.DEFERRED},
    OrderStatus.DISPATCHED: {OrderStatus.DELIVERED},
    OrderStatus.DELIVERED: {OrderStatus.COMPLETED},
    OrderStatus.DEFERRED: {OrderStatus.SUBMITTED, OrderStatus.CONFIRMED, OrderStatus.ALLOCATED, OrderStatus.CANCELLED},
    OrderStatus.COMPLETED: set(),
    OrderStatus.CANCELLED: set(),
}

# Notification sent to the store when an order reaches a status.
STATUS_NOTIFICATIONS: Dict[OrderStatus, NotificationType] = {
    OrderStatus.CONFIRMED: NotificationType.ORDER_CONFIRMED,
    OrderStatus.READY_FOR_DISPATCH: NotificationType.READY_FOR_DISPATCH,
    OrderStatus.DELIVERED: NotificationType.DELIVERED,
    OrderStatus.COMPLETED: NotificationType.ORDER_CLOSED,
}

ORDER_NUMBER = re.compile(r"^ORD(\d{7})$")


def _delivery_label(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b}"


def _window_label(start: time, end: time) -> str:
    return f"{start.strftime('%H:%M')} – {end.strftime('%H:%M')}"


def _window(outlet: Outlet) -> Optional[str]:
    if outlet.window_start and outlet.window_end:
        return _window_label(outlet.window_start, outlet.window_end)
    return None


def _requested_window(outlet: Outlet, request: GoodsRequestCreate) -> Optional[str]:
    """The delivery window for this request: the manager's choice inside the outlet window, or the whole window."""
    start, end = request.window_start, request.window_end
    if start is None and end is None:
        return _window(outlet)
    if start is None or end is None:
        raise OrderRuleError("Choose both a start and an end time for the delivery window.", code="WINDOW_INCOMPLETE")
    if start >= end:
        raise OrderRuleError("The delivery window has to end after it starts.", code="WINDOW_INVALID")
    if outlet.window_start and outlet.window_end and (start < outlet.window_start or end > outlet.window_end):
        usual = _window(outlet)
        raise OrderRuleError(
            f"Choose a window inside {outlet.name}'s receiving hours ({usual}).",
            code="WINDOW_OUTSIDE_OUTLET",
            details={"outlet_window": usual},
        )
    return _window_label(start, end)


# What the Store Manager order views read: items, the loader's shortfalls, and the delivery (allocation ->
# vehicle, driver, Dispatcher trip), loaded together so a list is a few queries, not one per order.
STORE_ORDER_LOADS = (
    selectinload(Order.items),
    selectinload(Order.loader_issues),
    selectinload(Order.allocation).selectinload(Allocation.vehicle),
    selectinload(Order.allocation).selectinload(Allocation.driver).selectinload(DriverProfile.user),
    selectinload(Order.allocation).selectinload(Allocation.dispatch_trips),
)


class OrderService:
    @staticmethod
    def create_order(db: Session, order_in: OrderCreate) -> Order:
        total_amount = order_in.total_amount or sum(item.quantity * item.unit_price for item in order_in.items)
        db_order = Order(
            order_number=order_in.order_number,
            client_name=order_in.client_name,
            destination_address=order_in.destination_address,
            status=order_in.status,
            total_amount=total_amount,
            brand=order_in.brand,
            district=order_in.district,
            temperature_zone=order_in.temperature_zone,
            delivery_window=order_in.delivery_window,
            weight_kg=order_in.weight_kg,
            is_priority=order_in.is_priority,
            is_late=order_in.is_late,
            operating_date=order_in.operating_date,
            deferral_reason=order_in.deferral_reason,
            allocation_id=order_in.allocation_id,
            depot=order_in.depot,
        )
        db.add(db_order)
        db.flush()

        for item in order_in.items:
            db_item = OrderItem(
                order_id=db_order.id,
                sku=item.sku,
                item_name=item.item_name,
                quantity=item.quantity,
                unit_price=item.unit_price,
            )
            db.add(db_item)

        db.commit()
        db.refresh(db_order)
        return db_order

    # ── Store Manager (Dev A) ─────────────────────────────────────────────

    @staticmethod
    def next_order_numbers(db: Session, count: int) -> List[str]:
        highest = 0
        for (number,) in db.query(Order.order_number).filter(Order.order_number.like("ORD%")).all():
            match = ORDER_NUMBER.match(number)
            if match:
                highest = max(highest, int(match.group(1)))
        return [f"ORD{highest + 1 + i:07d}" for i in range(count)]

    @staticmethod
    def place_order(db: Session, request: GoodsRequestCreate, now: datetime, placed_by: Optional[int] = None) -> List[Order]:
        """Validates a goods request and creates one order per temperature zone (Q1)."""
        outlet = db.query(Outlet).filter(Outlet.id == request.outlet_id).first()
        if outlet is None:
            raise NotFoundError("Outlet not found", entity="Outlet", entity_id=request.outlet_id)

        # Every line must be an item from the outlet's own chain. The catalogue decides the temperature zone
        # and supplies the per-carton weight and volume the loader plans with.
        specs = catalogue_service.items_by_sku(db, outlet, (item.sku for item in request.items))
        unavailable = sorted({item.sku for item in request.items if item.sku not in specs})
        if unavailable:
            raise OrderRuleError(
                f"{', '.join(unavailable)} {'is' if len(unavailable) == 1 else 'are'} not in {outlet.name}'s catalogue.",
                code="ITEM_NOT_AVAILABLE",
                details={"skus": unavailable},
            )
        zone_of = {item.sku: specs[item.sku].temperature_zone for item in request.items}
        delivery_window = _requested_window(outlet, request)

        delivery_date = request.delivery_date
        if not calendar_service.is_operating_day(db, delivery_date):
            suggestion = calendar_service.get_next_operating_day(db, delivery_date)
            raise OrderRuleError(
                f"There are no deliveries on {_delivery_label(delivery_date)} "
                f"({calendar_service.holiday_name(db, delivery_date)}). The next operating day is {_delivery_label(suggestion)}.",
                code="NOT_OPERATING_DAY",
                details={"suggested_date": suggestion.isoformat()},
            )
        if order_rules.is_past_cutoff(delivery_date, now):
            raise OrderRuleError(
                f"Ordering for {_delivery_label(delivery_date)} closed at 4:00 PM the day before.",
                code="CUTOFF_PASSED",
                details={"cutoff_at": order_rules.cutoff_for(delivery_date).isoformat()},
            )
        earliest = calendar_service.earliest_delivery_date(db, now, request.is_priority)
        if delivery_date < earliest:
            kind = "High priority" if request.is_priority else "Default"
            raise OrderRuleError(
                f"{kind} orders can be delivered from {_delivery_label(earliest)} at the earliest.",
                code="TOO_EARLY",
                details={"earliest_date": earliest.isoformat()},
            )

        zones = order_rules.split_by_temperature(zone_of[item.sku] for item in request.items)
        brand = outlet.brand.value if outlet.brand else None
        if brand != "fresh" and len(zones) > 1:
            raise OrderRuleError(
                "Only Fresh outlets can order chilled and ambient goods for the same day.",
                code="MIXED_ZONES_NOT_ALLOWED",
            )
        existing = (
            db.query(Order)
            .filter(
                Order.outlet_id == outlet.id,
                Order.operating_date == delivery_date.isoformat(),
                Order.status.in_(BLOCKING_STATUSES),
            )
            .all()
        )
        clashes = order_rules.duplicate_zones(brand, zones, (order.temperature_zone for order in existing))
        if clashes:
            numbers = [order.order_number for order in existing if brand != "fresh" or order.temperature_zone in clashes]
            rule = (
                "Fresh outlets can place one chilled and one ambient order per day."
                if brand == "fresh"
                else "Only one order per day is allowed."
            )
            raise OrderRuleError(
                f"You already have {', '.join(numbers)} for {_delivery_label(delivery_date)}. {rule}",
                code="DUPLICATE_ORDER",
                details={"existing_orders": numbers},
            )

        numbers = OrderService.next_order_numbers(db, len(zones))
        created: List[Order] = []
        for number, zone in zip(numbers, zones):
            lines = [item for item in request.items if zone_of[item.sku] == zone]
            order = Order(
                order_number=number,
                client_name=outlet.name,
                destination_address=f"{outlet.name}, {outlet.district}",
                depot=outlet.depot,
                status=OrderStatus.SUBMITTED,
                total_amount=sum(item.quantity * item.unit_price for item in lines),
                # Stored capitalised ("Fresh"), matching the Dispatcher's orders and filters.
                brand=brand.capitalize() if brand else None,
                district=outlet.district,
                temperature_zone=zone,
                delivery_window=delivery_window,
                weight_kg=round(sum(item.quantity * specs[item.sku].unit_weight_kg for item in lines), 2),
                volume_m3=round(sum(item.quantity * specs[item.sku].unit_volume_m3 for item in lines), 4),
                is_priority=request.is_priority,
                operating_date=delivery_date.isoformat(),
                outlet_id=outlet.id,
                units=sum(item.quantity for item in lines),
                submitted_at=now,
                cutoff_at=order_rules.cutoff_for(delivery_date),
                notes=request.notes,
                placed_by=placed_by,
                items=[
                    # The name comes from the catalogue, not the browser.
                    OrderItem(
                        sku=item.sku,
                        item_name=split_name(specs[item.sku].name)[0],
                        quantity=item.quantity,
                        unit_price=item.unit_price,
                    )
                    for item in lines
                ],
            )
            db.add(order)
            created.append(order)
        db.commit()
        for order in created:
            db.refresh(order)
            notification_service.send(
                db,
                outlet.id,
                NotificationType.ORDER_SUBMITTED,
                {"order_id": order.id, "order_number": order.order_number, "delivery_label": _delivery_label(delivery_date)},
            )
        return created

    @staticmethod
    def get_orders(
        db: Session,
        outlet_id: int,
        statuses: Optional[List[OrderStatus]] = None,
        is_priority: Optional[bool] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Order]:
        """Order history for Goods Requests (Figma 02). Dates filter on when the request was submitted."""
        query = (
            db.query(Order)
            .options(*STORE_ORDER_LOADS)
            .filter(Order.outlet_id == outlet_id)
        )
        if statuses:
            query = query.filter(Order.status.in_(statuses))
        if is_priority is not None:
            query = query.filter(Order.is_priority.is_(is_priority))
        if date_from:
            query = query.filter(Order.submitted_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.filter(Order.submitted_at <= datetime.combine(date_to, datetime.max.time()))
        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    Order.order_number.ilike(pattern),
                    Order.items.any(or_(OrderItem.item_name.ilike(pattern), OrderItem.sku.ilike(pattern))),
                )
            )
        return query.order_by(Order.submitted_at.desc(), Order.id.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def get_order_by_number(db: Session, order_number: str) -> Order:
        order = (
            db.query(Order)
            .options(*STORE_ORDER_LOADS)
            .filter(Order.order_number == order_number.upper())
            .first()
        )
        if order is None:
            raise NotFoundError("Order not found", entity="Order", entity_id=order_number)
        return order

    @staticmethod
    def _get(db: Session, order_id: int) -> Order:
        order = db.query(Order).filter(Order.id == order_id).first()
        if order is None:
            raise NotFoundError("Order not found", entity="Order", entity_id=order_id)
        return order

    @staticmethod
    def outlet_id_of(db: Session, order_id: int) -> Optional[int]:
        """The order's outlet, for access checks (raises NotFoundError for an unknown order)."""
        return OrderService._get(db, order_id).outlet_id

    @staticmethod
    def cancel_order(db: Session, order_id: int, now: datetime) -> Order:
        """Store managers can cancel until the cutoff (workplan: cancelOrder, pre-cutoff only)."""
        order = OrderService._get(db, order_id)
        if order.status not in (OrderStatus.DRAFT, OrderStatus.SUBMITTED, OrderStatus.CONFIRMED):
            raise InvalidStateTransitionError(
                f"{order.order_number} is already {order.status.value.lower().replace('_', ' ')} and can't be cancelled.",
                current_state=order.status.value,
                target_state=OrderStatus.CANCELLED.value,
            )
        if order.operating_date and order_rules.is_past_cutoff(date.fromisoformat(order.operating_date), now):
            raise OrderRuleError(
                f"{order.order_number} can no longer be cancelled — the cutoff has passed.",
                code="CUTOFF_PASSED",
            )
        order.status = OrderStatus.CANCELLED
        db.commit()
        db.refresh(order)
        return order

    @staticmethod
    def update_order_status(db: Session, order_id: int, status: OrderStatus, commit: bool = True) -> Order:
        """Contract (§3): called by the Loader, Driver and Dispatcher flows. Sends the store a notification
        for confirmed / ready for dispatch / delivered / completed."""
        order = OrderService._get(db, order_id)
        if status == order.status:
            return order
        if status not in TRANSITIONS.get(order.status, set()):
            raise InvalidStateTransitionError(
                f"{order.order_number} can't move from {order.status.value.lower()} to {status.value.lower()}.",
                current_state=order.status.value,
                target_state=status.value,
            )
        order.status = status
        if commit:
            db.commit()
            db.refresh(order)
        notification_type = STATUS_NOTIFICATIONS.get(status)
        if notification_type and order.outlet_id:
            meta = {"order_id": order.id, "order_number": order.order_number}
            if order.operating_date:
                label = _delivery_label(date.fromisoformat(order.operating_date))
                meta["delivery_label"] = f"{label}, {order.delivery_window}" if order.delivery_window else label
            notification_service.send(db, order.outlet_id, notification_type, meta)
        return order

    # ── Delivery progress from the Dispatcher's runs and the Driver app ──
    # Each moves the orders on a trip forward through update_order_status, so the store is notified. Orders
    # not at the expected step (e.g. still being loaded, or deferred) are left alone.

    @staticmethod
    def _advance(db: Session, orders: List[Order], target: OrderStatus, from_status: OrderStatus) -> List[Order]:
        moved = []
        for order in orders:
            if order.status == from_status:
                try:
                    moved.append(OrderService.update_order_status(db, order.id, target))
                except InvalidStateTransitionError:
                    db.rollback()
        return moved

    @staticmethod
    def _trip_orders(db: Session, allocation_id: Optional[int], outlet_id: Optional[int] = None) -> List[Order]:
        if allocation_id is None:
            return []
        query = db.query(Order).filter(Order.allocation_id == allocation_id)
        if outlet_id is not None:
            query = query.filter(Order.outlet_id == outlet_id)
        return query.all()

    @staticmethod
    def mark_trip_departed(db: Session, allocation_id: Optional[int]) -> List[Order]:
        """The truck left the depot: loaded orders on the trip become DISPATCHED ("On the way")."""
        orders = OrderService._trip_orders(db, allocation_id)
        return OrderService._advance(db, orders, OrderStatus.DISPATCHED, OrderStatus.READY_FOR_DISPATCH)

    @staticmethod
    def mark_trip_delivered(db: Session, allocation_id: Optional[int], outlet_id: Optional[int] = None) -> List[Order]:
        """The truck reached the store (one outlet's stop, or the whole trip): its orders become DELIVERED."""
        orders = OrderService._trip_orders(db, allocation_id, outlet_id)
        return OrderService._advance(db, orders, OrderStatus.DELIVERED, OrderStatus.DISPATCHED)

    @staticmethod
    def mark_order_delivered(db: Session, order_id: Optional[int]) -> List[Order]:
        """One order delivered (the Driver app's stop is linked to it through a shipment)."""
        if order_id is None:
            return []
        order = db.query(Order).filter(Order.id == order_id).first()
        return OrderService._advance(db, [order] if order else [], OrderStatus.DELIVERED, OrderStatus.DISPATCHED)

    @staticmethod
    def defer_order(
        db: Session,
        order_id: int,
        reason: str,
        new_delivery_date: Optional[date] = None,
        item_id: Optional[int] = None,
        item_sku: Optional[str] = None,
        quantity_sent: Optional[int] = None,
    ) -> Order:
        """Dispatcher defers an order or partially fulfills an item with stock shortfall (§6)."""
        order = OrderService._get(db, order_id)

        # Fallback outlet matching if outlet_id was not explicitly set on older/seed orders
        if not order.outlet_id and order.client_name:
            matched_outlet = db.query(Outlet).filter(
                or_(
                    Outlet.name == order.client_name,
                    Outlet.name.ilike(f"%{order.client_name}%")
                )
            ).first()
            if matched_outlet:
                order.outlet_id = matched_outlet.id

        # Find specific item if provided
        target_item = None
        if item_id or item_sku:
            if item_id:
                target_item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.order_id == order.id).first()
            elif item_sku:
                target_item = db.query(OrderItem).filter(OrderItem.sku == item_sku, OrderItem.order_id == order.id).first()

        # Check if this is a partial allocation (e.g. store requested 4, depot assigns 2)
        is_partial = target_item is not None and quantity_sent is not None and 0 < quantity_sent < target_item.quantity

        if is_partial and target_item:
            target_item.quantity_sent = quantity_sent
            target_item.dispatcher_note = reason
            order.deferral_reason = f"Partial fulfillment: {quantity_sent} of {target_item.quantity} assigned for {target_item.item_name} ({reason})"
            db.flush()
            queue_store_change(db, order, partial=True, reason=reason, item_name=target_item.item_name,
                               assigned=quantity_sent, requested=target_item.quantity)
            db.commit()
            db.refresh(order)

            if order.outlet_id:
                notification_service.send(
                    db,
                    order.outlet_id,
                    NotificationType.SHORTFALL_WARNING,
                    {
                        "order_id": order.id,
                        "order_number": order.order_number,
                        "note": f"Shortfall on {target_item.item_name} ({target_item.sku}): assigned {quantity_sent} of {target_item.quantity} units. {reason}",
                    },
                )
            return order

        # Full deferral flow
        if OrderStatus.DEFERRED not in TRANSITIONS.get(order.status, set()):
            raise InvalidStateTransitionError(
                f"{order.order_number} can't be deferred while {order.status.value.lower()}.",
                current_state=order.status.value,
                target_state=OrderStatus.DEFERRED.value,
            )
        order.status = OrderStatus.DEFERRED

        if target_item:
            target_item.quantity_sent = 0
            target_item.dispatcher_note = f"Deferred: {reason}"
            reason = f"Depot low stock on {target_item.item_name} ({target_item.sku}): {reason}"

        order.deferral_reason = reason
        order.allocation_id = None
        order.deferral_count = (order.deferral_count or 0) + 1
        if new_delivery_date:
            order.operating_date = new_delivery_date.isoformat()
            order.cutoff_at = order_rules.cutoff_for(new_delivery_date)

        db.flush()
        queue_store_change(db, order, partial=False, reason=reason)
        db.commit()
        db.refresh(order)
        if order.outlet_id:
            notification_service.send(
                db,
                order.outlet_id,
                NotificationType.DEFERRED,
                {
                    "order_id": order.id,
                    "order_number": order.order_number,
                    "reason": reason,
                    "new_delivery_label": _delivery_label(new_delivery_date) if new_delivery_date else None,
                },
            )
        return order

    @staticmethod
    def get_orders_by_date(db: Session, day: date, depot: Depot) -> List[Order]:
        """Contract (§3): the loader builds its loading lists from this."""
        return (
            db.query(Order)
            .options(*STORE_ORDER_LOADS)
            .join(Outlet, Order.outlet_id == Outlet.id)
            .filter(
                Order.operating_date == day.isoformat(),
                Outlet.depot == depot,
                Order.status.in_(ACTIVE_STATUSES),
            )
            .order_by(Order.is_priority.desc(), Order.id)
            .all()
        )


order_service = OrderService()
