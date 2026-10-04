from datetime import datetime, time, date
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, ConfigDict, EmailStr
from app.models.user import UserRole
from app.models.reference import Brand, Depot, DockType

# ── User Schemas ──────────────────────────────────────────

class AdminUserRead(BaseModel):
    id: Optional[int] = None
    keycloak_id: Optional[str] = None
    username: Optional[str] = None
    email: str
    full_name: str
    role: str
    role_display: str
    assigned_depot: Optional[str] = None  # peliyagoda, kandy, or None
    is_active: bool
    email_verified: bool = True
    is_keycloak_managed: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AdminUserPasswordReset(BaseModel):
    password: str
    temporary: bool = False


class KeycloakSyncResult(BaseModel):
    success: bool
    message: str
    synced_count: int
    created_count: int
    updated_count: int
    keycloak_total: int
    db_total: int


class AdminUserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = "DISPATCHER"  # ADMIN, DISPATCHER, WAREHOUSE_MANAGER, DRIVER, CLIENT, LOADER
    assigned_depot: Optional[str] = None
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    assigned_depot: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserStatusToggle(BaseModel):
    is_active: bool


# ── Roles & Access Schemas ───────────────────────────────

class RolePermissionItem(BaseModel):
    id: str
    name: str
    description: str
    granted: bool


class RoleDetail(BaseModel):
    key: str
    name: str
    display_title: str
    description: str
    user_count: int
    badge_variant: str
    permissions: List[RolePermissionItem]


class RoleAssignRequest(BaseModel):
    user_id: int
    role: str


# ── Outlet Schemas ───────────────────────────────────────

class OutletRead(BaseModel):
    id: int
    code: str
    name: str
    brand: str
    district: str
    dock_type: str
    van_only: bool
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    depot: str
    parking_constraint: Optional[str] = "normal"
    mall_window: Optional[str] = None
    store_manager: Optional[str] = None
    store_manager_user_id: Optional[int] = None
    store_manager_phone: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class OutletCreate(BaseModel):
    code: str
    name: str
    brand: str = "fresh"  # fresh, style, tech
    district: str
    dock_type: str = "rear_dock"  # rear_dock, street, mall_bay
    van_only: bool = False
    window_start: Optional[str] = "06:00"
    window_end: Optional[str] = "18:00"
    depot: str = "peliyagoda"  # peliyagoda, kandy
    parking_constraint: Optional[str] = "normal"
    mall_window: Optional[str] = None
    store_manager: Optional[str] = None
    store_manager_phone: Optional[str] = None


class OutletUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    brand: Optional[str] = None
    district: Optional[str] = None
    dock_type: Optional[str] = None
    van_only: Optional[bool] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    depot: Optional[str] = None
    parking_constraint: Optional[str] = None
    mall_window: Optional[str] = None
    store_manager: Optional[str] = None
    store_manager_phone: Optional[str] = None


class OutletManagerAssignRequest(BaseModel):
    store_manager: Optional[str] = None
    contact_phone: Optional[str] = None
    user_id: Optional[int] = None


# ── Depots Schemas ────────────────────────────────────────

class DepotDispatcherRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    keycloak_id: Optional[str] = None


class DepotDispatcherAssignRequest(BaseModel):
    user_id: Optional[int] = None
    keycloak_id: Optional[str] = None

class DepotSummary(BaseModel):
    key: str
    name: str
    code: str
    address: str
    district: str
    dock_count: int
    tablet_count: int
    vehicle_count: int
    outlet_count: int
    available_vehicles: int
    allocated_vehicles: int
    status: str = "Operational"


# ── Operational Configuration Schemas ─────────────────────

class DeliveryWindowConfig(BaseModel):
    standard_start: str = "06:00"
    standard_end: str = "18:00"
    morning_start: str = "06:00"
    morning_end: str = "12:00"
    afternoon_start: str = "12:00"
    afternoon_end: str = "18:00"
    order_cutoff_time: str = "18:00"
    arrival_buffer_mins: int = 30


class TripConstraintConfig(BaseModel):
    max_stops_per_trip: int = 8
    max_driving_hours_per_day: float = 9.0
    weight_capacity_alert_pct: float = 90.0
    volume_capacity_alert_pct: float = 85.0
    strict_reefer_enforcement: bool = True
    strict_van_only_enforcement: bool = True


class OperationalConfig(BaseModel):
    delivery_windows: DeliveryWindowConfig
    trip_constraints: TripConstraintConfig


class CalendarDayAdminRead(BaseModel):
    date: date
    is_operating: bool
    festival_ramp: float
    monsoon: bool
    holiday_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CalendarDayAdminUpdate(BaseModel):
    is_operating: Optional[bool] = None
    festival_ramp: Optional[float] = None
    monsoon: Optional[bool] = None
    holiday_name: Optional[str] = None


# ── Audit Log Schemas ─────────────────────────────────────

class AuditLogItem(BaseModel):
    id: str
    timestamp: datetime
    actor_email: str
    actor_name: str
    action_type: str  # USER_MUTATION, ROLE_ASSIGNMENT, VEHICLE_MUTATION, OUTLET_MUTATION, CONFIG_UPDATE
    entity_name: str
    entity_id: Optional[str] = None
    summary: str
    severity: str = "INFO"  # INFO, WARNING, CRITICAL
    diff: Optional[Dict[str, Any]] = None


class AuditLogCreate(BaseModel):
    actor_email: str
    actor_name: str
    action_type: str
    entity_name: str
    entity_id: Optional[str] = None
    summary: str
    severity: str = "INFO"
    diff: Optional[Dict[str, Any]] = None


# ── System Settings Schemas ───────────────────────────────

class KeycloakSettings(BaseModel):
    url: str = "https://auth.tenderease.me"
    realm: str = "waypointlogistics"
    client_id: str = "waypoint-frontend"
    token_expiry_minutes: int = 60
    enable_dev_mode: bool = True


class RoutingSettings(BaseModel):
    routing_engine: str = "OSRM Matrix"  # OSRM Matrix, GraphHopper, Direct Haversine
    geocoding_provider: str = "Nominatim (OpenStreetMap)"
    offline_sync_interval_mins: int = 15
    auto_reroute_on_traffic: bool = True


class AlertSettings(BaseModel):
    email_alerts_issues: bool = True
    sms_alerts_priority: bool = True
    driver_sos_instant_alert: bool = True
    daily_digest_time: str = "08:00"


class MaintenanceSettings(BaseModel):
    maintenance_mode: bool = False
    system_banner_active: bool = False
    banner_message: str = "Planned maintenance scheduled for tonight at 23:00 IST."


class SystemSettingsData(BaseModel):
    keycloak: KeycloakSettings
    routing: RoutingSettings
    alerts: AlertSettings
    maintenance: MaintenanceSettings


# ── Overview Schema ───────────────────────────────────────

class AdminOverviewStats(BaseModel):
    total_users: int
    active_users: int
    users_by_role: Dict[str, int]
    total_vehicles: int
    available_vehicles: int
    allocated_vehicles: int
    unavailable_vehicles: int
    reefer_vehicles: int
    ambient_vehicles: int
    total_outlets: int
    outlets_by_brand: Dict[str, int]
    outlets_by_depot: Dict[str, int]
    van_only_outlets: int
    depots_summary: List[DepotSummary]
    system_status: Dict[str, Any]
    recent_audits: List[AuditLogItem]
