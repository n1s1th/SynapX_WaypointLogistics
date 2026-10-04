"""The designated dispatcher responsible for each operational depot."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.reference import Depot


class DepotDispatcherAssignment(Base):
    __tablename__ = "depot_dispatcher_assignments"

    # A depot has one designated dispatcher; a dispatcher can operate one depot.
    depot = Column(Enum(Depot), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    assigned_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    dispatcher = relationship("User", back_populates="depot_dispatcher_assignment")
