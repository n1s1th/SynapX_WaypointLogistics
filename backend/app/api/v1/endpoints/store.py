from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.schemas.store import StoreMeRead

router = APIRouter()


@router.get("/me", response_model=StoreMeRead)
def store_me(
    outlet_id: Optional[int] = Query(default=None),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """The signed-in store manager and their outlet. Admins (and local dev) pass outlet_id to view a store."""
    outlet = deps.resolve_store_outlet(db, current_user, outlet_id)
    return {
        "manager": {
            "id": current_user.id,
            "full_name": current_user.full_name,
            "email": current_user.email,
            "role": current_user.role.value,
        },
        "outlet": {
            "id": outlet.id,
            "code": outlet.code,
            "name": outlet.name,
            "brand": outlet.brand.label if outlet.brand else "",
            "district": outlet.district,
            "depot": outlet.depot.value if outlet.depot else None,
            "window_start": outlet.window_start.strftime("%H:%M") if outlet.window_start else None,
            "window_end": outlet.window_end.strftime("%H:%M") if outlet.window_end else None,
        },
    }
