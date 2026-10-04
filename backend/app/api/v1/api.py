from fastapi import APIRouter
from app.api.v1.endpoints import health, auth, orders, inventory, dispatch, tracking, fleet, allocations, driver
from app.api.v1.endpoints import store_orders, notifications, calendar, loader, outlets, operation_exceptions, admin, issues, driver_issues
from app.api.v1.endpoints import catalogue, store, store_stock
from app.routers.receipts import router as receipts_router

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
# Store Manager routes first, so /orders/store and /orders/by-date aren't read as /orders/{order_id}.
api_router.include_router(store_orders.router, prefix="/orders", tags=["Store Manager Orders"])
api_router.include_router(orders.router, prefix="/orders", tags=["Orders"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["Inventory"])
api_router.include_router(dispatch.router, prefix="/delivery-runs", tags=["Delivery Runs"])
api_router.include_router(tracking.router, prefix="/tracking", tags=["Tracking"])
api_router.include_router(fleet.router, prefix="/fleet", tags=["Fleet"])
api_router.include_router(allocations.router, prefix="/allocations", tags=["Allocations"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(calendar.router, prefix="/calendar", tags=["Calendar"])
api_router.include_router(catalogue.router, prefix="/catalogue", tags=["Catalogue"])
api_router.include_router(store.router, prefix="/store", tags=["Store Manager"])
api_router.include_router(driver.router, prefix="/driver", tags=["Driver"])
api_router.include_router(driver_issues.router, prefix="/driver-issues", tags=["Driver Issues"])
api_router.include_router(loader.router, prefix="/loader", tags=["Loader"])
api_router.include_router(outlets.router, prefix="/outlets", tags=["Outlets"])
api_router.include_router(store_stock.router, prefix="/outlets", tags=["Store Stock"])
api_router.include_router(issues.router, prefix="/issues", tags=["Delivery Issues & Exceptions"])
api_router.include_router(operation_exceptions.router, prefix="/operations", tags=["Operations"])
api_router.include_router(receipts_router, tags=["Receipts"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
