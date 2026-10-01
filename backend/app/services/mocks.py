"""
Mock implementations of Dev A's service contracts.
Replace with real imports when Dev A's code is merged into dev.
Controlled by environment variable USE_MOCK_SERVICES=true
"""
import uuid
from datetime import date, datetime


class MockOrderService:
    @staticmethod
    async def get_orders_by_date(order_date: date, depot: str) -> list[dict]:
        """Returns fake orders for testing the loading flow."""
        return [
            {
                "id": uuid.UUID("a1b2c3d4-0000-0000-0000-000000000001"),
                "outlet_id": "OUT001",
                "outlet_name": "Colombo Fresh - Pettah",
                "brand": "Fresh",
                "district": "Colombo",
                "depot": "Peliyagoda",
                "temp_requirement": "chilled",
                "order_units": 40,
                "order_weight_kg": 120.5,
                "order_volume_m3": 0.8,
                "is_high_priority": False,
                "status": "confirmed",
                "vehicle_id": "VEH001",
                "seq_in_route": 0,
            },
            {
                "id": uuid.UUID("a1b2c3d4-0000-0000-0000-000000000002"),
                "outlet_id": "OUT002",
                "outlet_name": "Colombo Fresh - Maradana",
                "brand": "Fresh",
                "district": "Colombo",
                "depot": "Peliyagoda",
                "temp_requirement": "ambient",
                "order_units": 25,
                "order_weight_kg": 80.0,
                "order_volume_m3": 0.5,
                "is_high_priority": True,
                "status": "confirmed",
                "vehicle_id": "VEH001",
                "seq_in_route": 1,
            },
        ]

    @staticmethod
    async def update_order_status(order_id: uuid.UUID, status: str) -> None:
        print(f"[MOCK OrderService] update_order_status({order_id}, {status})")


class MockNotificationService:
    @staticmethod
    async def send(
        outlet_id: str,
        type: str,
        title: str,
        message: str,
        order_id: uuid.UUID = None,
    ) -> None:
        print(
            f"[MOCK NotificationService] → outlet={outlet_id} "
            f"type={type} title='{title}'"
        )


def get_order_service():
    """Returns the real or mock OrderService based on environment."""
    import os
    if os.getenv("USE_MOCK_SERVICES", "true").lower() == "true":
        return MockOrderService()
    try:
        from app.services.order_service import OrderService
        if hasattr(OrderService, "get_orders_by_date") and hasattr(OrderService, "update_order_status"):
            return OrderService()
        return MockOrderService()
    except (ImportError, AttributeError):
        return MockOrderService()


def get_notification_service():
    """Returns the real or mock NotificationService based on environment."""
    import os
    if os.getenv("USE_MOCK_SERVICES", "true").lower() == "true":
        return MockNotificationService()
    try:
        from app.services.notification_service import NotificationService
        if hasattr(NotificationService, "send"):
            return NotificationService()
        return MockNotificationService()
    except (ImportError, AttributeError):
        return MockNotificationService()
