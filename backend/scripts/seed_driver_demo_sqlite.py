"""Driver demo data on a LOCAL SQLite file, for manual testing. Never Neon.

Builds the whole hand-off the driver app needs, the way the other roles would:
the dispatcher dispatches RUN-0024 (3 Colombo outlets, 4 orders) to Tharindu,
the loader builds the run and signs it off with ORD1003 flagged (not loaded).
Running it again wipes the file and starts over.

PowerShell, from backend/:
    $env:DATABASE_URL = "sqlite:///C:/temp/driver_demo.db"
    .\\venv\\Scripts\\python.exe scripts\\seed_driver_demo_sqlite.py
    .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --port 5000

Log in to the driver app as driver@waypoint.com / driver123.
"""
import os
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if not os.environ.get("DATABASE_URL", "").startswith("sqlite:///"):
    sys.exit("Refusing to run: set DATABASE_URL to a local sqlite:/// file first (never Neon).")

from sqlalchemy import select  # noqa: E402

import app.main  # noqa: E402,F401  (registers every model)
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models.delivery_run import RunOrderState, RunStatus, RunStop, RunStopOrder  # noqa: E402
from app.models.fleet import DriverProfile  # noqa: E402
from app.models.order import OrderItem  # noqa: E402
from app.models.reference import TemperatureClass  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.services.loader_service import LoaderService  # noqa: E402
from tests.conftest_loader import make_dock, make_order, make_outlet, make_trip, make_vehicle  # noqa: E402

COLOMBO = ZoneInfo("Asia/Colombo")


def seed() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # The driver, registered the way dispatch would (user + driver profile)
        driver = User(email="driver@waypoint.com", full_name="Tharindu Fernando",
                      hashed_password=get_password_hash("driver123"), role=UserRole.DRIVER, is_active=True)
        db.add(driver)
        db.flush()
        profile = DriverProfile(user_id=driver.id, license_type="Heavy", phone="0771234567")
        db.add(profile)

        vehicle = make_vehicle(db, code="VEH014")
        make_dock(db)
        outlets = [make_outlet(db, code, district="Colombo") for code in ("OUT026", "OUT027", "OUT030")]
        for outlet, name in zip(outlets, ("Fresh Wellawatte", "Fresh Bambalapitiya", "Fresh Dehiwala")):
            outlet.name = name
        out26, out27, out30 = outlets
        orders = [
            make_order(db, "ORD1001", out26, units=12, kg=300.0, m3=1.2),
            make_order(db, "ORD1002", out27, temperature=TemperatureClass.CHILLED, units=8, kg=200.0, m3=0.8),
            make_order(db, "ORD1003", out30, units=5, kg=100.0, m3=0.5),
            make_order(db, "ORD1004", out26, temperature=TemperatureClass.CHILLED, units=3, kg=50.0, m3=0.2),
        ]
        for order, (sku, name, qty) in zip(orders, [
            ("SKU-RICE5", "Rice 5kg", 12), ("SKU-MILK1", "Fresh milk 1L", 8),
            ("SKU-BREAD", "Bread loaf", 5), ("SKU-YOG", "Yoghurt cup", 3),
        ]):
            db.add(OrderItem(order_id=order.id, sku=sku, item_name=name, quantity=qty, unit_price=100.0))

        # Dispatcher: today's run, leaving at 05:30 Sri Lanka time
        trip = make_trip(db, vehicle, orders)
        trip.driver_id = profile.id
        trip.driver_name = driver.full_name
        departs = datetime.combine(datetime.now(COLOMBO).date(), time(5, 30), tzinfo=COLOMBO)
        trip.departure_time = departs.astimezone(timezone.utc).replace(tzinfo=None)
        run = LoaderService.create_run_for_dispatch_trip(db, trip)

        # Loader: everything loaded except ORD1003 (flagged missing), then signed off
        rows = db.execute(
            select(RunStopOrder).join(RunStop, RunStopOrder.run_stop_id == RunStop.id).where(RunStop.run_id == run.id)
        ).scalars().all()
        for row in rows:
            row.state = RunOrderState.FLAGGED if row.order.order_number == "ORD1003" else RunOrderState.LOADED
        run.status = RunStatus.READY_TO_DEPART
        run.released_at = (datetime.now(timezone.utc) - timedelta(minutes=10)).replace(tzinfo=None)
        db.commit()
        print(f"Seeded {run.code}: ready to depart, 3 stops, for {driver.email} / driver123")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
