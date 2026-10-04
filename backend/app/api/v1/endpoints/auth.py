from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.api import deps
from app.core import security
from app.core.config import settings
from app.models.user import User
from app.models.user import UserRole
from app.schemas.auth import Token, UserCreate, UserRead

router = APIRouter()


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(deps.get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )
    created_user = User(
        email=user_in.email,
        full_name=user_in.full_name,
        hashed_password=security.get_password_hash(user_in.password),
        role=user_in.role,
        is_active=user_in.is_active,
    )
    db.add(created_user)
    db.commit()
    db.refresh(created_user)
    return created_user


@router.post("/login", response_model=Token)
def login(
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": security.create_access_token(user.id, expires_delta=access_token_expires),
        "token_type": "bearer",
    }


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(deps.get_current_user)):
    return current_user


from app.models.depot_dispatcher import DepotDispatcherAssignment


@router.get("/depot-scope")
def read_depot_scope(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    x_waypoint_depot: str | None = None,
):
    """The depot enforced for the signed-in dispatcher workspace."""
    is_admin = current_user.role == UserRole.ADMIN
    assignment = db.query(DepotDispatcherAssignment).filter(
        DepotDispatcherAssignment.user_id == current_user.id
    ).first()

    raw_requested = (x_waypoint_depot or settings.DISPATCHER_DEFAULT_DEPOT).strip().lower()
    default_depot = raw_requested if raw_requested in ("peliyagoda", "kandy") else "peliyagoda"

    assigned_depot = assignment.depot.value if assignment else None

    return {
        "depot": assigned_depot or (default_depot if (is_admin or current_user.id == 0) else None),
        "can_switch": is_admin or current_user.id == 0,
        "is_assigned": bool(assignment is not None or is_admin or current_user.id == 0),
        "user_name": current_user.full_name,
        "user_email": current_user.email,
        "user_role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
    }

