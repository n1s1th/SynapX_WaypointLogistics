"""
Keycloak Admin REST API Client for Waypoint Logistics
Provides real-time two-way synchronization between Keycloak IAM and the backend PostgreSQL database.
"""

import logging
import time
from typing import Any, Dict, List, Optional, Tuple
import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User, UserRole

logger = logging.getLogger("keycloak_admin")

# In-memory token cache
_cached_token: Optional[str] = None
_token_expires_at: float = 0.0


def is_keycloak_admin_configured() -> bool:
    """Check if Keycloak admin credentials are configured and not placeholders."""
    secret = (settings.KEYCLOAK_CLIENT_SECRET or "").strip()
    return bool(secret and secret != "your_keycloak_client_secret_here" and len(secret) > 10)


def get_admin_token() -> Optional[str]:
    """
    Obtain a Bearer token for Keycloak Admin API using Client Credentials grant.
    Caches the token in memory until 30 seconds before expiration.
    """
    global _cached_token, _token_expires_at

    if not is_keycloak_admin_configured():
        return None

    now = time.time()
    if _cached_token and now < (_token_expires_at - 30):
        return _cached_token

    url = f"{settings.KEYCLOAK_URL.rstrip('/')}/realms/{settings.KEYCLOAK_REALM}/protocol/openid-connect/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": settings.KEYCLOAK_CLIENT_ID,
        "client_secret": settings.KEYCLOAK_CLIENT_SECRET,
    }

    try:
        res = requests.post(
            url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if res.status_code != 200:
            logger.warning(f"Keycloak admin token request failed ({res.status_code}): {res.text}")
            return None

        data = res.json()
        token = data.get("access_token")
        expires_in = data.get("expires_in", 60)

        _cached_token = token
        _token_expires_at = now + expires_in
        return token
    except Exception as exc:
        logger.error(f"Error connecting to Keycloak token endpoint: {exc}")
        return None


def _get_admin_headers() -> Optional[Dict[str, str]]:
    token = get_admin_token()
    if not token:
        return None
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _admin_base_url() -> str:
    return f"{settings.KEYCLOAK_URL.rstrip('/')}/admin/realms/{settings.KEYCLOAK_REALM}"


# In-memory roles cache
_cached_roles: Optional[Dict[str, Dict[str, Any]]] = None
_roles_expires_at: float = 0.0

KEYCLOAK_APP_ROLES = {"admin", "dispatcher", "driver", "loader", "store_manager"}


# ── Role Mapping Utilities ───────────────────────────────────────────────────

def get_all_realm_roles(force_refresh: bool = False) -> Dict[str, Dict[str, Any]]:
    """
    Fetch all realm roles from Keycloak Admin API and cache them.
    Keyed by lowercase role name (e.g. 'admin', 'dispatcher', 'driver', 'loader', 'store_manager').
    """
    global _cached_roles, _roles_expires_at

    now = time.time()
    if not force_refresh and _cached_roles is not None and now < _roles_expires_at:
        return _cached_roles

    headers = _get_admin_headers()
    if not headers:
        return {}

    url = f"{_admin_base_url()}/roles"
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            roles_list = res.json()
            mapping = {r["name"].lower().strip(): r for r in roles_list if "name" in r}
            _cached_roles = mapping
            _roles_expires_at = now + 120  # cache for 2 minutes
            return mapping
        logger.warning(f"Keycloak get all roles failed ({res.status_code}): {res.text}")
        return _cached_roles or {}
    except Exception as exc:
        logger.error(f"Failed to query Keycloak realm roles: {exc}")
        return _cached_roles or {}


def get_realm_role_representation(role_name: str) -> Optional[Dict[str, Any]]:
    """Retrieve the role representation from Keycloak for assignment using cached realm roles."""
    roles = get_all_realm_roles()
    target = role_name.lower().strip()
    if target in roles:
        return roles[target]
    # Try refreshing cache once if not found
    roles = get_all_realm_roles(force_refresh=True)
    return roles.get(target)


def kc_role_to_db(role_name: str) -> UserRole:
    rn = str(role_name).lower().strip()
    if rn == "admin":
        return UserRole.ADMIN
    elif rn == "driver":
        return UserRole.DRIVER
    elif rn in ("store_manager", "warehouse_manager"):
        return UserRole.STORE_MANAGER
    elif rn == "loader":
        return UserRole.LOADER
    elif rn == "dispatcher":
        return UserRole.DISPATCHER
    return UserRole.DISPATCHER


def db_role_to_kc(db_role: Any) -> str:
    val = (db_role.value if hasattr(db_role, "value") else str(db_role)).strip().upper()
    if val == "ADMIN":
        return "admin"
    elif val == "DRIVER":
        return "driver"
    elif val in ("WAREHOUSE_MANAGER", "STORE_MANAGER"):
        return "store_manager"
    elif val == "LOADER":
        return "loader"
    return "dispatcher"


def set_user_realm_role(user_id: str, new_role: str) -> Tuple[bool, Optional[str]]:
    """
    Ensure the user is mapped to the requested Keycloak realm role,
    and remove any previous application realm roles to prevent conflicting role accumulation.
    Preserves default system roles (default-roles-waypointlogistics, offline_access, uma_authorization).
    """
    headers = _get_admin_headers()
    if not headers:
        return False, "Keycloak Admin API is not configured or reachable."

    target_kc_role = db_role_to_kc(new_role)
    target_role_rep = get_realm_role_representation(target_kc_role)
    if not target_role_rep:
        return False, f"Keycloak role '{target_kc_role}' not found in realm."

    # Fetch user's current realm role mappings
    url = f"{_admin_base_url()}/users/{user_id}/role-mappings/realm"
    try:
        res = requests.get(url, headers=headers, timeout=5)
        current_roles = res.json() if res.status_code == 200 else []

        # Find any existing application roles that should be pruned
        roles_to_remove = [
            r for r in current_roles
            if r.get("name", "").lower() in KEYCLOAK_APP_ROLES
            and r.get("name", "").lower() != target_kc_role
        ]
        if roles_to_remove:
            requests.delete(url, headers=headers, json=roles_to_remove, timeout=5)

        # Assign the target role if not already assigned
        already_assigned = any(r.get("name", "").lower() == target_kc_role for r in current_roles)
        if not already_assigned:
            post_res = requests.post(url, headers=headers, json=[target_role_rep], timeout=5)
            if post_res.status_code not in (200, 204):
                return False, f"Failed to assign role {target_kc_role}: {post_res.text}"

        return True, None
    except Exception as exc:
        logger.error(f"Failed to set realm role for user {user_id}: {exc}")
        return False, str(exc)


# ── Keycloak User Operations ─────────────────────────────────────────────────

def list_keycloak_users(search: Optional[str] = None, max_users: int = 200) -> List[Dict[str, Any]]:
    """Fetch users directly from Keycloak Admin REST API."""
    headers = _get_admin_headers()
    if not headers:
        return []

    url = f"{_admin_base_url()}/users"
    params: Dict[str, Any] = {"max": max_users}
    if search:
        params["search"] = search

    try:
        res = requests.get(url, headers=headers, params=params, timeout=10)
        if res.status_code == 200:
            return res.json()
        logger.warning(f"Keycloak list_users failed ({res.status_code}): {res.text}")
        return []
    except Exception as exc:
        logger.error(f"Failed to query Keycloak users: {exc}")
        return []


def get_user_realm_roles(user_id: str) -> List[str]:
    """Retrieve realm roles assigned to a Keycloak user."""
    headers = _get_admin_headers()
    if not headers:
        return []

    url = f"{_admin_base_url()}/users/{user_id}/role-mappings/realm"
    try:
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            return [r.get("name") for r in res.json() if r.get("name")]
        return []
    except Exception as exc:
        logger.error(f"Failed to get realm roles for Keycloak user {user_id}: {exc}")
        return []


def create_keycloak_user(
    email: str,
    full_name: str,
    password: str,
    role: str,
    is_active: bool = True,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Creates a user in Keycloak, sets their password, and assigns the appropriate realm role.
    Returns (user_id, error_message).
    """
    headers = _get_admin_headers()
    if not headers:
        return None, "Keycloak Admin API is not configured or reachable."

    names = full_name.strip().split(" ", 1)
    first_name = names[0]
    last_name = names[1] if len(names) > 1 else ""

    user_payload = {
        "username": email,
        "email": email,
        "firstName": first_name,
        "lastName": last_name,
        "enabled": is_active,
        "emailVerified": True,
        "credentials": [
            {
                "type": "password",
                "value": password,
                "temporary": False,
            }
        ],
    }

    url = f"{_admin_base_url()}/users"
    try:
        res = requests.post(url, headers=headers, json=user_payload, timeout=10)
        if res.status_code not in (201, 204):
            err_msg = res.json().get("errorMessage", res.text) if res.text else f"Status {res.status_code}"
            return None, f"Keycloak error: {err_msg}"

        # Extract user_id from Location header (format: .../users/{id})
        location = res.headers.get("Location", "")
        kc_user_id = location.rstrip("/").split("/")[-1] if location else None

        if not kc_user_id:
            # Query by email as fallback
            found = list_keycloak_users(search=email, max_users=1)
            if found and found[0].get("email") == email:
                kc_user_id = found[0].get("id")

        if kc_user_id:
            # Assign realm role in Keycloak
            set_user_realm_role(kc_user_id, role)

        return kc_user_id, None
    except Exception as exc:
        logger.error(f"Failed to create Keycloak user: {exc}")
        return None, str(exc)


def update_keycloak_user(
    keycloak_id: str,
    full_name: Optional[str] = None,
    email: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    password: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """Updates user attributes, password, or role in Keycloak."""
    headers = _get_admin_headers()
    if not headers:
        return False, "Keycloak Admin API is not configured or reachable."

    payload: Dict[str, Any] = {}
    if full_name is not None:
        names = full_name.strip().split(" ", 1)
        payload["firstName"] = names[0]
        payload["lastName"] = names[1] if len(names) > 1 else ""
    if email is not None:
        payload["email"] = email
        payload["username"] = email
    if is_active is not None:
        payload["enabled"] = is_active

    try:
        if payload:
            url = f"{_admin_base_url()}/users/{keycloak_id}"
            res = requests.put(url, headers=headers, json=payload, timeout=10)
            if res.status_code not in (200, 204):
                return False, f"Keycloak update failed ({res.status_code}): {res.text}"

        # Password reset if requested
        if password:
            pw_url = f"{_admin_base_url()}/users/{keycloak_id}/reset-password"
            pw_payload = {
                "type": "password",
                "value": password,
                "temporary": False,
            }
            res_pw = requests.put(pw_url, headers=headers, json=pw_payload, timeout=5)
            if res_pw.status_code not in (200, 204):
                return False, f"Keycloak password reset failed ({res_pw.status_code}): {res_pw.text}"

        # Role update if requested
        if role:
            set_user_realm_role(keycloak_id, role)

        return True, None
    except Exception as exc:
        logger.error(f"Failed to update Keycloak user {keycloak_id}: {exc}")
        return False, str(exc)



def toggle_keycloak_user_status(keycloak_id: str, is_active: bool) -> Tuple[bool, Optional[str]]:
    """Enable or disable a user directly in Keycloak."""
    return update_keycloak_user(keycloak_id=keycloak_id, is_active=is_active)


def delete_keycloak_user(keycloak_id: str) -> Tuple[bool, Optional[str]]:
    """Permanently delete a user from Keycloak realm."""
    headers = _get_admin_headers()
    if not headers:
        return False, "Keycloak Admin API is not configured or reachable."

    url = f"{_admin_base_url()}/users/{keycloak_id}"
    try:
        res = requests.delete(url, headers=headers, timeout=10)
        if res.status_code in (200, 204):
            return True, None
        return False, f"Keycloak delete failed ({res.status_code}): {res.text}"
    except Exception as exc:
        logger.error(f"Failed to delete Keycloak user {keycloak_id}: {exc}")
        return False, str(exc)


def reset_keycloak_user_password(
    keycloak_id: str, new_password: str, temporary: bool = False
) -> Tuple[bool, Optional[str]]:
    """Reset password for a Keycloak user."""
    headers = _get_admin_headers()
    if not headers:
        return False, "Keycloak Admin API is not configured or reachable."

    url = f"{_admin_base_url()}/users/{keycloak_id}/reset-password"
    payload = {
        "type": "password",
        "value": new_password,
        "temporary": temporary,
    }
    try:
        res = requests.put(url, headers=headers, json=payload, timeout=10)
        if res.status_code in (200, 204):
            return True, None
        return False, f"Password reset failed ({res.status_code}): {res.text}"
    except Exception as exc:
        logger.error(f"Failed to reset password for user {keycloak_id}: {exc}")
        return False, str(exc)


def shadow_keycloak_user_to_db(
    db: Session,
    kc_id: str,
    email: str,
    full_name: str,
    role_name: str,
    is_active: bool = True,
) -> User:
    """
    Maintains a lightweight shadow row in PostgreSQL's `users` table
    purely for relational foreign keys (Vehicle.assigned_driver_id, Order.driver_id, etc.).
    No passwords are ever stored.
    """
    mapped_role = kc_role_to_db(role_name)

    # 1. Try finding by keycloak_id
    user = db.query(User).filter(User.keycloak_id == kc_id).first()
    if not user:
        # 2. Try finding by email
        user = db.query(User).filter(User.email.ilike(email)).first()

    if user:
        user.keycloak_id = kc_id
        if full_name:
            user.full_name = full_name
        if user.role != mapped_role:
            user.role = mapped_role
        user.is_active = is_active
        if not user.hashed_password or user.hashed_password != "KEYCLOAK_MANAGED_USER":
            user.hashed_password = "KEYCLOAK_MANAGED_USER"
    else:
        user = User(
            keycloak_id=kc_id,
            email=email,
            full_name=full_name or email,
            hashed_password="KEYCLOAK_MANAGED_USER",
            role=mapped_role,
            is_active=is_active,
        )
        db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        user = db.query(User).filter(User.email == email).first()

    return user


# ── Synchronization Engine ───────────────────────────────────────────────────

def sync_keycloak_to_db(db: Session) -> Dict[str, Any]:
    """
    Performs full two-way reconciliation:
    1. Fetches all users from Keycloak realm.
    2. Upserts each Keycloak user into the PostgreSQL `users` table.
    3. Preserves local relations (driver records, allocations).
    Returns metrics on synced, created, and updated records.
    """
    kc_users = list_keycloak_users(max_users=500)
    if not kc_users:
        return {
            "success": False,
            "message": "No users retrieved from Keycloak (check credentials or connection).",
            "synced_count": 0,
            "created_count": 0,
            "updated_count": 0,
            "keycloak_total": 0,
            "db_total": db.query(User).count(),
        }

    created = 0
    updated = 0

    for ku in kc_users:
        email = ku.get("email") or ku.get("username")
        if not email:
            continue

        first = ku.get("firstName") or ""
        last = ku.get("lastName") or ""
        full_name = f"{first} {last}".strip() or ku.get("username") or email
        is_active = ku.get("enabled", True)
        kc_id = ku.get("id")

        # Determine role from Keycloak realm roles
        roles = get_user_realm_roles(kc_id) if kc_id else []
        mapped_role = UserRole.DISPATCHER
        for r in roles:
            r_lower = r.lower().strip()
            if r_lower in KEYCLOAK_APP_ROLES or r_lower in ("store_manager", "warehouse_manager"):
                mapped_role = kc_role_to_db(r_lower)
                break

        # Look up existing user in local PostgreSQL DB
        local_user = db.query(User).filter(User.email.ilike(email)).first()
        if local_user:
            # Update fields
            changed = False
            if local_user.full_name != full_name and full_name:
                local_user.full_name = full_name
                changed = True
            if local_user.is_active != is_active:
                local_user.is_active = is_active
                changed = True
            if local_user.role != mapped_role:
                local_user.role = mapped_role
                changed = True

            if changed:
                updated += 1
        else:
            # Create new user in local DB
            new_u = User(
                email=email,
                full_name=full_name,
                hashed_password="KEYCLOAK_MANAGED_USER",
                role=mapped_role,
                is_active=is_active,
            )
            db.add(new_u)
            created += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to commit Keycloak sync to DB: {exc}")
        return {
            "success": False,
            "message": f"Database commit failed: {exc}",
            "synced_count": 0,
            "created_count": 0,
            "updated_count": 0,
            "keycloak_total": len(kc_users),
            "db_total": db.query(User).count(),
        }

    total_db = db.query(User).count()
    return {
        "success": True,
        "message": f"Successfully synced {len(kc_users)} Keycloak users ({created} added, {updated} updated).",
        "synced_count": len(kc_users),
        "created_count": created,
        "updated_count": updated,
        "keycloak_total": len(kc_users),
        "db_total": total_db,
    }
