from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.api import deps
from app.api.deps import get_db
from app.models.user import User
from app.schemas.delivery_issue import DeliveryIssueCreate, DeliveryIssueRead, DeliveryIssueUpdate
from app.services.issue_service import issue_service

router = APIRouter()

# Fields only the depot (dispatcher/admin) sets while reviewing an issue.
DEPOT_ONLY_FIELDS = {"status", "resolution_notes", "claimed_amount"}


def _require_open(issue) -> None:
    if issue.status != "open":
        raise HTTPException(
            status_code=409,
            detail="The depot is already reviewing this issue, so it can't be changed or withdrawn now.",
        )


@router.get("", response_model=List[DeliveryIssueRead])
def list_issues(
    outlet_id: Optional[int] = Query(None, description="Filter by outlet ID"),
    status: Optional[str] = Query(None, description="Filter by status (open, under_review, resolved, credit_issued)"),
    search: Optional[str] = Query(None, description="Search in title, sku, description"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Delivery issues. A store manager only ever gets their own outlet's; dispatch can list all or filter."""
    if current_user.role in deps.STORE_ROLES:
        outlet_id = deps.resolve_store_outlet(db, current_user, outlet_id).id
    return issue_service.get_issues(db, outlet_id=outlet_id, status=status, search=search, limit=limit)


@router.get("/{issue_id}", response_model=DeliveryIssueRead)
def get_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Get a specific issue by ID."""
    issue = issue_service.get_issue(db, issue_id)
    deps.ensure_store_access(db, current_user, issue.outlet_id)
    return issue


@router.post("", response_model=DeliveryIssueRead, status_code=201)
def create_issue(
    payload: DeliveryIssueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Log a new discrepancy, damage report, or delivery exception. Store managers log it for their own outlet."""
    if current_user.role in deps.STORE_ROLES:
        outlet = deps.resolve_store_outlet(db, current_user, payload.outlet_id)
        payload = payload.model_copy(
            update={"outlet_id": outlet.id, "reported_by": f"{current_user.full_name} (Store Manager)"}
        )
    return issue_service.create_issue(db, payload)


@router.patch("/{issue_id}", response_model=DeliveryIssueRead)
def update_issue(
    issue_id: int,
    payload: DeliveryIssueUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Update issue status, resolution notes, claim amount, or details.

    Store managers can correct the details of their own issue while it's still open; the review fields (status,
    resolution notes, claimed amount) are the depot's to set.
    """
    issue = issue_service.get_issue(db, issue_id)
    deps.ensure_store_access(db, current_user, issue.outlet_id)
    if current_user.role in deps.STORE_ROLES:
        if payload.model_dump(exclude_unset=True).keys() & DEPOT_ONLY_FIELDS:
            raise HTTPException(status_code=403, detail="Only the depot can change an issue's status or claim.")
        _require_open(issue)
    return issue_service.update_issue(db, issue_id, payload)


@router.delete("/{issue_id}", status_code=204)
def delete_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Delete or withdraw an issue/complaint. A store manager can withdraw only while it's still open."""
    issue = issue_service.get_issue(db, issue_id)
    deps.ensure_store_access(db, current_user, issue.outlet_id)
    if current_user.role in deps.STORE_ROLES:
        _require_open(issue)
    issue_service.delete_issue(db, issue_id)
    return None
