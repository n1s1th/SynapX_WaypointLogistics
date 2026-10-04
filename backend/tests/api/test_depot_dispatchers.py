from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.order import Order, OrderStatus
from app.models.reference import Depot
from app.models.user import User, UserRole


def dispatcher(email: str) -> User:
    return User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        role=UserRole.DISPATCHER,
        is_active=True,
    )


def test_admin_assigns_one_dispatcher_to_each_depot(client, db_session):
    peliyagoda_dispatcher = dispatcher("peliyagoda.dispatcher@waypoint.com")
    kandy_dispatcher = dispatcher("kandy.dispatcher@waypoint.com")
    db_session.add_all([peliyagoda_dispatcher, kandy_dispatcher])
    db_session.commit()

    response = client.put(
        "/api/v1/admin/depots/peliyagoda/dispatcher",
        json={"user_id": peliyagoda_dispatcher.id},
    )
    assert response.status_code == 200, response.text
    assert response.json()["dispatcher"]["email"] == "peliyagoda.dispatcher@waypoint.com"

    response = client.put(
        "/api/v1/admin/depots/kandy/dispatcher",
        json={"user_id": kandy_dispatcher.id},
    )
    assert response.status_code == 200, response.text

    depots = client.get("/api/v1/admin/depots").json()
    assert depots["peliyagoda"]["dispatcher"]["id"] == peliyagoda_dispatcher.id
    assert depots["kandy"]["dispatcher"]["id"] == kandy_dispatcher.id


def test_assigned_dispatcher_cannot_change_depot_with_header(client, db_session):
    user = dispatcher("peliyagoda.only@waypoint.com")
    db_session.add(user)
    db_session.flush()
    db_session.add(DepotDispatcherAssignment(depot=Depot.PELIYAGODA, user_id=user.id))
    db_session.add_all(
        [
            Order(
                order_number="ORD9100001",
                client_name="Peliyagoda Store",
                destination_address="Test address",
                status=OrderStatus.CONFIRMED,
                depot=Depot.PELIYAGODA,
            ),
            Order(
                order_number="ORD9100002",
                client_name="Kandy Store",
                destination_address="Test address",
                status=OrderStatus.CONFIRMED,
                depot=Depot.KANDY,
            ),
        ]
    )
    db_session.commit()

    response = client.get("/api/v1/orders/", headers={"X-Waypoint-Depot": "kandy"})
    assert response.status_code == 200
    assert [item["order_number"] for item in response.json()] == ["ORD9100001"]
