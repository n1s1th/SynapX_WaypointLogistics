import enum
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Enum
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.reference import Depot


class SessionEndReason(str, enum.Enum):
    IDLE_TIMEOUT = "idle_timeout"
    SWITCH_USER = "switch_user"
    SIGN_OUT = "sign_out"


class LoaderUser(Base):
    """A depot worker who loads runs.

    Deliberately separate from `users`:

    - Sign-in on the dock tablet is name search plus a 4-digit PIN, with no email
      and no password, so the `users` columns do not fit.
    - `UserRole` is a native Postgres enum shared with the dispatcher and driver
      teams; adding a LOADER value to it is a migration they would feel.
    - Whether loaders end up in Keycloak instead is still an open team decision
      (docs/reference/loader/LOADER_FEATURES.md -> Agree before starting). Keeping them in
      their own table means that decision does not block the data foundation.

    short_name is what the sign-in tiles show ("Saman J."), two per row at 320px.

    depot scopes everything the loader sees: the queue covers every dock of
    that depot. home_dock_id predates it and no longer scopes anything.
    """

    __tablename__ = "loader_users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(255), nullable=False)
    short_name = Column(String(50), nullable=False)
    pin_hash = Column(String(255), nullable=False)
    home_dock_id = Column(Integer, ForeignKey("docks.id"), nullable=True)
    depot = Column(Enum(Depot), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    home_dock = relationship("Dock")
    sessions = relationship("LoaderSession", back_populates="loader_user")


class LoaderSession(Base):
    """One loader signed in on a depot tablet.

    The tablet is shared, so sessions are short and end explicitly - idle timeout,
    Switch user, or sign out. Every check and flag is stamped with the loader who
    was signed in, which is what "Your name is stamped on every check" means on
    the sign-in screen.
    """

    __tablename__ = "loader_sessions"

    id = Column(Integer, primary_key=True, index=True)
    loader_user_id = Column(Integer, ForeignKey("loader_users.id"), nullable=False)
    # Tablets are no longer tied to a dock; a registered one is still recorded.
    dock_tablet_id = Column(Integer, ForeignKey("dock_tablets.id"), nullable=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    ended_at = Column(DateTime, nullable=True)
    end_reason = Column(Enum(SessionEndReason), nullable=True)

    loader_user = relationship("LoaderUser", back_populates="sessions")
    dock_tablet = relationship("DockTablet")
