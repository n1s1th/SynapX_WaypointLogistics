from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api import deps
from app.models.driver import IssueStatus
from app.models.user import User
from app.schemas.driver import DispatcherIssueRead, IssueStatusUpdate
from app.services import driver_service

router = APIRouter()


@router.get("", response_model=List[DispatcherIssueRead])
def list_driver_issues(
    status: Optional[IssueStatus] = None,
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_dispatcher_or_admin),
):
    """Problems drivers reported, newest first; filter by status (e.g. OPEN)."""
    return driver_service.list_issues(db, status, limit)


@router.patch("/{issue_id}", response_model=DispatcherIssueRead)
def update_driver_issue(
    issue_id: int,
    update: IssueStatusUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_dispatcher_or_admin),
):
    """Acknowledge or resolve a report; the driver sees the new status."""
    return driver_service.set_issue_status(db, issue_id, update.status)
