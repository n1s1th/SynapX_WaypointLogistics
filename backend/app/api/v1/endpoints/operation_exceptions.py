"""Read-only dispatcher view of incidents reported across operations workflows."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from app.api.deps import get_db, require_dispatcher_or_admin
from app.models.driver import DeliveryStop, DeliveryStopStatus, DriverTrip, IssueReport, IssueStatus as DriverIssueStatus, SOSAlert, SOSStatus
from app.models.delivery_issue import DeliveryIssue
from app.models.loader_issue import LoaderIssue, IssueStatus as LoaderIssueStatus
from app.models.shipment import DispatchTrip, Shipment, ShipmentStatus
from app.models.user import User

router = APIRouter()


def _time(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _entry(source: str, kind: str, row_id: int, title: str, detail: str, status: str, reported_at: datetime | None, trip_code: str | None = None, driver_name: str | None = None, reference: str | None = None, severity: str = "warning"):
    return {"id": f"{source}:{kind}:{row_id}", "source": source, "kind": kind, "title": title, "detail": detail, "status": status, "reported_at": _time(reported_at), "trip_code": trip_code, "driver_name": driver_name, "reference": reference, "severity": severity}


@router.get("/exceptions")
def list_operation_exceptions(db: Session = Depends(get_db), _user: User = Depends(require_dispatcher_or_admin)):
    """Current incidents, one row per recorded issue or independently inferred risk."""
    now = datetime.now(timezone.utc)
    entries = []
    loader = db.query(LoaderIssue).options(joinedload(LoaderIssue.run), joinedload(LoaderIssue.order)).filter(LoaderIssue.status.in_([LoaderIssueStatus.SENT, LoaderIssueStatus.SEEN])).all()
    for issue in loader:
        entries.append(_entry("loader", "shortfall", issue.id, f"Loading {issue.issue_type.value.replace('_', ' ')}", issue.note or issue.quick_note_tag or "Loader reported an issue; dispatcher decision pending.", issue.status.value, issue.reported_at, issue.run.code if issue.run else None, reference=issue.order.order_number if issue.order else None, severity="critical"))

    store_issues = db.query(DeliveryIssue).options(joinedload(DeliveryIssue.outlet)).filter(DeliveryIssue.status.in_(["open", "under_review"])).all()
    for issue in store_issues:
        entry = _entry("store", "delivery_issue", issue.id, issue.title, issue.description, issue.status, issue.reported_at, driver_name=issue.driver_name, reference=issue.order_number or f"ISS{issue.id:07d}")
        entry.update({
            "issue_code": f"ISS{issue.id:07d}",
            "outlet_code": issue.outlet.code if issue.outlet else None,
            "outlet_name": issue.outlet.name if issue.outlet else None,
            "reported_by": issue.reported_by,
            "affected_item": issue.affected_item,
        })
        entries.append(entry)

    driver_issues = db.query(IssueReport).options(joinedload(IssueReport.driver_trip).joinedload(DriverTrip.dispatch_trip)).filter(IssueReport.status.in_([DriverIssueStatus.OPEN, DriverIssueStatus.ACKNOWLEDGED])).all()
    for issue in driver_issues:
        trip = issue.driver_trip.dispatch_trip if issue.driver_trip else None
        entries.append({**_entry("driver", "issue", issue.id, issue.issue_type.value.replace("_", " ").title(), issue.description, issue.status.value, issue.created_at, trip.trip_code if trip else None, trip.driver_name if trip else None, f"Stop {issue.stop_id}" if issue.stop_id else None), "photo_url": issue.photo_url})

    alerts = db.query(SOSAlert).options(joinedload(SOSAlert.driver_trip).joinedload(DriverTrip.dispatch_trip)).filter(SOSAlert.status.in_([SOSStatus.TRIGGERED, SOSStatus.ACKNOWLEDGED])).all()
    for alert in alerts:
        trip = alert.driver_trip.dispatch_trip if alert.driver_trip else None
        entries.append({**_entry("driver", "sos", alert.id, "Driver SOS", alert.message or "Driver requested urgent assistance.", alert.status.value, alert.triggered_at, trip.trip_code if trip else None, trip.driver_name if trip else None, severity="critical"), "photo_url": alert.photo_url})

    stops = db.query(DeliveryStop).options(joinedload(DeliveryStop.driver_trip).joinedload(DriverTrip.dispatch_trip)).filter(DeliveryStop.status == DeliveryStopStatus.DELIVERED, ~DeliveryStop.pod.has()).all()
    for stop in stops:
        trip = stop.driver_trip.dispatch_trip if stop.driver_trip else None
        entries.append(_entry("driver", "pod", stop.id, "POD missing", "Stop is recorded as delivered but has no proof-of-delivery record. It may still be pending sync.", "needs_check", stop.completed_at, trip.trip_code if trip else None, trip.driver_name if trip else None, stop.customer_name))

    shipments = db.query(Shipment).options(joinedload(Shipment.dispatch_trip)).all()
    for shipment in shipments:
        trip = shipment.dispatch_trip
        reference = shipment.tracking_number
        if shipment.status == ShipmentStatus.FAILED:
            entries.append(_entry("tracking", "failed", shipment.id, "Failed shipment", "Shipment is recorded as failed; a reason is not recorded here.", "failed", shipment.last_updated, trip.trip_code if trip else None, trip.driver_name if trip else None, reference, "critical"))
        elif shipment.status in (ShipmentStatus.PENDING, ShipmentStatus.IN_TRANSIT, ShipmentStatus.OUT_FOR_DELIVERY) and trip and trip.estimated_arrival and not trip.actual_arrival:
            eta = trip.estimated_arrival if trip.estimated_arrival.tzinfo else trip.estimated_arrival.replace(tzinfo=timezone.utc)
            if eta < now:
                entries.append(_entry("tracking", "eta", shipment.id, "Trip ETA passed", "Trip ETA has passed without a recorded arrival. Confirm with the driver; outlet delivery may still be on time.", "needs_check", trip.estimated_arrival, trip.trip_code, trip.driver_name, reference))

    runs = db.query(DispatchTrip).filter(DispatchTrip.status == "en_route").all()
    for run in runs:
        if not run.updated_at:
            continue
        updated = run.updated_at if run.updated_at.tzinfo else run.updated_at.replace(tzinfo=timezone.utc)
        if (now - updated).total_seconds() > 15 * 60:
            entries.append(_entry("driver", "stale_update", run.id, "Run update stale", "No run update is recorded in the last 15 minutes. This does not prove the driver is offline or that sync failed.", "needs_check", run.updated_at, run.trip_code, run.driver_name, severity="warning"))

    entries.sort(key=lambda item: (item["severity"] != "critical", item["reported_at"] or ""), reverse=False)
    return entries
