import enum
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship
from app.core.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    DISPATCHER = "DISPATCHER"
    WAREHOUSE_MANAGER = "WAREHOUSE_MANAGER"
    STORE_MANAGER = "STORE_MANAGER"
    DRIVER = "DRIVER"
    LOADER = "LOADER"
    CLIENT = "CLIENT"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    keycloak_id = Column(String(64), unique=True, index=True, nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=True, default="KEYCLOAK_MANAGED_USER")
    role = Column(Enum(UserRole), default=UserRole.DISPATCHER, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    depot_dispatcher_assignment = relationship(
        "DepotDispatcherAssignment",
        back_populates="dispatcher",
        uselist=False,
        cascade="all, delete-orphan",
    )
