from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, Text, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class DeliveryReceipt(Base):
    __tablename__ = "delivery_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("orders.id"),
        nullable=False,
        unique=True,       # one receipt per order
        index=True,
    )
    outlet_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("outlets.id"),
        nullable=False,
    )
    units_received: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_received_kg: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    has_issues: Mapped[bool] = mapped_column(Boolean, default=False)
    # short_delivery | damaged | wrong_items | other
    issue_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    issue_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_from_offline: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    order = relationship("Order", back_populates="receipt")
    outlet = relationship("Outlet")
