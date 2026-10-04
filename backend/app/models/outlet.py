from datetime import time
from sqlalchemy import ForeignKey, Integer, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.reference import Outlet


class OutletContact(Base):
    __tablename__ = "outlet_contacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    role: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(255))
    outlet: Mapped[Outlet] = relationship(back_populates="contacts")


class OutletReceivingWindow(Base):
    __tablename__ = "outlet_receiving_windows"
    __table_args__ = (UniqueConstraint("outlet_id", "weekday", "opens_at", "closes_at", name="uq_outlet_window"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # Monday=0, Sunday=6
    opens_at: Mapped[time] = mapped_column(Time, nullable=False)
    closes_at: Mapped[time] = mapped_column(Time, nullable=False)
    outlet: Mapped[Outlet] = relationship(back_populates="receiving_windows")
