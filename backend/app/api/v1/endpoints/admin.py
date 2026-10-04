import uuid
from datetime import datetime, date, time, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.api import deps
from app.core import security, keycloak_admin
from app.core.config import settings
from app.models.user import User, UserRole
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.reference import Depot
from app.models.loader_user import LoaderUser
from app.models.fleet import Vehicle, VehicleStatus
from app.models.reference import (
    Outlet,
    Depot,
    Brand,
    DockType,
    Dock,
    DockTablet,
    CalendarDay,
)
from app.schemas.admin import (
    AdminOverviewStats,
    AdminUserRead,
    AdminUserCreate,
    AdminUserUpdate,
    AdminUserPasswordReset,
    UserStatusToggle,
    KeycloakSyncResult,
    RoleDetail,
    RolePermissionItem,
    RoleAssignRequest,
    DepotSummary,
    DepotDispatcherAssignRequest,
    OperationalConfig,
    DeliveryWindowConfig,
    TripConstraintConfig,
    CalendarDayAdminRead,
    CalendarDayAdminUpdate,
    AuditLogItem,
    AuditLogCreate,
    SystemSettingsData,
    KeycloakSettings,
    RoutingSettings,
    AlertSettings,
    MaintenanceSettings,
)

router = APIRouter()

# ── In-Memory Persistent State for Configs, Settings & Audit Logs ─────
# (Persists during server lifecycle without breaking Alembic schema chains)

_operational_config = OperationalConfig(
    delivery_windows=DeliveryWindowConfig(
        standard_start="06:00",
        standard_end="18:00",
        morning_start="06:00",
        morning_end="12:00",
        afternoon_start="12:00",
        afternoon_end="18:00",
        order_cutoff_time="18:00",
        arrival_buffer_mins=30,
    ),
    trip_constraints=TripConstraintConfig(
        max_stops_per_trip=8,
        max_driving_hours_per_day=9.0,
        weight_capacity_alert_pct=90.0,
        volume_capacity_alert_pct=85.0,
        strict_reefer_enforcement=True,
        strict_van_only_enforcement=True,
    )
)

_system_settings = SystemSettingsData(
    keycloak=KeycloakSettings(
        url=settings.KEYCLOAK_URL if hasattr(settings, "KEYCLOAK_URL") else "https://auth.tenderease.me",
        realm=settings.KEYCLOAK_REALM if hasattr(settings, "KEYCLOAK_REALM") else "waypointlogistics",
        client_id="waypoint-frontend",
        token_expiry_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES if hasattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES") else 60,
        enable_dev_mode=settings.KEYCLOAK_DEV_MODE if hasattr(settings, "KEYCLOAK_DEV_MODE") else True,
    ),
    routing=RoutingSettings(
        routing_engine="OSRM Matrix (Sri Lanka Network)",
        geocoding_provider="Nominatim (OpenStreetMap)",
        offline_sync_interval_mins=15,
        auto_reroute_on_traffic=True,
    ),
    alerts=AlertSettings(
        email_alerts_issues=True,
        sms_alerts_priority=True,
        driver_sos_instant_alert=True,
        daily_digest_time="08:00",
    ),
    maintenance=MaintenanceSettings(
        maintenance_mode=False,
        system_banner_active=False,
        banner_message="Planned maintenance scheduled for tonight at 23:00 IST.",
    )
)

_audit_logs: List[AuditLogItem] = [
    AuditLogItem(
        id=str(uuid.uuid4())[:8],
        timestamp=datetime.now(timezone.utc),
        actor_email="admin@waypoint.com",
        actor_name="System Administrator",
        action_type="CONFIG_UPDATE",
        entity_name="Operational Constraints",
        entity_id="trip_constraints",
        summary="Set strict reefer enforcement and max stops per trip to 8.",
        severity="INFO",
    ),
    AuditLogItem(
        id=str(uuid.uuid4())[:8],
        timestamp=datetime.now(timezone.utc),
        actor_email="admin@waypoint.com",
        actor_name="System Administrator",
        action_type="ROLE_ASSIGNMENT",
        entity_name="User Role",
        entity_id="role-dispatcher",
        summary="Assigned Dispatcher role to Kasun Perera.",
        severity="INFO",
    ),
    AuditLogItem(
        id=str(uuid.uuid4())[:8],
        timestamp=datetime.now(timezone.utc),
        actor_email="admin@waypoint.com",
        actor_name="System Administrator",
        action_type="VEHICLE_MUTATION",
        entity_name="Vehicle Fleet",
        entity_id="VEH019",
        summary="Placed vehicle VEH019 into 'Under maintenance' status.",
        severity="WARNING",
    ),
]


def record_audit(
    action_type: str,
    entity_name: str,
    summary: str,
    actor_email: str = "admin@waypoint.com",
    actor_name: str = "System Administrator",
    entity_id: Optional[str] = None,
    severity: str = "INFO",
    diff: Optional[Dict[str, Any]] = None,
):
    entry = AuditLogItem(
        id=str(uuid.uuid4())[:8],
        timestamp=datetime.now(timezone.utc),
        actor_email=actor_email,
        actor_name=actor_name,
        action_type=action_type,
        entity_name=entity_name,
        entity_id=entity_id,
        summary=summary,
        severity=severity,
        diff=diff,
    )
    _audit_logs.insert(0, entry)
    if len(_audit_logs) > 200:
        _audit_logs.pop()
    return entry


def role_to_display(role_val: str) -> str:
    mapping = {
        "ADMIN": "System Administrator",
        "DISPATCHER": "Dispatcher",
        "WAREHOUSE_MANAGER": "Store Manager",
        "STORE_MANAGER": "Store Manager",
        "DRIVER": "Driver",
        "CLIENT": "Client / Store",
        "LOADER": "Loader",
    }
    return mapping.get(role_val, role_val.title())


# ── 1. Overview Endpoint ───────────────────────────────────

