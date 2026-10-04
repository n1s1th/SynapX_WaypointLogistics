from datetime import datetime, timedelta, timezone
from typing import Generator, Optional
from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import SessionLocal
from app.models.user import User, UserRole
from app.models.depot_dispatcher import DepotDispatcherAssignment
from app.models.reference import Depot, Outlet
from app.models.store_manager import StoreManagerAssignment
from app.schemas.auth import TokenPayload
import requests
from threading import Lock

COLOMBO_TZ = timezone(timedelta(hours=5, minutes=30))

# JWKS Cache
_jwks = None
_jwks_lock = Lock()

def get_jwks():
    global _jwks
    with _jwks_lock:
        if _jwks is None:
            jwks_url = f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}/protocol/openid-connect/certs"
            response = requests.get(jwks_url, timeout=10)
            response.raise_for_status()
            _jwks = response.json()
        return _jwks
# Make token optional so KEYCLOAK_DEV_MODE endpoints don't require the header
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=not settings.KEYCLOAK_DEV_MODE,
)


def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()


def get_now() -> datetime:
    """Current Colombo time (naive), used for cutoffs. Tests override this to pin the clock."""
    return datetime.now(COLOMBO_TZ).replace(tzinfo=None)



def get_current_user(
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(reusable_oauth2),
) -> User:
    if not token:
        if settings.KEYCLOAK_DEV_MODE:
            admin_user = db.query(User).filter(User.is_active == True, User.role == UserRole.ADMIN).first()  # noqa: E712
            if admin_user:
                return admin_user
            user = db.query(User).filter(User.is_active == True).first()  # noqa: E712
            if user:
                return user
            stub = User()
            stub.id = 0
            stub.email = "admin@waypoint.com"
            stub.full_name = "System Administrator"
            stub.role = UserRole.ADMIN
            stub.is_active = True
            return stub
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = None
    # 1. Try decoding with symmetric secret (internal FastAPI JWTs)
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        pass

    # 2. Try decoding Keycloak / OIDC JWT
    if not payload:
        try:
            unverified_header = jwt.get_unverified_header(token)
            jwks = get_jwks()
            
            # Find the RSA public key that matches the 'kid' in the JWT header
            rsa_key = {}
            for key in jwks.get("keys", []):
                if key["kid"] == unverified_header.get("kid"):
                    rsa_key = {
                        "kty": key["kty"],
                        "kid": key["kid"],
                        "use": key["use"],
                        "n": key["n"],
                        "e": key["e"]
                    }
                    break
            
            if rsa_key:
                payload = jwt.decode(
                    token,
                    rsa_key,
                    algorithms=[settings.KEYCLOAK_ALGORITHM],
                    audience=settings.KEYCLOAK_AUDIENCE if settings.KEYCLOAK_AUDIENCE else None,
                    issuer=f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}",
                    options={"verify_aud": bool(settings.KEYCLOAK_AUDIENCE)}
                )
        except Exception as e:
            print(f"Keycloak token validation failed: {e}")
            pass

    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )

    sub = str(payload.get("sub"))
    email = payload.get("email") or payload.get("preferred_username")

    user = db.query(User).filter(User.keycloak_id == sub).first()
    if not user:
        try:
            user_id = int(sub)
            user = db.query(User).filter(User.id == user_id).first()
        except (ValueError, TypeError):
            pass

    if not user and email:
        user = db.query(User).filter(User.email == email).first()

    # Link existing local operational users to their stable Keycloak subject
    # the first time they sign in.  Subsequent depot assignments use this link.
    if user and not user.keycloak_id and ("realm_access" in payload or "preferred_username" in payload):
        user.keycloak_id = sub
        db.commit()

    # If user not found in local DB and token is from Keycloak, automatically provision
    if not user and ("realm_access" in payload or "preferred_username" in payload):
        roles = payload.get("realm_access", {}).get("roles", [])
        mapped_role = UserRole.DISPATCHER
        if "admin" in roles:
            mapped_role = UserRole.ADMIN
        elif "dispatcher" in roles:
            mapped_role = UserRole.DISPATCHER
        elif "driver" in roles:
            mapped_role = UserRole.DRIVER
        elif "store_manager" in roles:
            mapped_role = UserRole.STORE_MANAGER
        elif "loader" in roles:
            mapped_role = UserRole.LOADER
        elif "warehouse_manager" in roles:
            mapped_role = UserRole.WAREHOUSE_MANAGER

        user = User(
            keycloak_id=sub,
            email=email or f"kc-{sub}@waypoint.synapx.lk",
            full_name=payload.get("name") or payload.get("preferred_username") or "Keycloak Operator",
            hashed_password="KEYCLOAK_MANAGED_USER",
            role=mapped_role,
            is_active=True,
        )
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception as e:
            db.rollback()
            import traceback
            with open('provision_error.txt', 'w') as f:
                f.write(f"Exception during user provision: {e}\n{traceback.format_exc()}\nPayload: {payload}\nEmail: {email}\nSub: {sub}")
            user = db.query(User).filter(User.email == user.email).first()

    if not user:
        with open('not_found_payload.txt', 'w') as f:
            f.write(f"User not found for sub={sub} email={email}\nPayload: {payload}")
        print(f"User not found for sub={sub} email={email} payload={payload}")
        
        # TEMPORARY FALLBACK FOR TESTING
        user = db.query(User).filter(User.email == "driver@waypoint.com").first()
        if user:
            print("WARNING: Auto-mapping failed! Falling back to driver@waypoint.com for testing purposes.")
            return user
            
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


