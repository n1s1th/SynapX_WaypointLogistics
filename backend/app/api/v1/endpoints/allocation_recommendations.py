"""Read-only recommendation and grouping endpoints for Dispatcher."""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.models.reference import Depot
from app.models.user import User
from app.schemas.allocation_recommendation import OrderGroupRead, RecommendationRequest, RecommendationResponse
from app.services.allocation_recommendations import allocation_recommendation_service
from app.services.order_grouping import order_grouping_service

router = APIRouter()


@router.get("/groups", response_model=list[OrderGroupRead])
def candidate_groups(
    operating_date: date | None = None,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
    _: User = Depends(deps.require_dispatcher_or_admin),
):
    return [group.as_dict() for group in order_grouping_service.candidate_groups(db, depot, operating_date)]


@router.post("", response_model=RecommendationResponse)
def recommend(
    payload: RecommendationRequest,
    db: Session = Depends(deps.get_db),
    depot: Depot = Depends(deps.get_dispatcher_depot),
    _: User = Depends(deps.require_dispatcher_or_admin),
):
    return allocation_recommendation_service.recommend(db, payload.order_ids, depot, payload.departure_time)