@router.get("/overview", response_model=AdminOverviewStats)
def get_admin_overview(db: Session = Depends(deps.get_db)) -> Any:
    # Users
    users = db.query(User).all()
    loaders = db.query(LoaderUser).all()
    total_users = len(users) + len(loaders)
    active_users = sum(1 for u in users if u.is_active) + sum(1 for l in loaders if l.is_active)

    users_by_role: Dict[str, int] = {
        "DISPATCHER": 0,
        "STORE_MANAGER": 0,
        "DRIVER": 0,
        "LOADER": len(loaders),
        "ADMIN": 0,
        "CLIENT": 0,
    }
    for u in users:
        val = u.role.value if hasattr(u.role, "value") else str(u.role)
        if val == "WAREHOUSE_MANAGER":
            users_by_role["STORE_MANAGER"] += 1
        elif val in users_by_role:
            users_by_role[val] += 1
        else:
            users_by_role[val] = users_by_role.get(val, 0) + 1

    # Vehicles
    vehicles = db.query(Vehicle).all()
    total_vehicles = len(vehicles)
    available_vehicles = sum(1 for v in vehicles if v.status == VehicleStatus.AVAILABLE)
    allocated_vehicles = sum(1 for v in vehicles if v.status in (VehicleStatus.ALLOCATED, VehicleStatus.LOADING))
    unavailable_vehicles = sum(1 for v in vehicles if v.status == VehicleStatus.UNAVAILABLE)
    reefer_vehicles = sum(1 for v in vehicles if (v.temperature_mode or "").lower() == "reefer")
    ambient_vehicles = total_vehicles - reefer_vehicles

    # Outlets
    outlets = db.query(Outlet).all()
    total_outlets = len(outlets)
    outlets_by_brand: Dict[str, int] = {}
    outlets_by_depot: Dict[str, int] = {"peliyagoda": 0, "kandy": 0}
    van_only_outlets = 0

    for o in outlets:
        b_label = o.brand.value.title() if hasattr(o.brand, "value") else str(o.brand).title()
        outlets_by_brand[b_label] = outlets_by_brand.get(b_label, 0) + 1

        d_val = o.depot.value.lower() if hasattr(o.depot, "value") else str(o.depot).lower()
        outlets_by_depot[d_val] = outlets_by_depot.get(d_val, 0) + 1

        if o.van_only:
            van_only_outlets += 1

    # Depots Summary
    p_vehicles = [v for v in vehicles if (v.depot_name or "").lower() == "peliyagoda"]
    k_vehicles = [v for v in vehicles if (v.depot_name or "").lower() == "kandy"]
    p_docks = db.query(Dock).filter(Dock.depot == Depot.PELIYAGODA).count()
    k_docks = db.query(Dock).filter(Dock.depot == Depot.KANDY).count()
    p_tablets = db.query(DockTablet).join(Dock).filter(Dock.depot == Depot.PELIYAGODA).count()
    k_tablets = db.query(DockTablet).join(Dock).filter(Dock.depot == Depot.KANDY).count()

    depots_summary = [
        DepotSummary(
            key="peliyagoda",
            name="Peliyagoda Central Depot",
            code="DEP-CMB-01",
            address="Kandy Road, Peliyagoda, Western Province",
            district="Gampaha / Colombo Metro",
            dock_count=max(p_docks, 4),
            tablet_count=max(p_tablets, 4),
            vehicle_count=len(p_vehicles),
            outlet_count=outlets_by_depot.get("peliyagoda", 0),
            available_vehicles=sum(1 for v in p_vehicles if v.status == VehicleStatus.AVAILABLE),
            allocated_vehicles=sum(1 for v in p_vehicles if v.status in (VehicleStatus.ALLOCATED, VehicleStatus.LOADING)),
            status="Operational",
        ),
        DepotSummary(
            key="kandy",
            name="Kandy Regional Depot",
            code="DEP-KDY-01",
            address="Katugastota Industrial Zone, Kandy, Central Province",
            district="Kandy / Central Highlands",
            dock_count=max(k_docks, 2),
            tablet_count=max(k_tablets, 2),
            vehicle_count=len(k_vehicles),
            outlet_count=outlets_by_depot.get("kandy", 0),
            available_vehicles=sum(1 for v in k_vehicles if v.status == VehicleStatus.AVAILABLE),
            allocated_vehicles=sum(1 for v in k_vehicles if v.status in (VehicleStatus.ALLOCATED, VehicleStatus.LOADING)),
            status="Operational",
        )
    ]

    # System Status
    today = date.today()
    cal_today = db.query(CalendarDay).filter(CalendarDay.date == today).first()

    system_status = {
        "database": "Connected (Neon Serverless PostgreSQL 16)",
        "keycloak": f"Active ({_system_settings.keycloak.realm})",
        "backend": "Online (FastAPI v1.0.0)",
        "is_operating_day": cal_today.is_operating if cal_today else True,
        "festival_ramp": cal_today.festival_ramp if cal_today else 1.0,
        "monsoon_risk": cal_today.monsoon if cal_today else False,
        "maintenance_mode": _system_settings.maintenance.maintenance_mode,
    }

    return AdminOverviewStats(
        total_users=total_users,
        active_users=active_users,
        users_by_role=users_by_role,
        total_vehicles=total_vehicles,
        available_vehicles=available_vehicles,
        allocated_vehicles=allocated_vehicles,
        unavailable_vehicles=unavailable_vehicles,
        reefer_vehicles=reefer_vehicles,
        ambient_vehicles=ambient_vehicles,
        total_outlets=total_outlets,
        outlets_by_brand=outlets_by_brand,
        outlets_by_depot=outlets_by_depot,
        van_only_outlets=van_only_outlets,
        depots_summary=depots_summary,
        system_status=system_status,
        recent_audits=_audit_logs[:6],
    )


# ── 2. Users Management Endpoints (Keycloak IAM Direct) ──────────

