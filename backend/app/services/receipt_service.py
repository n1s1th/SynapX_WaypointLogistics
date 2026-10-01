from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.models.receipts import DeliveryReceipt
from app.schemas.receipts import ReceiptCreateRequest
from app.services.mocks import get_order_service, get_notification_service


class ReceiptService:

    async def submit_receipt(
        self, payload: ReceiptCreateRequest, db: Session
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

        # Update order status
        order_svc = get_order_service()
        await order_svc.update_order_status(payload.order_id, "delivered")

        # Fire notification if issues were reported
        if payload.has_issues:
            notif_svc = get_notification_service()
            await notif_svc.send(
                outlet_id=payload.outlet_id,
                type="issue_reported",
                title="Delivery issue reported",
                message=f"Issue type: {payload.issue_type}. {payload.issue_description or ''}",
                order_id=payload.order_id,
            )

        return receipt

    async def sync_offline_receipts(
        self, receipts: list[ReceiptCreateRequest], db: Session
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
                await self.submit_receipt(payload, db)
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
