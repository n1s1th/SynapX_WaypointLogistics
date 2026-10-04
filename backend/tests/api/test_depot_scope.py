from app.models.order import Order, OrderStatus
from app.models.reference import Depot


def order(number: str, depot: Depot) -> Order:
    return Order(
        order_number=number,
        client_name=f"{depot.value.title()} Store",
        destination_address="Test address",
        status=OrderStatus.CONFIRMED,
        depot=depot,
    )


def test_orders_are_scoped_to_the_requested_depot(client, db_session):
    peliyagoda = order("ORD9000001", Depot.PELIYAGODA)
    kandy = order("ORD9000002", Depot.KANDY)
    db_session.add_all([peliyagoda, kandy])
    db_session.commit()

    peliyagoda_response = client.get("/api/v1/orders/", headers={"X-Waypoint-Depot": "peliyagoda"})
    assert peliyagoda_response.status_code == 200
    assert [item["order_number"] for item in peliyagoda_response.json()] == ["ORD9000001"]

    kandy_response = client.get("/api/v1/orders/", headers={"X-Waypoint-Depot": "kandy"})
    assert kandy_response.status_code == 200
    assert [item["order_number"] for item in kandy_response.json()] == ["ORD9000002"]


def test_an_order_in_another_depot_is_not_addressable(client, db_session):
    kandy = order("ORD9000003", Depot.KANDY)
    db_session.add(kandy)
    db_session.commit()

    response = client.get(f"/api/v1/orders/{kandy.id}", headers={"X-Waypoint-Depot": "peliyagoda"})
    assert response.status_code == 404


def test_invalid_depot_scope_is_rejected(client):
    response = client.get("/api/v1/orders/", headers={"X-Waypoint-Depot": "galle"})
    assert response.status_code == 422
