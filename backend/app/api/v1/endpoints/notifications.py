from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api import deps
from app.core.exceptions import NotFoundError
from app.models.notification import Notification, NotificationCategory
from app.models.reference import Outlet
from app.models.user import User
from app.schemas.notification import NotificationRead, NotificationsMarkedRead, UserNotificationPage, UserNotificationRead
from app.services.notification_service import notification_service
from app.services import user_notification_service
from app.models.user_notification import UserNotification

# Store Manager notifications (Figma 10, contract §5).
router = APIRouter()


@router.get("/inbox", response_model=UserNotificationPage)
def user_inbox(
    unread: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    items = user_notification_service.list_for_user(db, current_user.id, unread_only=unread, limit=limit)
    unread_count = db.query(UserNotification).filter(
        UserNotification.recipient_user_id == current_user.id, UserNotification.read_at.is_(None)
    ).count()
    return {"items": items, "unread_count": unread_count}


@router.patch("/inbox/{notification_id}/read", response_model=UserNotificationRead)
def read_user_notification(
    notification_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    notification = user_notification_service.mark_read(db, current_user.id, notification_id)
    if notification is None:
        raise NotFoundError("Notification not found", entity="UserNotification", entity_id=notification_id)
    return notification


@router.post("/inbox/read-all", response_model=NotificationsMarkedRead)
def read_all_user_notifications(
    db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)
):
    return {"updated": user_notification_service.mark_all_read(db, current_user.id)}


@router.get("/", response_model=List[NotificationRead])
def list_notifications(
    outlet: Outlet = Depends(deps.get_store_outlet),
    category: Optional[NotificationCategory] = None,
    unread: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(deps.get_db),
):
    return notification_service.list_for_outlet(db, outlet.id, category, unread, limit)


@router.patch("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: int, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)
):
    notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if notification is None:
        raise NotFoundError("Notification not found", entity="Notification", entity_id=notification_id)
    deps.ensure_store_access(db, current_user, notification.outlet_id)
    return notification_service.mark_read(db, notification_id)


@router.post("/read-all", response_model=NotificationsMarkedRead)
def mark_all_notifications_read(outlet: Outlet = Depends(deps.get_store_outlet), db: Session = Depends(deps.get_db)):
    return {"updated": notification_service.mark_all_read(db, outlet.id)}