@router.get("/users", response_model=List[AdminUserRead])
def list_admin_users(
    q: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    include_loaders: bool = True,
    db: Session = Depends(deps.get_db),
) -> Any:
    # Pre-fetch all active depot dispatcher assignments for quick lookup
    depot_assignments = {
        a.user_id: a.depot.value if hasattr(a.depot, "value") else str(a.depot).lower()
        for a in db.query(DepotDispatcherAssignment).all()
    }

    # When Keycloak Admin is configured, Keycloak is the authoritative single source of truth!
    if keycloak_admin.is_keycloak_admin_configured():
        kc_users = keycloak_admin.list_keycloak_users(max_users=500)
        result = []
        for ku in kc_users:
            kc_id = ku.get("id")
            email = ku.get("email") or ku.get("username") or ""
            username = ku.get("username") or email
            first = ku.get("firstName") or ""
            last = ku.get("lastName") or ""
            full_name = f"{first} {last}".strip() or username
            enabled = ku.get("enabled", True)
            email_verified = ku.get("emailVerified", True)
            created_ts = ku.get("createdTimestamp")
            created_dt = (
                datetime.fromtimestamp(created_ts / 1000.0, tz=timezone.utc)
                if created_ts
                else None
            )

            # Get user realm roles
            roles = keycloak_admin.get_user_realm_roles(kc_id) if kc_id else []
            mapped_role = "DISPATCHER"
            for r in roles:
                r_lower = r.lower()
                if r_lower == "admin":
                    mapped_role = "ADMIN"
                    break
                elif r_lower in ("store_manager", "warehouse_manager"):
                    mapped_role = "STORE_MANAGER"
                    break
                elif r_lower == "driver":
                    mapped_role = "DRIVER"
                    break
                elif r_lower == "loader":
                    mapped_role = "LOADER"
                    break
                elif r_lower == "dispatcher":
                    mapped_role = "DISPATCHER"

            # Filter checks
            if is_active is not None and enabled != is_active:
                continue
            if role and role.upper() != "ALL" and mapped_role.upper() != role.upper():
                continue
            if q:
                q_low = q.lower()
                if q_low not in email.lower() and q_low not in full_name.lower() and q_low not in username.lower():
                    continue

            # Maintain operational shadow row in local PostgreSQL for foreign keys
            shadow = keycloak_admin.shadow_keycloak_user_to_db(
                db=db,
                kc_id=kc_id,
                email=email,
                full_name=full_name,
                role_name=mapped_role,
                is_active=enabled,
            )

            user_assigned_depot = depot_assignments.get(shadow.id) if shadow else None

            result.append(
                AdminUserRead(
                    id=shadow.id if shadow else None,
                    keycloak_id=kc_id,
                    username=username,
                    email=email,
                    full_name=full_name,
                    role=mapped_role,
                    role_display=role_to_display(mapped_role),
                    assigned_depot=user_assigned_depot,
                    is_active=enabled,
                    email_verified=email_verified,
                    is_keycloak_managed=True,
                    created_at=created_dt or (shadow.created_at if shadow else None),
                    updated_at=shadow.updated_at if shadow else None,
                )
            )

        # Include local loaders if requested and not already provisioned in Keycloak
        if include_loaders and (not role or role.upper() == "LOADER"):
            kc_emails = {r.email.lower() for r in result if r.email}
            kc_names = {r.full_name.lower() for r in result if r.full_name}
            loader_query = db.query(LoaderUser)
            if is_active is not None:
                loader_query = loader_query.filter(LoaderUser.is_active == is_active)
            if q:
                l_pattern = f"%{q}%"
                loader_query = loader_query.filter(
                    or_(LoaderUser.full_name.ilike(l_pattern), LoaderUser.short_name.ilike(l_pattern))
                )
            for l in loader_query.all():
                l_email = f"{l.short_name.lower().replace(' ', '.')}@dock.waypoint.com"
                if l_email.lower() in kc_emails or l.full_name.lower() in kc_names:
                    continue
                result.append(
                    AdminUserRead(
                        id=10000 + l.id,
                        keycloak_id=f"loader-{l.id}",
                        username=l.short_name.lower().replace(" ", "."),
                        email=l_email,
                        full_name=l.full_name,
                        role="LOADER",
                        role_display="Dock Loader",
                        assigned_depot=None,
                        is_active=l.is_active,
                        is_keycloak_managed=False,
                        created_at=l.created_at,
                        updated_at=l.created_at,
                    )
                )

        return result


    # Fallback to local DB when Keycloak Admin is temporarily not configured
    query = db.query(User)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    if role:
        role_upper = role.upper()
        if role_upper == "STORE_MANAGER":
            query = query.filter(User.role == UserRole.WAREHOUSE_MANAGER)
        elif role_upper in UserRole.__members__:
            query = query.filter(User.role == UserRole[role_upper])
        elif role_upper == "LOADER":
            query = query.filter(User.id == -1)

    if q:
        search_pattern = f"%{q}%"
        query = query.filter(or_(User.email.ilike(search_pattern), User.full_name.ilike(search_pattern)))

    users = query.order_by(User.id.asc()).all()

    result = []
    for u in users:
        val = u.role.value if hasattr(u.role, "value") else str(u.role)
        mapped_role = "STORE_MANAGER" if val == "WAREHOUSE_MANAGER" else val
        result.append(
            AdminUserRead(
                id=u.id,
                keycloak_id=u.keycloak_id,
                username=u.email.split("@")[0] if u.email else None,
                email=u.email,
                full_name=u.full_name,
                role=mapped_role,
                role_display=role_to_display(val),
                assigned_depot=depot_assignments.get(u.id),
                is_active=u.is_active,
                is_keycloak_managed=bool(u.keycloak_id is not None),
                created_at=u.created_at,
                updated_at=u.updated_at,
            )
        )


    # Optionally include Loader workers if looking at all users or LOADER filter
    if include_loaders and (not role or role.upper() == "LOADER"):
        loader_query = db.query(LoaderUser)
        if is_active is not None:
            loader_query = loader_query.filter(LoaderUser.is_active == is_active)
        if q:
            l_pattern = f"%{q}%"
            loader_query = loader_query.filter(
                or_(LoaderUser.full_name.ilike(l_pattern), LoaderUser.short_name.ilike(l_pattern))
            )
        for l in loader_query.all():
            result.append(
                AdminUserRead(
                    id=10000 + l.id,
                    keycloak_id=f"loader-{l.id}",
                    username=l.short_name.lower().replace(" ", "."),
                    email=f"{l.short_name.lower().replace(' ', '.')}@dock.waypoint.com",
                    full_name=l.full_name,
                    role="LOADER",
                    role_display="Loader",
                    is_active=l.is_active,
                    is_keycloak_managed=False,
                    created_at=l.created_at,
                    updated_at=l.created_at,
                )
            )

    return result


@router.post("/users/sync", response_model=KeycloakSyncResult)
def sync_users_from_keycloak(
    db: Session = Depends(deps.get_db),
) -> Any:
    """Manually reconcile all Keycloak realm users into the local PostgreSQL database."""
    result = keycloak_admin.sync_keycloak_to_db(db)
    record_audit(
        action_type="USER_SYNC",
        entity_name="Keycloak Directory",
        summary=result["message"],
        severity="INFO" if result["success"] else "WARNING",
    )
    return KeycloakSyncResult(**result)



