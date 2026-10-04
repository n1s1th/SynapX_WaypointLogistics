"""Queue email in the same transaction as the operational event."""

import logging
from hashlib import sha256

from sqlalchemy.orm import Session

from app.email.config import email_settings
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.driver import DriverTrip
from app.models.email_outbox import EmailOutbox
from app.models.fleet import DriverProfile, Vehicle
from app.models.order import Order
from app.models.outlet import OutletContact
from app.models.outlet_settings import OutletSettings
from app.models.reference import Depot
from app.models.shipment import DispatchTrip
from app.models.user import User, UserRole
from app.services.user_notification_service import notify_role

logger = logging.getLogger(__name__)


def queue(db: Session, *, key: str, kind: str, recipient: str | None, subject: str, body: str) -> None:
    """Add one durable message. Caller owns commit/rollback and event idempotency."""
    if not email_settings.EMAIL_ENABLED:
        return
    if not recipient:
        logger.warning("Email %s has no configured recipient", key)
        return
    if db.query(EmailOutbox.id).filter(EmailOutbox.event_key == key).first():
        return
    db.add(EmailOutbox(event_key=key, kind=kind, recipient=recipient.strip(), subject=subject, body=body))
    db.flush()


def dispatcher_email(db: Session, depot: Depot | str | None) -> str | None:
    try:
        resolved = depot if isinstance(depot, Depot) else Depot(str(depot).strip().lower())
    except (ValueError, TypeError):
        return None
    return (
        db.query(User.email)
        .join(DepotDispatcherAssignment, DepotDispatcherAssignment.user_id == User.id)
        .filter(DepotDispatcherAssignment.depot == resolved, User.role == UserRole.DISPATCHER, User.is_active.is_(True))
        .scalar()
    )


def trip_depot(db: Session, trip: DispatchTrip | None) -> Depot | None:
    if trip is None:
        return None
    name = trip.depot_name
    if not name and trip.vehicle_id:
        vehicle = db.get(Vehicle, trip.vehicle_id)
        name = vehicle.depot_name if vehicle else None
    try:
        return Depot(name.strip().lower()) if name else None
    except ValueError:
        return None


def driver_depot(db: Session, driver_id: int) -> Depot | None:
    profile = db.query(DriverProfile).filter(DriverProfile.user_id == driver_id).first()
    if profile and profile.vehicle:
        try:
            return Depot(profile.vehicle.depot_name.strip().lower())
        except ValueError:
            pass
    latest_trip = (
        db.query(DriverTrip)
        .filter(DriverTrip.driver_id == driver_id)
        .order_by(DriverTrip.created_at.desc(), DriverTrip.id.desc())
        .first()
    )
    if latest_trip:
        depot = trip_depot(db, latest_trip.dispatch_trip)
        if depot:
            return depot
    return None


def store_email(db: Session, order: Order) -> str | None:
    if not order.outlet_id:
        return None
    settings = db.query(OutletSettings).filter(OutletSettings.outlet_id == order.outlet_id).first()
    if settings and not settings.email_alerts_issues:
        return None
    if settings and settings.store_manager_user_id:
        manager = db.get(User, settings.store_manager_user_id)
        if manager and manager.is_active:
            return manager.email
    if order.placed_by:
        user = db.get(User, order.placed_by)
        if user and user.role == UserRole.STORE_MANAGER and user.is_active:
            return user.email
    contact = (
        db.query(OutletContact)
        .filter(OutletContact.outlet_id == order.outlet_id, OutletContact.email.isnot(None),
                OutletContact.role.ilike("%manager%"))
        .order_by(OutletContact.id)
        .first()
    )
    return contact.email if contact else None


def queue_loader_issue(db: Session, issue) -> None:
    depot = issue.run.dock.depot
    notify_role(
        db, role=UserRole.DISPATCHER, depot=depot, event_key=f"loader-issue:{issue.id}",
        category="issue", title=f"Loading decision needed: {issue.order.order_number}",
        message=f"Run {issue.run.code}: {issue.issue_type.value.replace('_', ' ')}. Review the loading flag before departure.",
        target_url="/dispatcher/exceptions",
    )
    queue(
        db, key=f"loader-issue:{issue.id}", kind="loader_issue",
        recipient=dispatcher_email(db, depot),
        subject=f"Loading decision needed: {issue.order.order_number}",
        body=(f"Run {issue.run.code}: {issue.issue_type.value.replace('_', ' ')} on {issue.order.order_number}.\n"
              f"Affected units: {issue.units_affected} of {issue.units_total}.\n"
              f"Details: {issue.note or issue.quick_note_tag or 'No note supplied.'}\n"
              "Open Dispatcher Exceptions to review the issue and decide before departure."),
    )


