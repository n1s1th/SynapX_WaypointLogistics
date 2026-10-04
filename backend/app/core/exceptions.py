from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class WaypointLogisticsError(Exception):
    """Base exception for all Waypoint Logistics domain errors."""

    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


class AllocationError(WaypointLogisticsError):
    """Raised when an allocation violates operational or physical constraints."""

    def __init__(
        self,
        message: str,
        code: str = "ALLOCATION_FAILED",
        violations: Optional[List[Dict[str, Any]]] = None,
    ):
        super().__init__(message, code=code, details={"violations": violations or []})
        self.violations = violations or []


class InvalidStateTransitionError(WaypointLogisticsError):
    """Raised when an illegal lifecycle state transition is attempted."""

    def __init__(
        self,
        message: str,
        current_state: str,
        target_state: str,
        entity: str = "Order",
    ):
        super().__init__(
            message,
            code="INVALID_STATE_TRANSITION",
            details={
                "entity": entity,
                "current_state": current_state,
                "target_state": target_state,
            },
        )


class NotFoundError(WaypointLogisticsError):
    """Raised when a requested resource is not found."""

    def __init__(self, message: str, entity: str = "Resource", entity_id: Any = None):
        super().__init__(
            message,
            code="NOT_FOUND",
            details={"entity": entity, "entity_id": entity_id},
        )


class AuthorizationError(WaypointLogisticsError):
    """Raised when a user lacks required permissions or role."""

    def __init__(self, message: str = "Access forbidden", required_role: Optional[str] = None):
        super().__init__(
            message,
            code="AUTHORIZATION_FAILED",
            details={"required_role": required_role} if required_role else {},
        )


class OrderRuleError(WaypointLogisticsError):
    """Raised when a goods request breaks an ordering rule (cutoff, operating day, Fresh dual-order, …)."""

    def __init__(self, message: str, code: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code=code, details=details)


class SynchronizationError(WaypointLogisticsError):
    """Raised when offline synchronization fails or payload is malformed."""

    def __init__(self, message: str, event_id: Optional[str] = None):
        super().__init__(
            message,
            code="SYNCHRONIZATION_ERROR",
            details={"event_id": event_id} if event_id else {},
        )


def register_exception_handlers(app: FastAPI) -> None:
    """Registers domain exception handlers on the FastAPI application."""

    @app.exception_handler(AllocationError)
    async def allocation_error_handler(request: Request, exc: AllocationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    "violations": exc.violations,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(InvalidStateTransitionError)
    async def state_transition_error_handler(
        request: Request, exc: InvalidStateTransitionError
    ):
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(NotFoundError)
    async def not_found_error_handler(request: Request, exc: NotFoundError):
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(AuthorizationError)
    async def auth_error_handler(request: Request, exc: AuthorizationError):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(OrderRuleError)
    async def order_rule_error_handler(request: Request, exc: OrderRuleError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(SynchronizationError)
    async def sync_error_handler(request: Request, exc: SynchronizationError):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(WaypointLogisticsError)
    async def general_domain_error_handler(
        request: Request, exc: WaypointLogisticsError
    ):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "detail": {
                    "code": exc.code,
                    "message": exc.message,
                    **exc.details,
                }
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": str(exc),
                }
            },
        )

