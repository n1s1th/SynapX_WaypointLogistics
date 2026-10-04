"""Private, durable in-app inbox entries for Keycloak/local users.

The existing outlet notifications remain the store-manager shared outlet feed.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserNotification(Base):
    __tablename__ = "user_notifications"
    __table_args__ = (
        UniqueConstraint("recipient_user_id", "event_key", name="uq_user_notifications_recipient_event"),
        Index("ix_user_notifications_recipient_created", "recipient_user_id", "created_at"),
        Index("ix_user_notifications_recipient_read", "recipient_user_id", "read_at"),
    )

    id = Column(Integer, primary_key=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_key = Column(String(200), nullable=False)
    category = Column(String(40), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    target_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)

    recipient = relationship("User")
