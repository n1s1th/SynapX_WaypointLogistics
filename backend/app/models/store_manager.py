"""Which outlet each store manager runs. The Store Manager screens are scoped to it after login."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base


class StoreManagerAssignment(Base):
    __tablename__ = "store_manager_assignments"

    # A manager runs one outlet; an outlet can have more than one manager (e.g. shifts).
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    outlet_id = Column(Integer, ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    manager = relationship("User")
    outlet = relationship("Outlet")
