"""Queue in-app notifications in the caller's transaction.

One entry per recipient gives every user independent read state. Producers use a
stable event key so retries do not create duplicate messages.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.reference import Depot
from app.models.user import User, UserRole
from app.models.user_notification import UserNotification


def notify_user(
    db: Session, *, recipient_user_id: int, event_key: str, category: str,
    title: str, message: str, target_url: str | None = None,
) -> UserNotification | None:
    """Stage a notification; the operational caller owns commit and rollback."""
    event_key = event_key[:200]
    if db.query(UserNotification.id).filter_by(recipient_user_id=recipient_user_id, event_key=event_key).first():
        return None
    notification = UserNotification(
        recipient_user_id=recipient_user_id, event_key=event_key, category=category[:40],
        title=title[:200], message=message, target_url=target_url,
    )
    db.add(notification)
    db.flush()
    return notification


def notify_role(
    db: Session, *, role: UserRole, event_key: str, category: str,
    title: str, message: str, target_url: str | None = None, depot: Depot | None = None,
) -> int:
    """Fan out to active users, optionally limited to assigned dispatchers at a depot."""
    query = db.query(User.id).filter(User.role == role, User.is_active.is_(True))
    if depot is not None:
        if role != UserRole.DISPATCHER:
            raise ValueError("Depot routing is only defined for dispatchers")
        query = query.join(DepotDispatcherAssignment, DepotDispatcherAssignment.user_id == User.id).filter(
            DepotDispatcherAssignment.depot == depot
        )
    count = 0
    for (user_id,) in query.all():
        if notify_user(db, recipient_user_id=user_id, event_key=event_key, category=category,
                       title=title, message=message, target_url=target_url):
            count += 1
    return count


def list_for_user(db: Session, user_id: int, *, unread_only: bool = False, limit: int = 50) -> list[UserNotification]:
    query = db.query(UserNotification).filter(UserNotification.recipient_user_id == user_id)
    if unread_only:
        query = query.filter(UserNotification.read_at.is_(None))
    return query.order_by(UserNotification.created_at.desc(), UserNotification.id.desc()).limit(limit).all()


def mark_read(db: Session, user_id: int, notification_id: int) -> UserNotification | None:
    notification = db.query(UserNotification).filter_by(id=notification_id, recipient_user_id=user_id).first()
    if notification is None:
        return None
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_read(db: Session, user_id: int) -> int:
    updated = db.query(UserNotification).filter(
        UserNotification.recipient_user_id == user_id, UserNotification.read_at.is_(None)
    ).update({UserNotification.read_at: datetime.now(timezone.utc)}, synchronize_session=False)
    db.commit()
    return updated