@router.post("/users", response_model=AdminUserRead, status_code=status.HTTP_201_CREATED)
def create_admin_user(
    user_in: AdminUserCreate,
    db: Session = Depends(deps.get_db),
) -> Any:
    # Check if user already exists in local DB
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists.")

    role_str = user_in.role.upper()

    # 1. Require Keycloak and provision user directly in Keycloak
    if not keycloak_admin.is_keycloak_admin_configured():
        raise HTTPException(
            status_code=400,
            detail="Keycloak Admin is not configured. Please save your valid KEYCLOAK_CLIENT_SECRET in backend/.env to create users in Keycloak.",
        )

    kc_id, kc_err = keycloak_admin.create_keycloak_user(
        email=user_in.email,
        full_name=user_in.full_name,
        password=user_in.password,
        role=role_str,
        is_active=user_in.is_active,
    )
    if kc_err:
        raise HTTPException(status_code=400, detail=f"Keycloak Provisioning Error: {kc_err}")

    # 2. Shadow user into local PostgreSQL database for foreign key relational integrity
    new_user = keycloak_admin.shadow_keycloak_user_to_db(
        db=db,
        kc_id=kc_id,
        email=user_in.email,
        full_name=user_in.full_name,
        role_name=role_str,
        is_active=user_in.is_active,
    )

    # 3. If role is LOADER, also ensure LoaderUser record exists for physical dock tablet PIN stations
    if role_str == "LOADER":
        short_name = user_in.full_name.split()[0] if user_in.full_name else "Loader"
        pin_digits = "".join(c for c in (user_in.password or "") if c.isdigit())
        if len(pin_digits) < 4:
            pin_digits = "1234"
        else:
            pin_digits = pin_digits[:4]
        existing_loader = db.query(LoaderUser).filter(LoaderUser.full_name == user_in.full_name).first()
        if not existing_loader:
            new_loader = LoaderUser(
                full_name=user_in.full_name,
                short_name=short_name,
                pin_hash=security.get_password_hash(pin_digits),
                is_active=user_in.is_active,
            )
            db.add(new_loader)
            db.commit()

    # 4. If role is DISPATCHER and assigned_depot is provided, assign dispatcher to depot
    assigned_depot_result = None
    if role_str == "DISPATCHER" and user_in.assigned_depot:
        depot_val = user_in.assigned_depot.strip().lower()
        if depot_val in ("peliyagoda", "kandy"):
            target_depot = Depot.PELIYAGODA if depot_val == "peliyagoda" else Depot.KANDY
            # Delete any existing assignment on that depot or user
            db.query(DepotDispatcherAssignment).filter(
                or_(DepotDispatcherAssignment.depot == target_depot, DepotDispatcherAssignment.user_id == new_user.id)
            ).delete()
            db.add(DepotDispatcherAssignment(depot=target_depot, user_id=new_user.id))
            db.commit()
            assigned_depot_result = depot_val

    val = new_user.role.value if hasattr(new_user.role, "value") else str(new_user.role)
    mapped_role = "STORE_MANAGER" if val in ("STORE_MANAGER", "WAREHOUSE_MANAGER") else val

    record_audit(
        action_type="USER_MUTATION",
        entity_name="Keycloak User Account",
        entity_id=kc_id,
        summary=f"Provisioned Keycloak user {new_user.full_name} ({new_user.email}) with realm role {keycloak_admin.db_role_to_kc(val)}.",
        severity="INFO",
    )

    return AdminUserRead(
        id=new_user.id,
        keycloak_id=kc_id,
        username=new_user.email.split("@")[0] if new_user.email else kc_id,
        email=new_user.email,
        full_name=new_user.full_name,
        role=mapped_role,
        role_display=role_to_display(mapped_role),
        assigned_depot=assigned_depot_result,
        is_active=new_user.is_active,
        is_keycloak_managed=True,
        created_at=new_user.created_at,
        updated_at=new_user.updated_at,
    )



@router.put("/users/{user_id}", response_model=AdminUserRead)
def update_admin_user(
    user_id: str,
    user_in: AdminUserUpdate,
    db: Session = Depends(deps.get_db),
) -> Any:
    # 1. Check if user is a loader worker
    if str(user_id).startswith("loader-") or (str(user_id).isdigit() and int(user_id) >= 10000):
        loader_id = int(str(user_id).replace("loader-", "")) if not str(user_id).isdigit() else int(user_id) - 10000
        loader = db.query(LoaderUser).filter(LoaderUser.id == loader_id).first()
        if not loader:
            raise HTTPException(status_code=404, detail="Loader not found.")

        diff = {}
        if user_in.full_name is not None and user_in.full_name != loader.full_name:
            diff["full_name"] = {"old": loader.full_name, "new": user_in.full_name}
            loader.full_name = user_in.full_name
            loader.short_name = user_in.full_name.split()[0]
        if user_in.is_active is not None and user_in.is_active != loader.is_active:
            diff["is_active"] = {"old": loader.is_active, "new": user_in.is_active}
            loader.is_active = user_in.is_active
        if user_in.password:
            pin_digits = "".join(c for c in user_in.password if c.isdigit())
            if len(pin_digits) >= 4:
                loader.pin_hash = security.get_password_hash(pin_digits[:4])
                diff["pin"] = "Updated"

        db.commit()
        db.refresh(loader)

        record_audit(
            action_type="USER_MUTATION",
            entity_name="Loader Account",
            entity_id=str(user_id),
            summary=f"Updated details for loader {loader.full_name}.",
            severity="INFO",
            diff=diff,
        )

        return AdminUserRead(
            id=10000 + loader.id,
            keycloak_id=f"loader-{loader.id}",
            username=loader.short_name.lower().replace(" ", "."),
            email=user_in.email or f"{loader.short_name.lower().replace(' ', '.')}@dock.waypoint.com",
            full_name=loader.full_name,
            role="LOADER",
            role_display="Loader",
            is_active=loader.is_active,
            is_keycloak_managed=False,
            created_at=loader.created_at,
            updated_at=loader.created_at,
        )

    # 2. Keycloak user update (Primary)
    kc_id = str(user_id)
    # Check if user_id is a local integer ID
    if kc_id.isdigit():
        local_u = db.query(User).filter(User.id == int(kc_id)).first()
        if local_u and local_u.keycloak_id:
            kc_id = local_u.keycloak_id

    # If Keycloak is active, perform update in Keycloak
    if keycloak_admin.is_keycloak_admin_configured():
        ok, err = keycloak_admin.update_keycloak_user(
            keycloak_id=kc_id,
            full_name=user_in.full_name,
            email=user_in.email,
            role=user_in.role,
            is_active=user_in.is_active,
            password=user_in.password if user_in.password else None,
        )
        if not ok:
            raise HTTPException(status_code=400, detail=f"Keycloak Update Error: {err}")

    # Maintain local PostgreSQL shadow
    target_email = user_in.email
    target_name = user_in.full_name
    target_role = user_in.role or "DISPATCHER"
    target_active = user_in.is_active if user_in.is_active is not None else True

    local_u = db.query(User).filter(or_(User.keycloak_id == kc_id, User.email == target_email)).first()
    if local_u:
        if user_in.email:
            local_u.email = user_in.email
        if user_in.full_name:
            local_u.full_name = user_in.full_name
        if user_in.is_active is not None:
            local_u.is_active = user_in.is_active
        if user_in.role:
            local_u.role = keycloak_admin.kc_role_to_db(user_in.role)
        local_u.keycloak_id = kc_id
        db.commit()
        db.refresh(local_u)
    else:
        local_u = keycloak_admin.shadow_keycloak_user_to_db(
            db=db,
            kc_id=kc_id,
            email=target_email or f"{kc_id}@waypoint.com",
            full_name=target_name or "Operator",
            role_name=target_role,
            is_active=target_active,
        )

    # Handle depot assignment update if requested
    if user_in.assigned_depot is not None:
        depot_val = user_in.assigned_depot.strip().lower()
        if depot_val in ("peliyagoda", "kandy"):
            target_depot = Depot.PELIYAGODA if depot_val == "peliyagoda" else Depot.KANDY
            # Remove any existing assignment for this user across all depots
            db.query(DepotDispatcherAssignment).filter(DepotDispatcherAssignment.user_id == local_u.id).delete()
            # Reassign target depot
            existing_depot_assignment = db.get(DepotDispatcherAssignment, target_depot)
            if existing_depot_assignment:
                existing_depot_assignment.user_id = local_u.id
            else:
                db.add(DepotDispatcherAssignment(depot=target_depot, user_id=local_u.id))
            db.commit()
        elif depot_val in ("unassigned", "none", ""):
            db.query(DepotDispatcherAssignment).filter(DepotDispatcherAssignment.user_id == local_u.id).delete()
            db.commit()

    # Query current assignment
    cur_assignment = db.query(DepotDispatcherAssignment).filter(DepotDispatcherAssignment.user_id == local_u.id).first()
    assigned_depot_val = cur_assignment.depot.value if cur_assignment and hasattr(cur_assignment.depot, "value") else (str(cur_assignment.depot).lower() if cur_assignment else None)

    val = local_u.role.value if hasattr(local_u.role, "value") else str(local_u.role)
    mapped_role = "STORE_MANAGER" if val == "WAREHOUSE_MANAGER" else val

    record_audit(
        action_type="USER_MUTATION",
        entity_name="Keycloak User Account",
        entity_id=kc_id,
        summary=f"Updated details for Keycloak user {local_u.full_name} ({local_u.email}).",
        severity="INFO",
    )

    return AdminUserRead(
        id=local_u.id,
        keycloak_id=kc_id,
        username=local_u.email.split("@")[0] if local_u.email else kc_id,
        email=local_u.email,
        full_name=local_u.full_name,
        role=mapped_role,
        role_display=role_to_display(val),
        assigned_depot=assigned_depot_val,
        is_active=local_u.is_active,
        is_keycloak_managed=True,
        created_at=local_u.created_at,
        updated_at=local_u.updated_at,
    )


