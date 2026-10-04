from app.api import deps
from app.main import app
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.reference import Depot
from app.models.user import User, UserRole
from app.services.user_notification_service import notify_role, notify_user


def _user(db, email, role):
    user = User(email=email, full_name=email, role=role, is_active=True)
    db.add(user)
    db.flush()
    return user


def test_inbox_is_private_and_read_state_is_per_recipient(client, db_session):
    first = _user(db_session, "inbox-first@example.test", UserRole.DISPATCHER)
    second = _user(db_session, "inbox-second@example.test", UserRole.DISPATCHER)
    notify_user(db_session, recipient_user_id=first.id, event_key="test:one", category="issue",
                title="First only", message="Review this issue")
    notify_user(db_session, recipient_user_id=second.id, event_key="test:two", category="issue",
                title="Second only", message="Review another issue")
    db_session.commit()
    app.dependency_overrides[deps.get_current_user] = lambda: first
    response = client.get("/api/v1/notifications/inbox")
    assert response.status_code == 200
    assert [item["title"] for item in response.json()["items"]] == ["First only"]
    other_id = db_session.query(User).filter(User.id == second.id).one().id
    second_notification = client.get("/api/v1/notifications/inbox").json()["items"]
    assert len(second_notification) == 1
    from app.models.user_notification import UserNotification
    other_notification = db_session.query(UserNotification).filter_by(recipient_user_id=other_id).one()
    assert client.patch(f"/api/v1/notifications/inbox/{other_notification.id}/read").status_code == 404
    own_id = second_notification[0]["id"]
    assert client.patch(f"/api/v1/notifications/inbox/{own_id}/read").status_code == 200
    assert client.get("/api/v1/notifications/inbox").json()["unread_count"] == 0
    app.dependency_overrides[deps.get_current_user] = lambda: second
    assert client.get("/api/v1/notifications/inbox").json()["unread_count"] == 1


def test_role_fanout_respects_depot_and_event_key(db_session):
    peliyagoda = _user(db_session, "inbox-peliyagoda@example.test", UserRole.DISPATCHER)
    kandy = _user(db_session, "inbox-kandy@example.test", UserRole.DISPATCHER)
    db_session.add_all([
        DepotDispatcherAssignment(user_id=peliyagoda.id, depot=Depot.PELIYAGODA),
        DepotDispatcherAssignment(user_id=kandy.id, depot=Depot.KANDY),
    ])
    db_session.flush()
    args = dict(role=UserRole.DISPATCHER, depot=Depot.PELIYAGODA, event_key="issue:101",
                category="issue", title="Loading issue", message="Review the flag")
    assert notify_role(db_session, **args) == 1
    assert notify_role(db_session, **args) == 0
    from app.models.user_notification import UserNotification
    assert db_session.query(UserNotification).filter_by(recipient_user_id=peliyagoda.id).count() == 1
    assert db_session.query(UserNotification).filter_by(recipient_user_id=kandy.id).count() == 0
