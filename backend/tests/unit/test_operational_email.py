from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.api.v1.endpoints import outlets
from app.email import service, worker
from app.email.config import EmailSettings
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.driver import DriverTrip
from app.models.driver import IssueType as DriverIssueType
from app.models.email_outbox import EmailOutbox
from app.models.loader_issue import IssueType as LoaderIssueType
from app.models.order import Order
from app.models.outlet_settings import OutletSettings
from app.models.reference import Brand, Depot, DockType, Outlet
from app.models.shipment import DispatchTrip
from app.models.user import User, UserRole
from app.schemas.admin import OutletManagerAssignRequest
from app.services import driver_service


def test_loader_issue_queues_once_for_its_depot_dispatcher(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", True)
    dispatcher = User(email="kandy.ops@example.com", full_name="Kandy Ops", role=UserRole.DISPATCHER, is_active=True)
    db_session.add(dispatcher)
    db_session.flush()
    db_session.add(DepotDispatcherAssignment(depot=Depot.KANDY, user_id=dispatcher.id))
    db_session.flush()
    issue = SimpleNamespace(
        id=42, issue_type=LoaderIssueType.SHORT, units_affected=2, units_total=8,
        note="Two cartons missing", quick_note_tag=None,
        order=SimpleNamespace(order_number="ORD1000001"),
        run=SimpleNamespace(code="RUN-42", dock=SimpleNamespace(depot=Depot.KANDY)),
    )

    service.queue_loader_issue(db_session, issue)
    service.queue_loader_issue(db_session, issue)
    db_session.flush()

    rows = db_session.query(EmailOutbox).all()
    assert len(rows) == 1
    assert rows[0].recipient == dispatcher.email
    assert rows[0].event_key == "loader-issue:42"
    assert "Two cartons missing" in rows[0].body


def test_store_change_respects_outlet_email_preference(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", True)
    manager = User(email="store@example.com", full_name="Store Manager", role=UserRole.STORE_MANAGER, is_active=True)
    db_session.add(manager)
    db_session.flush()
    order = Order(id=99, order_number="ORD1000002", outlet_id=5, placed_by=manager.id,
                  updated_at=datetime.now(UTC))
    setting = OutletSettings(outlet_id=5, email_alerts_issues=False)
    db_session.add(setting)
    db_session.flush()
    assert service.store_email(db_session, order) is None
    setting.email_alerts_issues = True
    db_session.flush()
    assert service.store_email(db_session, order) == manager.email
    service.queue_store_change(db_session, order, partial=False, reason="No vehicle")
    db_session.flush()
    row = db_session.query(EmailOutbox).one()
    assert row.recipient == manager.email
    assert "No vehicle" in row.body


def test_store_email_uses_assigned_user_id_instead_of_matching_names(db_session):
    other = User(email="other@example.com", full_name="Alex Lee", role=UserRole.STORE_MANAGER, is_active=True)
    assigned = User(email="assigned@example.com", full_name="Alex Lee", role=UserRole.STORE_MANAGER, is_active=True)
    db_session.add_all([other, assigned])
    db_session.flush()
    setting = OutletSettings(outlet_id=51, store_manager="Alex Lee", store_manager_user_id=assigned.id)
    db_session.add(setting)
    db_session.flush()
    order = Order(id=510, order_number="ORD1000510", outlet_id=51)

    assert service.store_email(db_session, order) == assigned.email
    setting.store_manager_user_id = None
    db_session.flush()
    assert service.store_email(db_session, order) is None


def test_outlet_assignment_saves_recipient_user_id(db_session, monkeypatch):
    outlet = Outlet(code="EMAIL-STORE", name="Email Store", brand=Brand.FRESH,
                    district="Colombo", dock_type=DockType.REAR_DOCK, depot=Depot.PELIYAGODA)
    manager = User(email="assigned-store@example.com", full_name="Alex Lee",
                   role=UserRole.STORE_MANAGER, is_active=True)
    db_session.add_all([outlet, manager])
    db_session.commit()
    monkeypatch.setattr(outlets, "get_outlet", lambda outlet_id, db: outlet_id)

    outlets.assign_outlet_manager(
        outlet.id, OutletManagerAssignRequest(user_id=manager.id), db_session, manager,
    )

    setting = db_session.query(OutletSettings).filter_by(outlet_id=outlet.id).one()
    assert setting.store_manager_user_id == manager.id
    assert setting.store_manager == manager.full_name


def test_disabled_email_does_not_enqueue(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", False)
    service.queue(db_session, key="disabled:1", kind="test", recipient="x@example.com", subject="Test", body="Test")
    assert db_session.query(EmailOutbox).count() == 0


def test_existing_gmail_env_names_resolve_to_smtp_settings():
    config = EmailSettings(_env_file=None, EMAIL_USER="ops@gmail.com", EMAIL_APP_PASSWORD="abcd efgh")
    assert config.EMAIL_FROM == "ops@gmail.com"
    assert config.EMAIL_SMTP_HOST == "smtp.gmail.com"
    assert config.EMAIL_SMTP_PORT == 587
    assert config.EMAIL_SMTP_STARTTLS is True
    assert config.EMAIL_SMTP_USERNAME == "ops@gmail.com"
    assert config.EMAIL_SMTP_PASSWORD == "abcdefgh"

    explicit = EmailSettings(_env_file=None, EMAIL_USER="ops@gmail.com", EMAIL_APP_PASSWORD="legacy",
                             EMAIL_SMTP_HOST="smtp.other.example", EMAIL_SMTP_PASSWORD="explicit")
    assert explicit.EMAIL_SMTP_HOST == "smtp.other.example"
    assert explicit.EMAIL_SMTP_PASSWORD == "explicit"


def test_driver_issue_and_sos_route_to_trip_depot(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", True)
    dispatcher = User(email="peliyagoda.ops@example.com", full_name="Peliyagoda Ops",
                      role=UserRole.DISPATCHER, is_active=True)
    driver = User(email="driver@example.com", full_name="Driver One", role=UserRole.DRIVER, is_active=True)
    db_session.add_all([dispatcher, driver])
    db_session.flush()
    db_session.add(DepotDispatcherAssignment(depot=Depot.PELIYAGODA, user_id=dispatcher.id))
    db_session.flush()
    trip = SimpleNamespace(trip_code="TRIP-7", depot_name="peliyagoda", vehicle_id=None)
    driver_trip = SimpleNamespace(dispatch_trip=trip)
    issue = SimpleNamespace(id=7, driver_trip=driver_trip, issue_type=DriverIssueType.VEHICLE_BREAKDOWN,
                            stop_id=None, description="Engine stopped")
    alert = SimpleNamespace(id=8, driver_trip=driver_trip, driver_id=driver.id,
                            latitude=6.9, longitude=79.9, message="Need assistance")

    service.queue_driver_issue(db_session, issue)
    service.queue_sos(db_session, alert)
    rows = db_session.query(EmailOutbox).order_by(EmailOutbox.id).all()
    assert [row.recipient for row in rows] == [dispatcher.email, dispatcher.email]
    assert [row.kind for row in rows] == ["driver_issue", "driver_sos"]
    assert "6.9, 79.9" in rows[1].body


def test_worker_marks_success_and_schedules_retry(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", True)
    monkeypatch.setattr(worker.email_settings, "EMAIL_FROM", "dispatch@example.com")
    monkeypatch.setattr(worker.email_settings, "EMAIL_SMTP_HOST", "smtp.example.com")
    connection = db_session.connection()
    monkeypatch.setattr(worker, "SessionLocal", lambda: Session(bind=connection))
    service.queue(db_session, key="worker:1", kind="test", recipient="one@example.com", subject="One", body="First")
    service.queue(db_session, key="worker:2", kind="test", recipient="two@example.com", subject="Two", body="Second")
    db_session.commit()
    def fake_send(message):
        if message.event_key == "worker:2":
            raise RuntimeError("temporary SMTP error")
    monkeypatch.setattr(worker, "send_smtp", fake_send)

    assert worker.process_batch(limit=2) == 2
    db_session.expire_all()
    rows = {row.event_key: row for row in db_session.query(EmailOutbox).all()}
    assert rows["worker:1"].status == "sent"
    assert rows["worker:1"].sent_at is not None
    assert rows["worker:2"].status == "pending"
    assert rows["worker:2"].attempts == 1
    assert rows["worker:2"].next_attempt_at > rows["worker:2"].created_at


def test_driver_actions_queue_email_with_the_record(db_session, monkeypatch):
    monkeypatch.setattr(service.email_settings, "EMAIL_ENABLED", True)
    dispatcher = User(email="dispatch-action@example.com", full_name="Dispatcher", role=UserRole.DISPATCHER, is_active=True)
    driver = User(email="driver-action@example.com", full_name="Driver", role=UserRole.DRIVER, is_active=True)
    db_session.add_all([dispatcher, driver])
    db_session.flush()
    db_session.add(DepotDispatcherAssignment(depot=Depot.KANDY, user_id=dispatcher.id))
    trip = DispatchTrip(trip_code="EMAIL-TRIP-1", vehicle_number="VEH-1", driver_name="Driver",
                        origin="Kandy depot", destination="Store", depot_name="kandy")
    db_session.add(trip)
    db_session.flush()
    driver_trip = DriverTrip(driver_id=driver.id, dispatch_trip_id=trip.id)
    db_session.add(driver_trip)
    db_session.commit()

    issue = driver_service.report_issue(db_session, driver_trip.id,
                                        {"issue_type": DriverIssueType.TRAFFIC_DELAY, "description": "Road closed"}, driver.id)
    alert = driver_service.trigger_sos(db_session, driver.id,
                                       {"driver_trip_id": driver_trip.id, "message": "Need help", "latitude": 7.2, "longitude": 80.6})
    rows = db_session.query(EmailOutbox).order_by(EmailOutbox.id).all()
    assert len(rows) == 2
    assert rows[0].event_key == f"driver-issue:{issue.id}"
    assert rows[1].event_key.startswith(f"driver-sos:{alert.id}:")
    assert all(row.recipient == dispatcher.email for row in rows)