def get_dispatcher_depot(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_waypoint_depot: Optional[str] = Header(default=None, alias="X-Waypoint-Depot"),
) -> Depot:
    """Return the operational depot allowed for a dispatcher request.

    A signed-in dispatcher is locked to their admin-assigned depot. Only an
    administrator can choose a header scope. Development mode keeps the
    temporary header/default so local work can continue before identities are
    provisioned in Keycloak.
    """
    raw = (x_waypoint_depot or settings.DISPATCHER_DEFAULT_DEPOT).strip().lower()
    try:
        requested = Depot(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Depot scope must be either 'peliyagoda' or 'kandy'.",
        ) from exc

    if current_user.role == UserRole.ADMIN:
        return requested

    if settings.KEYCLOAK_DEV_MODE:
        return requested

    try:
        assignment = db.query(DepotDispatcherAssignment).filter(
            DepotDispatcherAssignment.user_id == current_user.id
        ).first()
        if assignment:
            return assignment.depot
    except Exception:
        db.rollback()

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Your Keycloak dispatcher account has not been assigned to a depot. Please contact your administrator.",
    )


def require_dispatcher_or_admin(
    db: Session = Depends(get_db),
    token: Optional[str] = Depends(reusable_oauth2),
) -> User:
    """Allow only dispatchers and admins to mutate allocation data.

    When settings.KEYCLOAK_DEV_MODE is True and no token is passed,
    a synthetic dispatcher identity is returned.
    """
    if settings.KEYCLOAK_DEV_MODE and not token:
        stub = User()
        stub.id = 0
        stub.role = UserRole.DISPATCHER
        stub.is_active = True
        return stub

    user = get_current_user(db=db, token=token)
    if user.role not in (UserRole.DISPATCHER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only dispatchers and admins can perform this action.",
        )
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Require the Keycloak-mapped administrator role outside development."""
    if settings.KEYCLOAK_DEV_MODE:
        return current_user
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System administrator access is required.",
        )
    return current_user


def require_driver(current_user: User = Depends(get_current_user)) -> User:
    from app.models.user import UserRole
    if current_user.role != UserRole.DRIVER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Driver access only"
        )
    return current_user


# Store Manager accounts. WAREHOUSE_MANAGER is how Keycloak store managers were provisioned before
# STORE_MANAGER existed, so both run a store.
STORE_ROLES = (UserRole.STORE_MANAGER, UserRole.WAREHOUSE_MANAGER)


def resolve_store_outlet(db: Session, user: User, outlet_id: Optional[int]) -> Outlet:
    """The outlet a Store Manager request acts on.

    A store manager is locked to the outlet the admin assigned them; asking for another outlet is refused.
    Admins, and local development without a token, choose the outlet with outlet_id.
    """
    if user.role in STORE_ROLES:
        assignment = db.query(StoreManagerAssignment).filter(StoreManagerAssignment.user_id == user.id).first()
        if assignment is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account isn't linked to an outlet yet. Ask your administrator to assign you to your store.",
            )
        if outlet_id is not None and outlet_id != assignment.outlet_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only open your own outlet.")
        return assignment.outlet
    if user.role == UserRole.ADMIN or settings.KEYCLOAK_DEV_MODE:
        if outlet_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose an outlet (outlet_id).")
        outlet = db.query(Outlet).filter(Outlet.id == outlet_id).first()
        if outlet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outlet not found")
        return outlet
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The store screens are for store managers.")


def get_store_outlet(
    outlet_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Outlet:
    """resolve_store_outlet for endpoints that take ?outlet_id=."""
    return resolve_store_outlet(db, current_user, outlet_id)


def ensure_store_outlet_ref(db: Session, user: User, outlet_ref: str) -> None:
    """For routes keyed by an outlet id or code in the path: a store manager may only use their own."""
    if user.role in STORE_ROLES:
        outlet = resolve_store_outlet(db, user, None)
        if outlet_ref not in (str(outlet.id), outlet.code):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only open your own outlet.")


def ensure_store_access(db: Session, user: User, outlet_id: Optional[int]) -> None:
    """Refuse a store manager touching a record (order, notification) from another outlet."""
    if user.role in STORE_ROLES:
        resolve_store_outlet(db, user, outlet_id if outlet_id is not None else -1)
