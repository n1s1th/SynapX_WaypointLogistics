"""Admin-managed measured inputs for allocation feasibility."""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api import deps
from app.models.allocation_planning import VehicleFuelWeek
from app.models.fleet import Vehicle
from app.models.user import User
from app.schemas.allocation_recommendation import FuelWeekRead, FuelWeekUpsert

router = APIRouter()


@router.put("/fuel-weeks/{vehicle_id}/{week_start}", response_model=FuelWeekRead)
def record_fuel_week(
    vehicle_id: int, week_start: date, payload: FuelWeekUpsert,
    db: Session = Depends(deps.get_db), _: User = Depends(deps.require_admin),
):
    if week_start.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")
    if db.query(Vehicle).filter(Vehicle.id == vehicle_id).with_for_update().first() is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    row = db.query(VehicleFuelWeek).filter_by(vehicle_id=vehicle_id, week_start=week_start).first()
    if row is None:
        row = VehicleFuelWeek(vehicle_id=vehicle_id, week_start=week_start)
        db.add(row)
    row.liters_used = payload.liters_used
    row.source = payload.source.strip()
    row.recorded_at = datetime.now(timezone.utc)
    db.commit()
    return FuelWeekRead(vehicle_id=vehicle_id, week_start=week_start, liters_used=row.liters_used, source=row.source)