def queue_driver_issue(db: Session, issue) -> None:
    trip = issue.driver_trip.dispatch_trip
    depot = trip_depot(db, trip) or driver_depot(db, issue.driver_trip.driver_id)
    notify_role(
        db, role=UserRole.DISPATCHER, depot=depot, event_key=f"driver-issue:{issue.id}",
        category="issue", title=f"Driver issue: {issue.issue_type.value.replace('_', ' ')}",
        message=f"Trip {trip.trip_code if trip else 'unknown'}: {issue.description}",
        target_url="/dispatcher/exceptions",
    )
    queue(
        db, key=f"driver-issue:{issue.id}", kind="driver_issue",
        recipient=dispatcher_email(db, depot),
        subject=f"Driver issue: {issue.issue_type.value.replace('_', ' ')}",
        body=(f"Trip: {trip.trip_code if trip else 'Unknown'}\n"
              f"Stop: {issue.stop_id or 'Not specified'}\n"
              f"Details: {issue.description}\nOpen Dispatcher Exceptions to review."),
    )


def queue_sos(db: Session, alert) -> None:
    trip = alert.driver_trip.dispatch_trip if alert.driver_trip else None
    depot = trip_depot(db, trip) or driver_depot(db, alert.driver_id)
    notify_role(
        db, role=UserRole.DISPATCHER, depot=depot, event_key=f"driver-sos:{alert.id}",
        category="urgent", title=f"Driver SOS: {trip.trip_code if trip else 'unlinked trip'}",
        message=alert.message or "A driver requested immediate help.", target_url="/dispatcher/exceptions",
    )
    notify_role(
        db, role=UserRole.ADMIN, event_key=f"driver-sos:{alert.id}", category="urgent",
        title=f"Driver SOS: {trip.trip_code if trip else 'unlinked trip'}",
        message=alert.message or "A driver requested immediate help.", target_url="/admin",
    )
    driver = db.get(User, alert.driver_id)
    location = (f"{alert.latitude}, {alert.longitude}" if alert.latitude is not None and alert.longitude is not None else "Not supplied")
    recipient = dispatcher_email(db, depot)
    recipients = [recipient] if recipient else [email for (email,) in (
        db.query(User.email)
        .join(DepotDispatcherAssignment, DepotDispatcherAssignment.user_id == User.id)
        .filter(User.role == UserRole.DISPATCHER, User.is_active.is_(True))
        .all()
    )]
    if not recipient:
        logger.warning("SOS %s has no resolvable depot; alerting all assigned dispatchers", alert.id)
    for email in recipients:
        queue(
            db, key=f"driver-sos:{alert.id}:{sha256(email.encode()).hexdigest()[:16]}", kind="driver_sos",
            recipient=email,
            subject=f"URGENT: driver SOS — {trip.trip_code if trip else 'unlinked trip'}",
            body=(f"Driver: {driver.full_name if driver else alert.driver_id}\n"
                  f"Trip: {trip.trip_code if trip else 'Not linked'}\nLocation: {location}\n"
                  f"Message: {alert.message or 'No message supplied.'}\n"
                  "Contact the driver immediately and review Dispatcher Exceptions."),
        )


def queue_store_change(db: Session, order: Order, *, partial: bool, reason: str, item_name: str | None = None, assigned: int | None = None, requested: int | None = None) -> None:
    kind = "partial_shortfall" if partial else "order_deferred"
    detail = (f"{item_name}: {assigned} of {requested} units assigned." if partial else
              f"New delivery date: {order.operating_date or 'To be confirmed'}.")
    queue(
        db, key=f"{kind}:{order.id}:{order.updated_at.isoformat() if order.updated_at else order.deferral_count}",
        kind=kind, recipient=store_email(db, order),
        subject=f"{order.order_number}: {'partial quantity' if partial else 'delivery deferred'}",
        body=(f"Your order {order.order_number} has been {'partially allocated' if partial else 'deferred'}.\n"
              f"{detail}\nReason: {reason}\nOpen your store portal for the latest order details."),
    )
