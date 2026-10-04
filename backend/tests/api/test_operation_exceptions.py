from datetime import datetime, timedelta, timezone

from app.models.driver import DriverTrip, DeliveryStop, DeliveryStopStatus, IssueReport, IssueStatus, IssueType, SOSAlert
from app.models.delivery_issue import DeliveryIssue
from app.models.reference import Brand, Depot, DockType, Outlet
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


def test_driver_sos_and_report_photos_reach_the_dispatcher(db_session):
    driver = User(email="photo-driver@example.com", full_name="Photo Driver", hashed_password="unused", role=UserRole.DRIVER)
    db_session.add(driver)
    db_session.flush()
    trip = DispatchTrip(trip_code="PHOTO-TRIP", vehicle_number="V-2", driver_name="Photo Driver", origin="Depot", destination="Colombo", status="en_route", updated_at=datetime.now(timezone.utc))
    db_session.add(trip)
    db_session.flush()
    driver_trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=trip.id, assigned_date=datetime.now(timezone.utc))
    db_session.add(driver_trip)
    db_session.flush()
    sos_link = "https://pub-test.r2.dev/driver/2026-10-04/sos.jpg"
    report_link = "https://pub-test.r2.dev/driver/2026-10-04/report.jpg"
    db_session.add(SOSAlert(driver_id=driver.id, driver_trip_id=driver_trip.id, message="Accident", photo_url=sos_link))
    db_session.add(IssueReport(driver_trip_id=driver_trip.id, issue_type=IssueType.DAMAGED_GOODS, description="Crate broken", status=IssueStatus.OPEN, photo_url=report_link))
    db_session.add(SOSAlert(driver_id=driver.id, driver_trip_id=driver_trip.id, message="No photo"))
    db_session.flush()

    records = {record["detail"]: record for record in list_operation_exceptions(db_session)}

    assert records["Accident"]["photo_url"] == sos_link
    assert records["Crate broken"]["photo_url"] == report_link
    assert records["No photo"]["photo_url"] is None


def test_active_store_delivery_issue_appears_with_outlet_and_order(db_session, client):
    outlet = Outlet(code="STORE-EX", name="Test Store", brand=Brand.FRESH, district="Colombo", dock_type=DockType.REAR_DOCK, depot=Depot.PELIYAGODA)
    db_session.add(outlet)
    db_session.flush()
    issue = DeliveryIssue(
        outlet_id=outlet.id,
        order_number="ORD-EX",
        issue_type="Missing Items",
        title="Two cartons missing",
        description="Only eight of ten cartons arrived.",
        affected_item="Cartons",
        reported_by="Test Manager (Store Manager)",
        status="open",
    )
    db_session.add(issue)
    db_session.flush()

    record = next(row for row in list_operation_exceptions(db_session) if row["id"] == f"store:delivery_issue:{issue.id}")
    assert record["reference"] == "ORD-EX"
    assert record["outlet_code"] == "STORE-EX"
    assert record["outlet_name"] == "Test Store"
    assert record["reported_by"] == "Test Manager (Store Manager)"
    response = client.get("/api/v1/operations/exceptions")
    assert response.status_code == 200
    assert any(row["id"] == record["id"] for row in response.json())

    issue.status = "under_review"
    db_session.flush()
    assert any(row["id"] == record["id"] for row in list_operation_exceptions(db_session))

    issue.status = "resolved"
    db_session.flush()
    assert not any(row["id"] == record["id"] for row in list_operation_exceptions(db_session))
