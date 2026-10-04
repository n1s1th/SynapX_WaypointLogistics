"""
Seed a Colombo, Sri Lanka delivery route.

Creates:
  - Driver account (reuses driver@waypoint.com)
  - A new DispatchTrip: DT-CMB-001
  - A DriverTrip assigned for today
  - 3 DeliveryStops at real Colombo locations (MapLibre-visible coordinates)

Run from the backend/ directory:
  python scripts/seed_colombo.py

To RESET and re-run, pass --reset:
  python scripts/seed_colombo.py --reset
"""

import os
import sys
import argparse
from datetime import datetime, timezone, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.models.shipment import DispatchTrip, Shipment, ShipmentStatus
from app.models.order import Order, OrderItem, OrderStatus
from app.models.driver import (
    DriverTrip, DeliveryStop, DeliveryStopStatus, DriverTripStatus, ProofOfDelivery, IssueReport,
)

# Order delivered at each stop (keyed by stop sequence) so the driver's
# at-stop screens can show what goods are being handed over.
COLOMBO_ORDERS = {
    1: {
        "order_number": "CMB-ORD-001", "brand": "Fresh", "temperature_zone": "Chilled",
        "delivery_window": "05:00-07:30", "weight_kg": 412.0, "volume_m3": 2.4,
        "items": [("FR-MLK-1L", "Fresh milk 1L (crate of 12)", 8),
                  ("FR-YGT-80", "Set yoghurt 80g (tray of 24)", 6),
                  ("FR-CHK-1K", "Chicken breast 1kg", 15)],
    },
    2: {
        "order_number": "CMB-ORD-002", "brand": "Fresh", "temperature_zone": "Ambient",
        "delivery_window": "05:30-08:00", "weight_kg": 538.5, "volume_m3": 3.1,
        "items": [("FR-RCE-5K", "Samba rice 5kg", 30),
                  ("FR-DAL-1K", "Red dhal 1kg", 40),
                  ("FR-OIL-1L", "Coconut oil 1L", 24)],
    },
    3: {
        "order_number": "CMB-ORD-003", "brand": "Fresh", "temperature_zone": "Ambient",
        "delivery_window": "04:00-07:45", "weight_kg": 296.0, "volume_m3": 1.9,
        "items": [("FR-TEA-400", "Ceylon tea 400g", 48),
                  ("FR-BIS-200", "Cream crackers 200g (carton)", 20),
                  ("FR-SUG-1K", "White sugar 1kg", 35)],
    },
}


def attach_order(db: Session, stop: DeliveryStop, dispatch: DispatchTrip):
    """Create an order + items + shipment for a stop and link it (skips if linked)."""
    spec = COLOMBO_ORDERS.get(stop.sequence)
    if stop.shipment_id or not spec:
        return
    order = db.query(Order).filter(Order.order_number == spec["order_number"]).first()
    if not order:
        order = Order(
            order_number=spec["order_number"],
            client_name=stop.customer_name,
            destination_address=stop.address,
            status=OrderStatus.DISPATCHED,
            brand=spec["brand"],
            district="Colombo",
            temperature_zone=spec["temperature_zone"],
            delivery_window=spec["delivery_window"],
            weight_kg=spec["weight_kg"],
            volume_m3=spec["volume_m3"],
            units=sum(q for _, _, q in spec["items"]),
            notes=stop.notes,
            items=[OrderItem(sku=sku, item_name=name, quantity=qty, unit_price=0.0)
                   for sku, name, qty in spec["items"]],
        )
        db.add(order)
        db.flush()
    shipment = Shipment(
        tracking_number=f"TRK-{spec['order_number']}",
        order_id=order.id,
        dispatch_trip_id=dispatch.id,
        status=ShipmentStatus.OUT_FOR_DELIVERY,
    )
    db.add(shipment)
    db.flush()
    stop.shipment_id = shipment.id

# â”€â”€â”€ Colombo Store Locations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Real coordinates verified on OpenStreetMap / MapLibre

COLOMBO_STOPS = [
    {
        "sequence":      1,
        "customer_name": "Keells Super â€“ Colpetty",
        "address":       "488 Galle Rd, Colombo 03",
        "latitude":      6.8906,
        "longitude":     79.8501,
        "customer_phone": "+94-11-2574680",
        "notes":         "Deliver to loading bay at rear entrance. Ask for store manager.",
    },
    {
        "sequence":      2,
        "customer_name": "Cargills Food City â€“ Wellawatte",
        "address":       "123 Galle Rd, Wellawatte, Colombo 06",
        "latitude":      6.8717,
        "longitude":     79.8570,
        "customer_phone": "+94-11-2502930",
        "notes":         "Refrigerated items â€” handle with care. Signature required.",
    },
    {
        "sequence":      3,
        "customer_name": "Arpico Supercentre â€“ Borella",
        "address":       "9 Stanley Wijesundara Mw, Borella, Colombo 08",
        "latitude":      6.9154,
        "longitude":     79.8711,
        "customer_phone": "+94-11-2699000",
        "notes":         "Park on side road. Goods entrance is on the left side of building.",
    },
]


