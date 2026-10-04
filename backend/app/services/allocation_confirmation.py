"""Atomic, revalidated order-to-vehicle confirmation."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AllocationError
from app.models.allocation import Allocation, AllocationStatus
from app.models.fleet import Vehicle, VehicleStatus
from app.models.order import OrderStatus
from app.models.reference import Depot
from app.services.allocation_constraints import allocation_constraint_service
from app.services.order_grouping import order_grouping_service
from app.services.route_planning import route_planning_service


class AllocationConfirmationService:
    @staticmethod
    def confirm(
        db: Session, *, vehicle_id: int, order_ids: list[int],
        departure_time: datetime, depot: Depot,
        route_fingerprint: str | None = None,
    ) -> Allocation:
        """Lock vehicle, then orders by ID; recheck and commit once.

        Legacy writers must take locks in the same order. PostgreSQL row locks
        serialize competing requests; the order status/allocation is reread
        after waiting for another request's commit.
        """
        try:
            vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).with_for_update().first()
            if vehicle is None:
                raise AllocationError("Vehicle not found", code="ALLOCATION_CONSTRAINT_FAILED",
                                      violations=[{"constraint": "VEHICLE", "status": "fail", "message": "Vehicle not found."}])
            group = order_grouping_service.load_selected(db, order_ids, depot, lock=True)
            route = route_planning_service.plan(db, group.orders, depot, departure_time, vehicle)
            if route_fingerprint and route_fingerprint != route.route_fingerprint:
                raise AllocationError("Routing inputs changed. Review refreshed recommendations.",
                                      code="ALLOCATION_ROUTE_STALE", violations=[{
                                          "constraint": "ROUTE_STALE", "status": "fail",
                                          "message": "Routing inputs changed. Review refreshed recommendations.",
                                      }])
            report = allocation_constraint_service.validate(db, group, vehicle, departure_time, route)
            if not report.eligible:
                raise AllocationError("Selected allocation does not satisfy its constraints.",
                                      code="ALLOCATION_CONSTRAINT_FAILED", violations=report.violations)

            allocation = Allocation(
                vehicle_id=vehicle.id,
                driver_id=vehicle.driver.id if vehicle.driver else None,
                load_percentage=round(100 * group.total_weight_kg / vehicle.capacity_kg, 2),
                volume_percentage=round(100 * group.total_volume_m3 / vehicle.capacity_vol_m3, 2),
                departure_time=departure_time.astimezone(timezone.utc).replace(tzinfo=None),
                planned_stop_codes=route.ordered_outlet_codes,
                route_plan=route.as_dict(),
                status=AllocationStatus.ALLOCATED,
            )
            db.add(allocation)
            db.flush()
            allocation.run_id = f"RUN-A{allocation.id:08d}"
            for order in group.orders:
                order.allocation_id = allocation.id
                order.status = OrderStatus.ALLOCATED
            vehicle.status = VehicleStatus.ALLOCATED
            db.commit()
            db.refresh(allocation)
            return allocation
        except Exception:
            db.rollback()
            raise


allocation_confirmation_service = AllocationConfirmationService()
