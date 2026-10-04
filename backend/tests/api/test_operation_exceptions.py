from datetime import datetime, timedelta, timezone

from app.models.driver import DriverTrip, DeliveryStop, DeliveryStopStatus, IssueReport, IssueStatus, IssueType, SOSAlert
from app.models.shipment import DispatchTrip
from app.models.user import User, UserRole
from app.api.v1.endpoints.operation_exceptions import list_operation_exceptions


def test_driver_reports_sos_missing_pod_and_stale_run_are_visible(db_session):
    driver = User(email="exception-driver@example.com", full_name="Test Driver", hashed_password="unused", role=UserRole.DRIVER)
    db_session.add(driver)
    db_session.flush()
    trip = DispatchTrip(trip_code="EXCEPTION-TRIP", vehicle_number="V-1", driver_name="Test Driver", origin="Depot", destination="Kandy", status="en_route", updated_at=datetime.now(timezone.utc) - timedelta(minutes=20))
    db_session.add(trip)
    db_session.flush()
    driver_trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=trip.id, assigned_date=datetime.now(timezone.utc))
    db_session.add(driver_trip)
    db_session.flush()
    db_session.add(IssueReport(driver_trip_id=driver_trip.id, issue_type=IssueType.TRAFFIC_DELAY, description="Road closed", status=IssueStatus.OPEN))
    db_session.add(SOSAlert(driver_id=driver.id, driver_trip_id=driver_trip.id, message="Need assistance"))
    db_session.add(DeliveryStop(driver_trip_id=driver_trip.id, sequence=1, address="Main Street", customer_name="Store", status=DeliveryStopStatus.DELIVERED))
    db_session.flush()

    records = list_operation_exceptions(db_session)
    kinds = {record["kind"] for record in records}
    assert {"issue", "sos", "pod", "stale_update"}.issubset(kinds)
    assert all(record["trip_code"] == "EXCEPTION-TRIP" for record in records)
    assert any(record["detail"] == "Road closed" for record in records)

    db_session.query(IssueReport).update({IssueReport.status: IssueStatus.RESOLVED})
    db_session.flush()
    assert not any(record["kind"] == "issue" for record in list_operation_exceptions(db_session))
