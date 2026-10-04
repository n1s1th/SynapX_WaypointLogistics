import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers

# Tables are created and changed only through Alembic migrations (alembic upgrade head).
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Waypoint Logistics Delivery Planning and Execution Platform",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
)

# Register Domain Exception Handlers
register_exception_handlers(app)

# Configure CORS
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

from app.routers.receipts import router as receipts_router

# Include API Router
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(receipts_router, prefix="/api")

# Serve uploaded photos as static files
_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "static", "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")


@app.get("/", tags=["Root"])
def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": f"{settings.API_V1_STR}/docs",
        "openapi": f"{settings.API_V1_STR}/openapi.json",
        "status": "operational",
    }


@app.get("/health", tags=["Health"])
def top_level_health():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
    }
