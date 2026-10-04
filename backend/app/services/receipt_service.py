from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.models.receipts import DeliveryReceipt
from app.models.delivery_issue import DeliveryIssue
from app.models.order import Order, OrderStatus
from app.models.notification import NotificationType
from app.schemas.receipts import ReceiptCreateRequest
from app.services.order_service import order_service
from app.services.notification_service import notification_service


class ReceiptService:

    async def submit_receipt(
        self, payload: ReceiptCreateRequest, db: Session, reported_by: str = "Store Manager"
    ) -> DeliveryReceipt:
        # Check for existing receipt (prevent duplicate)
        existing = db.execute(
            select(DeliveryReceipt).where(
                DeliveryReceipt.order_id == payload.order_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="Receipt already submitted for this order",
            )

        # Goods can only be received once they've left the depot (the run went en route / the driver started).
        order = db.query(Order).filter(Order.id == payload.order_id).first()
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found")
        if order.status not in (OrderStatus.DISPATCHED, OrderStatus.DELIVERED):
            raise HTTPException(
                status_code=409,
                detail=f"{order.order_number} hasn't left the depot yet ({order.status.value.lower().replace('_', ' ')}), "
                "so there's nothing to receive.",
            )

        receipt = DeliveryReceipt(
            order_id=payload.order_id,
            outlet_id=payload.outlet_id,
            units_received=payload.units_received,
            weight_received_kg=payload.weight_received_kg,
            has_issues=payload.has_issues,
            issue_type=payload.issue_type,
            issue_description=payload.issue_description,
            confirmed_at=payload.confirmed_at,
            synced_from_offline=payload.synced_from_offline,
        )
        db.add(receipt)

        try:
            db.commit()
            db.refresh(receipt)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail="Receipt already submitted for this order",
            )

        # Receipt confirmation is the final step: (dispatched ->) delivered -> completed, notifying the store.
        if order.status == OrderStatus.DISPATCHED:
            order_service.update_order_status(db, payload.order_id, OrderStatus.DELIVERED)
        order_service.update_order_status(db, payload.order_id, OrderStatus.COMPLETED)

        # Record delivery issue and fire notification if issues were reported
        if payload.has_issues:
            order_number = f"ORD{payload.order_id:07d}"
            try:
                order = order_service._get(db, payload.order_id)
                if order and order.order_number:
                    order_number = order.order_number
            except Exception:
                pass

            issue_type_formatted = (payload.issue_type or "Discrepancy").replace("_", " ").title()

            # Prevent duplicate issue creation if frontend/intake already created per-item issues
            existing_issue = db.execute(
                select(DeliveryIssue).where(DeliveryIssue.order_id == payload.order_id)
            ).scalars().first()

            if not existing_issue:
                delivery_issue = DeliveryIssue(
                    order_id=payload.order_id,
                    order_number=order_number,
                    outlet_id=payload.outlet_id,
                    issue_type=issue_type_formatted,
                    title=f"Delivery Discrepancy on {order_number} ({issue_type_formatted})",
                    received_units=payload.units_received,
                    description=payload.issue_description or f"Discrepancy reported on receipt confirmation ({payload.issue_type}).",
                    reported_by=reported_by,
                    status="open",
                )
                db.add(delivery_issue)
                try:
                    db.commit()
                except Exception:
                    db.rollback()

            notification_service.send(
                db,
                outlet_id=payload.outlet_id,
                type=NotificationType.ISSUE_LOGGED,
                meta={
                    "order_id": payload.order_id,
                    "issue_code": payload.issue_type or "ISSUE",
                    "note": f"Issue type: {payload.issue_type}. {payload.issue_description or ''}".strip(),
                },
            )

        return receipt

    async def sync_offline_receipts(
        self, receipts: list[ReceiptCreateRequest], db: Session, reported_by: str = "Store Manager"
    ) -> dict:
        synced = 0
        skipped = 0

        for payload in receipts:
            # Check for existing
            existing = db.execute(
                select(DeliveryReceipt).where(
                    DeliveryReceipt.order_id == payload.order_id
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            try:
                await self.submit_receipt(payload, db, reported_by)
                synced += 1
            except Exception:
                skipped += 1

        return {"synced": synced, "skipped": skipped}

    async def get_receipt_by_order(
        self, order_id: int, db: Session
    ) -> DeliveryReceipt | None:
        result = db.execute(
            select(DeliveryReceipt).where(DeliveryReceipt.order_id == order_id)
        )
        return result.scalar_one_or_none()
