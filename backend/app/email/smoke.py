"""Send clearly marked sample emails to EMAIL_USER without changing operations data.

Run: python -m app.email.smoke --send
"""

import argparse
from uuid import uuid4

from app.email.config import email_settings
from app.email.worker import send_smtp
from app.models.email_outbox import EmailOutbox

SAMPLES = (
    ("driver_sos", "Driver SOS", "A driver requested urgent assistance on trip TEST-RUN-001.\nLocation: test location.\nThis is a sample email; no SOS was recorded."),
    ("loader_issue", "Loader issue", "A loader reported 2 of 8 units missing on order TEST-ORDER-001.\nA dispatcher decision is needed.\nThis is a sample email; no loading issue was recorded."),
    ("driver_issue", "Driver issue", "A driver reported a vehicle breakdown on trip TEST-RUN-001.\nThis is a sample email; no driver issue was recorded."),
    ("order_deferred", "Store order deferred", "Order TEST-ORDER-001 was deferred in this sample.\nThis is a sample email; no store order was changed."),
    ("partial_shortfall", "Store partial quantity", "Only 6 of 8 units were assigned to order TEST-ORDER-001 in this sample.\nThis is a sample email; no store order was changed."),
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send sample operational emails to the configured EMAIL_USER")
    parser.add_argument("--send", action="store_true", help="Actually send the five sample emails")
    args = parser.parse_args()
    recipient = email_settings.EMAIL_USER
    if not recipient or not email_settings.EMAIL_FROM or not email_settings.EMAIL_SMTP_HOST:
        parser.error("EMAIL_USER, sender, and SMTP host must be configured")
    marker = uuid4().hex[:8].upper()
    for kind, title, body in SAMPLES:
        subject = f"[TEST {marker}] Waypoint {title}"
        if args.send:
            send_smtp(EmailOutbox(recipient=recipient, subject=subject, body=body))
            print(f"{kind}: SMTP accepted")
        else:
            print(f"{kind}: ready ({subject})")


if __name__ == "__main__":
    main()
