"""SMTP outbox worker. Run continuously with ``python -m app.email.worker``."""

import argparse
import logging
import smtplib
import time
from datetime import timedelta
from email.message import EmailMessage

from sqlalchemy import select

from app.core.database import SessionLocal
from app.email.config import email_settings
from app.models.email_outbox import EmailOutbox, utc_now

logger = logging.getLogger(__name__)


def send_smtp(message: EmailOutbox) -> None:
    mail = EmailMessage()
    mail["From"] = email_settings.EMAIL_FROM
    mail["To"] = message.recipient
    mail["Subject"] = message.subject
    mail.set_content(message.body)
    smtp_class = smtplib.SMTP_SSL if email_settings.EMAIL_SMTP_SSL else smtplib.SMTP
    with smtp_class(email_settings.EMAIL_SMTP_HOST, email_settings.EMAIL_SMTP_PORT, timeout=20) as server:
        if email_settings.EMAIL_SMTP_STARTTLS and not email_settings.EMAIL_SMTP_SSL:
            server.starttls()
        if email_settings.EMAIL_SMTP_USERNAME:
            server.login(email_settings.EMAIL_SMTP_USERNAME, email_settings.EMAIL_SMTP_PASSWORD or "")
        server.send_message(mail)


def process_batch(limit: int | None = None) -> int:
    """Lock due messages so concurrent workers do not send the same row."""
    if not email_settings.EMAIL_ENABLED:
        return 0
    if not email_settings.EMAIL_FROM or not email_settings.EMAIL_SMTP_HOST:
        raise RuntimeError("EMAIL_FROM and EMAIL_SMTP_HOST are required when EMAIL_ENABLED=true")
    processed = 0
    with SessionLocal() as db:
        count = limit or email_settings.EMAIL_WORKER_BATCH_SIZE
        for _ in range(count):
            # PostgreSQL SKIP LOCKED lets workers share the queue. Keep the row
            # locked until SMTP accepts or rejects the message.
            message = db.execute(
                select(EmailOutbox)
                .where(EmailOutbox.status == "pending", EmailOutbox.next_attempt_at <= utc_now())
                .order_by(EmailOutbox.next_attempt_at, EmailOutbox.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            ).scalar_one_or_none()
            if message is None:
                db.rollback()
                break
            try:
                send_smtp(message)
            except Exception as exc:
                message.attempts += 1
                message.last_error = str(exc)[:2000]
                if message.attempts >= 8:
                    message.status = "failed"
                else:
                    message.next_attempt_at = utc_now() + timedelta(minutes=min(2 ** message.attempts, 60))
                logger.exception("Email outbox %s delivery failed", message.id)
            else:
                message.status = "sent"
                message.sent_at = utc_now()
                message.last_error = None
            db.commit()
            processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="Deliver queued Waypoint email")
    parser.add_argument("--once", action="store_true", help="Process one batch and exit")
    parser.add_argument("--interval", type=int, default=10, help="Polling interval in seconds")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if not email_settings.EMAIL_ENABLED:
        raise SystemExit("EMAIL_ENABLED=false; configure email before starting the worker")
    while True:
        process_batch()
        if args.once:
            return
        time.sleep(max(1, args.interval))


if __name__ == "__main__":
    main()