@router.patch("/users/{user_id}/status", response_model=AdminUserRead)
def toggle_admin_user_status(
    user_id: str,
    status_in: UserStatusToggle,
    db: Session = Depends(deps.get_db),
) -> Any:
    # 1. Loader check
    if str(user_id).startswith("loader-") or (str(user_id).isdigit() and int(user_id) >= 10000):
        loader_id = int(str(user_id).replace("loader-", "")) if not str(user_id).isdigit() else int(user_id) - 10000
        loader = db.query(LoaderUser).filter(LoaderUser.id == loader_id).first()
        if not loader:
            raise HTTPException(status_code=404, detail="Loader not found.")

        loader.is_active = status_in.is_active
        db.commit()
        db.refresh(loader)

        status_str = "ENABLED" if loader.is_active else "DISABLED"
        record_audit(
            action_type="USER_MUTATION",
            entity_name="Loader Account",
            entity_id=str(user_id),
            summary=f"Loader {loader.full_name} account was {status_str}.",
            severity="WARNING" if not loader.is_active else "INFO",
        )

        return AdminUserRead(
            id=10000 + loader.id,
            keycloak_id=f"loader-{loader.id}",
            username=loader.short_name.lower().replace(" ", "."),
            email=f"{loader.short_name.lower().replace(' ', '.')}@dock.waypoint.com",
            full_name=loader.full_name,
            role="LOADER",
            role_display="Loader",
            is_active=loader.is_active,
            is_keycloak_managed=False,
            created_at=loader.created_at,
            updated_at=loader.created_at,
        )

    # 2. Keycloak user status toggle (Primary)
    kc_id = str(user_id)
    if kc_id.isdigit():
        local_u = db.query(User).filter(User.id == int(kc_id)).first()
        if local_u and local_u.keycloak_id:
            kc_id = local_u.keycloak_id

    if keycloak_admin.is_keycloak_admin_configured():
        ok, err = keycloak_admin.toggle_keycloak_user_status(keycloak_id=kc_id, is_active=status_in.is_active)
        if not ok:
            raise HTTPException(status_code=400, detail=f"Keycloak Status Toggle Error: {err}")

    # Update local shadow
    local_u = db.query(User).filter(or_(User.keycloak_id == kc_id, User.id == int(kc_id) if kc_id.isdigit() else False)).first()
    if local_u:
        local_u.is_active = status_in.is_active
        db.commit()
        db.refresh(local_u)

    status_str = "ENABLED" if status_in.is_active else "DISABLED"
    record_audit(
        action_type="USER_MUTATION",
        entity_name="Keycloak User Account",
        entity_id=kc_id,
        summary=f"Keycloak account {local_u.email if local_u else kc_id} was {status_str}.",
        severity="WARNING" if not status_in.is_active else "INFO",
    )

    val = local_u.role.value if local_u and hasattr(local_u.role, "value") else "DISPATCHER"
    mapped_role = "STORE_MANAGER" if val == "WAREHOUSE_MANAGER" else val

    return AdminUserRead(
        id=local_u.id if local_u else None,
        keycloak_id=kc_id,
        username=local_u.email.split("@")[0] if local_u and local_u.email else kc_id,
        email=local_u.email if local_u else "",
        full_name=local_u.full_name if local_u else "",
        role=mapped_role,
        role_display=role_to_display(val),
        is_active=status_in.is_active,
        is_keycloak_managed=True,
        created_at=local_u.created_at if local_u else None,
        updated_at=local_u.updated_at if local_u else None,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_user(
    user_id: str,
    db: Session = Depends(deps.get_db),
) -> None:
    """Permanently delete user from Keycloak realm."""
    kc_id = str(user_id)
    if kc_id.isdigit() and int(kc_id) >= 10000:
        loader_id = int(kc_id) - 10000
        loader = db.query(LoaderUser).filter(LoaderUser.id == loader_id).first()
        if loader:
            db.delete(loader)
            db.commit()
            return None

    if kc_id.isdigit():
        local_u = db.query(User).filter(User.id == int(kc_id)).first()
        if local_u and local_u.keycloak_id:
            kc_id = local_u.keycloak_id

    if keycloak_admin.is_keycloak_admin_configured():
        ok, err = keycloak_admin.delete_keycloak_user(kc_id)
        if not ok:
            raise HTTPException(status_code=400, detail=f"Keycloak Delete Error: {err}")

    # Remove or deactivate local shadow record
    local_u = db.query(User).filter(or_(User.keycloak_id == kc_id, User.id == int(kc_id) if kc_id.isdigit() else False)).first()
    if local_u:
        local_u.is_active = False
        db.commit()

    record_audit(
        action_type="USER_DELETION",
        entity_name="Keycloak User Account",
        entity_id=kc_id,
        summary=f"Purged Keycloak account {kc_id} from IAM directory.",
        severity="WARNING",
    )
    return None


@router.post("/users/{user_id}/reset-password", response_model=Dict[str, Any])
def reset_admin_user_password(
    user_id: str,
    payload: AdminUserPasswordReset,
    db: Session = Depends(deps.get_db),
) -> Any:
    """Reset user password directly in Keycloak."""
    kc_id = str(user_id)
    if kc_id.isdigit():
        local_u = db.query(User).filter(User.id == int(kc_id)).first()
        if local_u and local_u.keycloak_id:
            kc_id = local_u.keycloak_id

    if not keycloak_admin.is_keycloak_admin_configured():
        raise HTTPException(status_code=400, detail="Keycloak Admin is not configured.")

    ok, err = keycloak_admin.reset_keycloak_user_password(
        keycloak_id=kc_id,
        new_password=payload.password,
        temporary=payload.temporary,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=f"Keycloak Password Reset Error: {err}")

    record_audit(
        action_type="PASSWORD_RESET",
        entity_name="Keycloak IAM Password",
        entity_id=kc_id,
        summary=f"Admin reset Keycloak password for user {kc_id} (temporary={payload.temporary}).",
        severity="INFO",
    )
    return {"success": True, "message": "Password successfully updated in Keycloak."}



# ── 3. Roles & Access Endpoints ───────────────────────────

@router.get("/roles", response_model=List[RoleDetail])
def get_roles_and_access(db: Session = Depends(deps.get_db)) -> Any:
    users = db.query(User).all()
    loaders = db.query(LoaderUser).all()

    counts = {
        "DISPATCHER": sum(1 for u in users if u.role == UserRole.DISPATCHER),
        "STORE_MANAGER": sum(1 for u in users if u.role == UserRole.WAREHOUSE_MANAGER),
        "DRIVER": sum(1 for u in users if u.role == UserRole.DRIVER),
        "LOADER": len(loaders),
        "ADMIN": sum(1 for u in users if u.role == UserRole.ADMIN),
    }

    roles_data = [
        RoleDetail(
            key="DISPATCHER",
            name="dispatcher",
            display_title="Dispatcher",
            description="Operational coordination, multi-stop manifest planning, vehicle allocation, real-time live route sequencing, and exception handling.",
            user_count=counts["DISPATCHER"],
            badge_variant="bg-blue-100 text-blue-800 border-blue-300",
            permissions=[
                RolePermissionItem(id="view_manifests", name="View Run Manifests", description="Access scheduled trips and stops", granted=True),
                RolePermissionItem(id="allocate_vehicles", name="Allocate Fleet & Drivers", description="Assign vehicles and drivers to delivery runs", granted=True),
                RolePermissionItem(id="edit_stops", name="Dynamic Drop Sequencing", description="Re-order stops and update destination addresses", granted=True),
                RolePermissionItem(id="live_tracking", name="GPS Live Tracking", description="Track vehicle locations and delivery ETAs", granted=True),
                RolePermissionItem(id="exception_override", name="Exception Override", description="Force complete or cancel problematic trips", granted=True),
            ]
        ),
        RoleDetail(
            key="LOADER",
            name="loader",
            display_title="Loader",
            description="Dock barcode scanning, reverse drop order verification, cold-chain temperature checks, and shortfall discrepancy reporting.",
            user_count=counts["LOADER"],
            badge_variant="bg-teal-100 text-teal-900 border-teal-300",
            permissions=[
                RolePermissionItem(id="scan_dock", name="Dock Barcode Scanner", description="Scan cartons into loading bays", granted=True),
                RolePermissionItem(id="reverse_sequence", name="Reverse Sequence Check", description="Enforce loading last drop first", granted=True),
                RolePermissionItem(id="temp_verification", name="Reefer Temp Sign-Off", description="Log pre-departure chilled cargo temperatures", granted=True),
                RolePermissionItem(id="report_shortfall", name="Report Cargo Shortfall", description="Flag missing or damaged cartons before release", granted=True),
                RolePermissionItem(id="release_run", name="Release Run for Departure", description="Authorize driver departure from loading bay", granted=True),
            ]
        ),
        RoleDetail(
            key="DRIVER",
            name="driver",
            display_title="Driver",
            description="Phone-optimized turn-by-turn navigation, next-stop ETA inspection, electronic Proof of Delivery (e-POD), and offline sync.",
            user_count=counts["DRIVER"],
            badge_variant="bg-indigo-100 text-indigo-900 border-indigo-300",
            permissions=[
                RolePermissionItem(id="view_trip", name="View Assigned Trip", description="Access turn-by-turn sequence and navigation", granted=True),
                RolePermissionItem(id="update_stop_status", name="Update Stop Arrival", description="Mark arrived and completed at delivery outlet", granted=True),
                RolePermissionItem(id="capture_pod", name="Capture Digital POD", description="Record recipient signature and delivery photos", granted=True),
                RolePermissionItem(id="offline_sync", name="Offline Trip Cache", description="Continue operation in low-connectivity areas", granted=True),
                RolePermissionItem(id="driver_sos", name="Trigger SOS Alert", description="Send immediate distress signal to dispatchers", granted=True),
            ]
        ),
        RoleDetail(
            key="STORE_MANAGER",
            name="store_manager",
            display_title="Store Manager",
            description="Store portal for inspecting inbound delivery windows, carton tally receipt sign-off, and placing replenishment goods requests.",
            user_count=counts["STORE_MANAGER"],
            badge_variant="bg-emerald-100 text-emerald-900 border-emerald-300",
            permissions=[
                RolePermissionItem(id="view_inbound", name="View Inbound Windows", description="Check estimated arrival times and carton tallies", granted=True),
                RolePermissionItem(id="create_order", name="New Goods Request", description="Place store replenishment requests with priority flags", granted=True),
                RolePermissionItem(id="sign_receipt", name="Sign Delivery Receipt", description="Verify physical carton count and report discrepancies", granted=True),
                RolePermissionItem(id="store_settings", name="Outlet Settings", description="Manage manager contacts and unloading preferences", granted=True),
            ]
        ),
        RoleDetail(
            key="ADMIN",
            name="admin",
            display_title="System Administrator",
            description="Full system control: user account provisioning, role assignments, fleet configuration, operational constraints, and audit monitoring.",
            user_count=counts["ADMIN"],
            badge_variant="bg-purple-100 text-purple-900 border-purple-300",
            permissions=[
                RolePermissionItem(id="manage_users", name="User & Role Administration", description="Create, edit, and deactivate all user accounts", granted=True),
                RolePermissionItem(id="manage_fleet", name="Fleet & Vehicle Administration", description="Manage vehicle specs, depot assignments, and status", granted=True),
                RolePermissionItem(id="manage_outlets", name="Outlets & Depots Management", description="Configure delivery parameters and depot allocations", granted=True),
                RolePermissionItem(id="operational_config", name="Operational Configuration", description="Configure delivery windows and trip constraints", granted=True),
                RolePermissionItem(id="view_audit_logs", name="Security & Audit Logging", description="Inspect comprehensive audit trail of administrative changes", granted=True),
            ]
        ),
    ]
    return roles_data


@router.post("/roles/assign")
def assign_user_role(
    assign_req: RoleAssignRequest,
    db: Session = Depends(deps.get_db),
) -> Any:
    user = db.query(User).filter(User.id == assign_req.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    role_str = assign_req.role.upper()
    if role_str == "STORE_MANAGER":
        target_role = UserRole.WAREHOUSE_MANAGER
    elif role_str in UserRole.__members__:
        target_role = UserRole[role_str]
    else:
        raise HTTPException(status_code=400, detail=f"Invalid role '{assign_req.role}'.")

    old_role = str(user.role)
    user.role = target_role
    db.commit()
    db.refresh(user)

    record_audit(
        action_type="ROLE_ASSIGNMENT",
        entity_name="User Role",
        entity_id=str(user.id),
        summary=f"Changed role for {user.full_name} ({user.email}) from {role_to_display(old_role)} to {role_to_display(str(target_role))}.",
        severity="INFO",
    )

    return {
        "message": f"Successfully updated role for {user.full_name} to {role_to_display(str(target_role))}",
        "user_id": user.id,
        "new_role": role_str,
    }


# ── 4. Depots Endpoint ────────────────────────────────────

def _depot_dispatcher(db: Session, depot: Depot) -> Optional[Dict[str, Any]]:
    assignment = db.get(DepotDispatcherAssignment, depot)
    if not assignment or not assignment.dispatcher:
        return None
    user = assignment.dispatcher
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "keycloak_id": user.keycloak_id,
    }


@router.put("/depots/{depot}/dispatcher")
def assign_depot_dispatcher(
    depot: Depot,
    payload: DepotDispatcherAssignRequest,
    db: Session = Depends(deps.get_db),
    _: User = Depends(deps.require_admin),
) -> Any:
    """Set or clear the single dispatcher responsible for a depot."""
    assignment = db.get(DepotDispatcherAssignment, depot)

    if payload.user_id is None and not payload.keycloak_id:
        if assignment:
            previous = assignment.dispatcher.full_name if assignment.dispatcher else "dispatcher"
            db.delete(assignment)
            db.commit()
            record_audit(
                action_type="DEPOT_DISPATCHER_UNASSIGNED",
                entity_name="Depot Dispatcher",
                entity_id=depot.value,
                summary=f"Removed {previous} as the dispatcher for {depot.value.title()}.",
                severity="INFO",
            )
        return {"depot": depot.value, "dispatcher": None}

    user = None
    if payload.user_id is not None:
        user = db.query(User).filter(User.id == payload.user_id).first()
    elif payload.keycloak_id is not None:
        user = db.query(User).filter(User.keycloak_id == payload.keycloak_id).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Active dispatcher user not found")
    if user.role != UserRole.DISPATCHER:
        raise HTTPException(status_code=422, detail="Only users with the Dispatcher role can be assigned to a depot")

    # A dispatcher can only be responsible for one depot. Moving them is
    # explicit: remove their previous assignment as part of this transaction.
    existing_for_user = db.query(DepotDispatcherAssignment).filter(
        DepotDispatcherAssignment.user_id == user.id
    ).first()
    if existing_for_user and existing_for_user.depot != depot:
        db.delete(existing_for_user)

    if assignment:
        assignment.user_id = user.id
    else:
        assignment = DepotDispatcherAssignment(depot=depot, user_id=user.id)
        db.add(assignment)
    db.commit()

    record_audit(
        action_type="DEPOT_DISPATCHER_ASSIGNED",
        entity_name="Depot Dispatcher",
        entity_id=depot.value,
        summary=f"Assigned {user.full_name} ({user.email}) as dispatcher for {depot.value.title()}.",
        severity="INFO",
    )
    return {"depot": depot.value, "dispatcher": _depot_dispatcher(db, depot)}

@router.get("/depots")
def get_admin_depots(db: Session = Depends(deps.get_db)) -> Any:
    vehicles = db.query(Vehicle).all()
    outlets = db.query(Outlet).all()

    p_vehicles = [
        {
            "id": v.id,
            "code": v.code,
            "vehicle_type": v.vehicle_type,
            "capacity_kg": v.capacity_kg,
            "capacity_vol_m3": v.capacity_vol_m3,
            "temperature_mode": v.temperature_mode,
            "status": v.status.value if hasattr(v.status, "value") else str(v.status),
            "weekly_fuel_status": v.weekly_fuel_status,
            "maintenance_state": v.maintenance_state,
        }
        for v in vehicles
        if (v.depot_name or "").lower() == "peliyagoda"
    ]

    k_vehicles = [
        {
            "id": v.id,
            "code": v.code,
            "vehicle_type": v.vehicle_type,
            "capacity_kg": v.capacity_kg,
            "capacity_vol_m3": v.capacity_vol_m3,
            "temperature_mode": v.temperature_mode,
            "status": v.status.value if hasattr(v.status, "value") else str(v.status),
            "weekly_fuel_status": v.weekly_fuel_status,
            "maintenance_state": v.maintenance_state,
        }
        for v in vehicles
        if (v.depot_name or "").lower() == "kandy"
    ]

    p_outlets = [
        {
            "id": o.id,
            "code": o.code,
            "name": o.name,
            "brand": o.brand.value.title() if hasattr(o.brand, "value") else str(o.brand).title(),
            "district": o.district,
            "dock_type": o.dock_type.value if hasattr(o.dock_type, "value") else str(o.dock_type),
            "van_only": o.van_only,
            "window_start": o.window_start.strftime("%H:%M") if o.window_start else "06:00",
            "window_end": o.window_end.strftime("%H:%M") if o.window_end else "18:00",
        }
        for o in outlets
        if (o.depot.value if hasattr(o.depot, "value") else str(o.depot)).lower() == "peliyagoda"
    ]

    k_outlets = [
        {
            "id": o.id,
            "code": o.code,
            "name": o.name,
            "brand": o.brand.value.title() if hasattr(o.brand, "value") else str(o.brand).title(),
            "district": o.district,
            "dock_type": o.dock_type.value if hasattr(o.dock_type, "value") else str(o.dock_type),
            "van_only": o.van_only,
            "window_start": o.window_start.strftime("%H:%M") if o.window_start else "06:00",
            "window_end": o.window_end.strftime("%H:%M") if o.window_end else "18:00",
        }
        for o in outlets
        if (o.depot.value if hasattr(o.depot, "value") else str(o.depot)).lower() == "kandy"
    ]

    return {
        "peliyagoda": {
            "key": "peliyagoda",
            "name": "Peliyagoda Central Depot",
            "code": "DEP-CMB-01",
            "address": "Kandy Road, Peliyagoda, Western Province",
            "district": "Gampaha / Colombo Metropolitan",
            "dock_count": 4,
            "docks": [
                {"id": 1, "code": "DCK-P01", "name": "Bay 1 - Ambient Bulk", "status": "Available"},
                {"id": 2, "code": "DCK-P02", "name": "Bay 2 - Chilled Reefer", "status": "Loading"},
                {"id": 3, "code": "DCK-P03", "name": "Bay 3 - Fast Dispatches", "status": "Available"},
                {"id": 4, "code": "DCK-P04", "name": "Bay 4 - Cross Dock", "status": "Available"},
            ],
            "tablets": [
                {"id": 1, "label": "Tablet Dock 1", "active": True},
                {"id": 2, "label": "Tablet Dock 2", "active": True},
                {"id": 3, "label": "Tablet Dock 3", "active": True},
            ],
            "vehicle_count": len(p_vehicles),
            "vehicles": p_vehicles,
            "outlet_count": len(p_outlets),
            "outlets": p_outlets,
            "dispatcher": _depot_dispatcher(db, Depot.PELIYAGODA),
        },
        "kandy": {
            "key": "kandy",
            "name": "Kandy Regional Depot",
            "code": "DEP-KDY-01",
            "address": "Katugastota Industrial Zone, Kandy, Central Province",
            "district": "Kandy / Central Highlands",
            "dock_count": 2,
            "docks": [
                {"id": 5, "code": "DCK-K01", "name": "Bay 1 - Central Ambience", "status": "Available"},
                {"id": 6, "code": "DCK-K02", "name": "Bay 2 - Mountain Chilled", "status": "Available"},
            ],
            "tablets": [
                {"id": 4, "label": "Kandy Dock Tablet A", "active": True},
                {"id": 5, "label": "Kandy Dock Tablet B", "active": True},
            ],
            "vehicle_count": len(k_vehicles),
            "vehicles": k_vehicles,
            "outlet_count": len(k_outlets),
            "outlets": k_outlets,
            "dispatcher": _depot_dispatcher(db, Depot.KANDY),
        }
    }


# ── 5. Operational Configuration Endpoints ─────────────────

@router.get("/config/operations", response_model=OperationalConfig)
def get_operational_config() -> Any:
    return _operational_config


@router.put("/config/operations", response_model=OperationalConfig)
def update_operational_config(config_in: OperationalConfig) -> Any:
    global _operational_config
    old_val = _operational_config.model_dump()
    _operational_config = config_in

    record_audit(
        action_type="CONFIG_UPDATE",
        entity_name="Operational Configuration",
        summary="Updated delivery windows and vehicle/trip constraint parameters.",
        severity="INFO",
        diff={"old": old_val, "new": config_in.model_dump()}
    )
    return _operational_config


@router.get("/config/calendar-days", response_model=List[CalendarDayAdminRead])
def get_calendar_days_config(
    db: Session = Depends(deps.get_db),
    start_date: Optional[date] = None,
    limit: int = 60,
) -> Any:
    query = db.query(CalendarDay)
    if start_date:
        query = query.filter(CalendarDay.date >= start_date)
    else:
        query = query.filter(CalendarDay.date >= date.today())
    
    days = query.order_by(CalendarDay.date.asc()).limit(limit).all()
    return days


@router.put("/config/calendar-days/{date_str}", response_model=CalendarDayAdminRead)
def update_calendar_day_config(
    date_str: str,
    day_in: CalendarDayAdminUpdate,
    db: Session = Depends(deps.get_db),
) -> Any:
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    cal_day = db.query(CalendarDay).filter(CalendarDay.date == target_date).first()
    if not cal_day:
        cal_day = CalendarDay(
            date=target_date,
            is_operating=day_in.is_operating if day_in.is_operating is not None else True,
            festival_ramp=day_in.festival_ramp if day_in.festival_ramp is not None else 1.0,
            monsoon=day_in.monsoon if day_in.monsoon is not None else False,
            holiday_name=day_in.holiday_name,
        )
        db.add(cal_day)
    else:
        if day_in.is_operating is not None:
            cal_day.is_operating = day_in.is_operating
        if day_in.festival_ramp is not None:
            cal_day.festival_ramp = day_in.festival_ramp
        if day_in.monsoon is not None:
            cal_day.monsoon = day_in.monsoon
        if day_in.holiday_name is not None:
            cal_day.holiday_name = day_in.holiday_name

    db.commit()
    db.refresh(cal_day)

    record_audit(
        action_type="CONFIG_UPDATE",
        entity_name="Operating Calendar",
        entity_id=date_str,
        summary=f"Updated calendar day {date_str}: Operating={cal_day.is_operating}, Ramp={cal_day.festival_ramp}x, Monsoon={cal_day.monsoon}.",
        severity="INFO" if cal_day.is_operating else "WARNING",
    )
    return cal_day


# ── 6. Audit Logs Endpoints ───────────────────────────────

@router.get("/audit-logs", response_model=List[AuditLogItem])
def get_audit_logs(
    action_type: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 50,
) -> Any:
    logs = _audit_logs
    if action_type:
        logs = [l for l in logs if l.action_type.upper() == action_type.upper()]
    if q:
        q_lower = q.lower()
        logs = [
            l for l in logs
            if q_lower in l.summary.lower()
            or q_lower in l.actor_email.lower()
            or q_lower in l.entity_name.lower()
        ]
    return logs[:limit]


@router.post("/audit-logs", response_model=AuditLogItem, status_code=status.HTTP_201_CREATED)
def create_audit_log(entry_in: AuditLogCreate) -> Any:
    entry = record_audit(
        action_type=entry_in.action_type,
        entity_name=entry_in.entity_name,
        entity_id=entry_in.entity_id,
        summary=entry_in.summary,
        actor_email=entry_in.actor_email,
        actor_name=entry_in.actor_name,
        severity=entry_in.severity,
        diff=entry_in.diff,
    )
    return entry


# ── 7. System Settings Endpoints ──────────────────────────

@router.get("/settings", response_model=SystemSettingsData)
def get_system_settings() -> Any:
    return _system_settings


@router.put("/settings", response_model=SystemSettingsData)
def update_system_settings(settings_in: SystemSettingsData) -> Any:
    global _system_settings
    old_data = _system_settings.model_dump()
    _system_settings = settings_in

    record_audit(
        action_type="CONFIG_UPDATE",
        entity_name="System Settings",
        summary="Application-level configuration updated (Keycloak, Routing, Alerts, Maintenance).",
        severity="WARNING" if settings_in.maintenance.maintenance_mode else "INFO",
        diff={"old": old_data, "new": settings_in.model_dump()}
    )
    return _system_settings
