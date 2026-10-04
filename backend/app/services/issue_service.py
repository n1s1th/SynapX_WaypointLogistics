from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, select
from fastapi import HTTPException
from app.models.delivery_issue import DeliveryIssue
from app.models.notification import NotificationType
from app.models.order import Order
from app.schemas.delivery_issue import DeliveryIssueCreate, DeliveryIssueUpdate
from app.schemas.store_order import summarise_delivery
from app.services.notification_service import notification_service
from app.services.user_notification_service import notify_role
from app.models.user import UserRole


class IssueService:
    @staticmethod
    def get_issues(
        db: Session,
        outlet_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100,
    ) -> List[DeliveryIssue]:
        query = db.query(DeliveryIssue)
        if outlet_id is not None:
            query = query.filter(DeliveryIssue.outlet_id == outlet_id)
        if status and status != "all":
            query = query.filter(DeliveryIssue.status == status)
        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    DeliveryIssue.title.ilike(pattern),
                    DeliveryIssue.order_number.ilike(pattern),
                    DeliveryIssue.affected_item.ilike(pattern),
                    DeliveryIssue.sku.ilike(pattern),
                    DeliveryIssue.description.ilike(pattern),
                )
            )
        return query.order_by(DeliveryIssue.reported_at.desc(), DeliveryIssue.id.desc()).limit(limit).all()

    @staticmethod
    def get_issue(db: Session, issue_id: int) -> DeliveryIssue:
        issue = db.query(DeliveryIssue).filter(DeliveryIssue.id == issue_id).first()
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found")
        return issue

    @staticmethod
    def create_issue(db: Session, payload: DeliveryIssueCreate) -> DeliveryIssue:
        # Fill the order number, driver and vehicle from the order when the form only sent its id.
        order = db.query(Order).filter(Order.id == payload.order_id).first() if payload.order_id else None
        if order is not None and payload.outlet_id is not None and order.outlet_id != payload.outlet_id:
            raise HTTPException(status_code=403, detail="That order belongs to another outlet.")
        delivery = summarise_delivery(order.allocation) if order is not None else None
        issue = DeliveryIssue(
            order_id=payload.order_id,
            order_number=payload.order_number or (order.order_number if order else None),
            outlet_id=payload.outlet_id,
            issue_type=payload.issue_type,
            title=payload.title,
            affected_item=payload.affected_item,
            sku=payload.sku,
            expected_units=payload.expected_units,
            received_units=payload.received_units,
            description=payload.description,
            photo_url=payload.photo_url,
            photo_name=payload.photo_name,
            photo_size=payload.photo_size,
            reported_by=payload.reported_by or "Store Manager",
            driver_name=payload.driver_name or (delivery.driver_name if delivery else None),
            vehicle_id=payload.vehicle_id or (delivery.vehicle_code if delivery else None),
            claimed_amount=payload.claimed_amount,
            status="open",
        )
        db.add(issue)
        db.flush()
        notify_role(
            db, role=UserRole.DISPATCHER, depot=order.depot if order else None,
            event_key=f"store-issue:{issue.id}", category="issue",
            title=f"Store issue: {issue.order_number or issue.title}",
            message=issue.description, target_url="/dispatcher/exceptions",
        )
        db.commit()
        db.refresh(issue)
        if issue.outlet_id is not None:
            notification_service.send(
                db,
                issue.outlet_id,
                NotificationType.ISSUE_LOGGED,
                {"order_id": issue.order_id, "issue_code": f"ISS{issue.id:07d}", "note": issue.title},
            )
        return issue

    @staticmethod
    def update_issue(db: Session, issue_id: int, payload: DeliveryIssueUpdate) -> DeliveryIssue:
        issue = IssueService.get_issue(db, issue_id)
        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(issue, key, value)
        db.commit()
        db.refresh(issue)
        return issue

    @staticmethod
    def delete_issue(db: Session, issue_id: int) -> None:
        issue = IssueService.get_issue(db, issue_id)
        db.delete(issue)
        db.commit()


issue_service = IssueService()
