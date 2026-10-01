from app.core.database import Base  # noqa: F401
from app.models.user import User
from app.models.order import Order, OrderItem
from app.models.inventory import InventoryItem, Warehouse
from app.models.shipment import Shipment, DispatchTrip
from app.models.fleet import Vehicle, DriverProfile
from app.models.allocation import Allocation
from app.models.notification import Notification
from app.models.receipts import DeliveryReceipt
from app.models.outlet_settings import OutletSettings
from app.models.driver import DriverTrip, DeliveryStop, ProofOfDelivery, IssueReport, SOSAlert
from app.models.reference import (
    Brand,
    CalendarDay,
    Depot,
    Dock,
    DockTablet,
    DockType,
    Outlet,
    TemperatureClass,
)
from app.models.loader_user import LoaderSession, LoaderUser, SessionEndReason
from app.models.delivery_run import (
    DeliveryRun,
    RunOrderState,
    RunStatus,
    RunStop,
    RunStopOrder,
    StopStatus,
)
from app.models.plan_revision import PlanChangeKind, PlanRevision, PlanRevisionChange
from app.models.loader_issue import IssueStatus, IssueType, LoaderIssue, LoaderIssueOption
from app.models.loader_activity import (
    ActorKind,
    CheckAction,
    LoaderActivity,
    LoadingCheck,
    ReleaseAction,
    RunReleaseAction,
)

__all__ = [
    "Base",
    "User",
    "Order",
    "OrderItem",
    "InventoryItem",
    "Warehouse",
    "Shipment",
    "DispatchTrip",
    "Vehicle",
    "DriverProfile",
    "Allocation",
    "Notification",
    "DeliveryReceipt",
    "OutletSettings",
    "DriverTrip",
    "DeliveryStop",
    "ProofOfDelivery",
    "IssueReport",
    "SOSAlert",
    # Loader reference data
    "Brand",
    "CalendarDay",
    "Depot",
    "Dock",
    "DockTablet",
    "DockType",
    "Outlet",
    "TemperatureClass",
    # Loader users
    "LoaderSession",
    "LoaderUser",
    "SessionEndReason",
    # Delivery runs
    "DeliveryRun",
    "RunOrderState",
    "RunStatus",
    "RunStop",
    "RunStopOrder",
    "StopStatus",
    # Plan revisions
    "PlanChangeKind",
    "PlanRevision",
    "PlanRevisionChange",
    # Loader issues and decisions (Postgres types loaderissuetype / loaderissuestatus)
    "IssueStatus",
    "IssueType",
    "LoaderIssue",
    "LoaderIssueOption",
    # Loader audit trail
    "ActorKind",
    "CheckAction",
    "LoaderActivity",
    "LoadingCheck",
    "ReleaseAction",
    "RunReleaseAction",
]
