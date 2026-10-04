from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from app.core.database import Base


def utc_now() -> datetime:
    # The app's DateTime columns use UTC without a database time zone.
    return datetime.now(UTC).replace(tzinfo=None)


class EmailOutbox(Base):
    __tablename__ = "email_outbox"
    __table_args__ = (Index("ix_email_outbox_status_next_attempt", "status", "next_attempt_at"),)

    id = Column(Integer, primary_key=True)
    event_key = Column(String(160), nullable=False, unique=True)
    kind = Column(String(60), nullable=False)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime, nullable=False, default=utc_now)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    sent_at = Column(DateTime, nullable=True)