def reset_colombo(db: Session):
    """Remove existing Colombo trip data so the seed can run cleanly."""
    trip_code = "DT-CMB-001"
    dispatch = db.query(DispatchTrip).filter(DispatchTrip.trip_code == trip_code).first()
    if dispatch:
        driver_trip = db.query(DriverTrip).filter(DriverTrip.dispatch_trip_id == dispatch.id).first()
        if driver_trip:
            stop_ids = [s.id for s in driver_trip.stops]
            if stop_ids:
                db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id.in_(stop_ids)).delete(synchronize_session=False)
            db.query(IssueReport).filter(IssueReport.driver_trip_id == driver_trip.id).delete()
            db.query(DeliveryStop).filter(DeliveryStop.driver_trip_id == driver_trip.id).delete()
            db.delete(driver_trip)
        db.query(Shipment).filter(Shipment.dispatch_trip_id == dispatch.id).delete()
        for spec in COLOMBO_ORDERS.values():
            order = db.query(Order).filter(Order.order_number == spec["order_number"]).first()
            if order:
                db.delete(order)
        db.delete(dispatch)
        db.commit()
        print("âœ“ Existing Colombo data removed.")
    else:
        print("No existing Colombo data to remove.")


def seed_colombo(db: Session):
    print("\nâ”€â”€â”€ Seeding Colombo delivery route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")

    # 1. Get or create driver user
    driver_email = "driver@waypoint.com"
    driver = db.query(User).filter(User.email == driver_email).first()
    if not driver:
        driver = User(
            email=driver_email,
            full_name="John Doe",
            hashed_password=get_password_hash("driver123"),
            role=UserRole.DRIVER,
            is_active=True,
        )
        db.add(driver)
        db.commit()
        db.refresh(driver)
        print(f"âœ“ Created driver: {driver.email}")
    else:
        print(f"âœ“ Driver exists: {driver.email}")

    # 2. Create DispatchTrip
    trip_code = "DT-CMB-001"
    dispatch = db.query(DispatchTrip).filter(DispatchTrip.trip_code == trip_code).first()
    if dispatch:
        print(f"  DispatchTrip {trip_code} already exists â€” skipping creation.")
        print("  Tip: run with --reset to remove and re-create it.")
    else:
        dispatch = DispatchTrip(
            trip_code=trip_code,
            vehicle_number="TRK-CMB-07",
            driver_name="John Doe",
            origin="Peliyagoda Warehouse",
            destination="Colombo District",
            departure_time=datetime.now(timezone.utc) - timedelta(minutes=30),
        )
        db.add(dispatch)
        db.commit()
        db.refresh(dispatch)
        print(f"âœ“ Created DispatchTrip: {trip_code}")

    # 3. Create DriverTrip
    driver_trip = db.query(DriverTrip).filter(DriverTrip.dispatch_trip_id == dispatch.id).first()
    if driver_trip:
        print(f"  DriverTrip already exists (id={driver_trip.id}) â€” skipping.")
    else:
        driver_trip = DriverTrip(
            driver_id=driver.id,
            dispatch_trip_id=dispatch.id,
            status=DriverTripStatus.ASSIGNED,
        )
        db.add(driver_trip)
        db.commit()
        db.refresh(driver_trip)
        print(f"âœ“ Created DriverTrip (id={driver_trip.id})")

    # 4. Create DeliveryStops
    existing = db.query(DeliveryStop).filter(DeliveryStop.driver_trip_id == driver_trip.id).count()
    if existing > 0:
        print(f"  {existing} stops already exist â€” skipping stop creation.")
        # Backfill order details onto stops seeded before orders were added
        for stop in driver_trip.stops:
            attach_order(db, stop, dispatch)
        db.commit()
        print("  Linked order details to existing stops.")
    else:
        stops = [
            DeliveryStop(
                driver_trip_id=driver_trip.id,
                status=DeliveryStopStatus.PENDING,
                **stop_data,
            )
            for stop_data in COLOMBO_STOPS
        ]
        db.add_all(stops)
        db.flush()
        for stop in stops:
            attach_order(db, stop, dispatch)
        db.commit()
        print(f"âœ“ Created {len(stops)} delivery stops:")
        for s in COLOMBO_STOPS:
            print(f"    [{s['sequence']}] {s['customer_name']} â€” {s['address']}")
            print(f"        lat={s['latitude']}, lng={s['longitude']}")

    print("\nâ”€â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€")
    print(f"  Login : driver@waypoint.com / driver123")
    print(f"  Trip  : {trip_code} (DriverTrip id={driver_trip.id})")
    print(f"  Map   : 3 pins in Colombo (latâ‰ˆ6.87â€“6.92, lngâ‰ˆ79.85â€“79.87)")
    print("â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Colombo delivery data")
    parser.add_argument("--reset", action="store_true", help="Delete existing Colombo data before seeding")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.reset:
            reset_colombo(db)
        seed_colombo(db)
    finally:
        db.close()

