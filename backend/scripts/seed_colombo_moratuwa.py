"""
Seed a Colombo-Moratuwa area delivery route.

Creates:
  - Driver account (reuses driver@waypoint.com)
  - A new DispatchTrip: DT-CMB-MOR-001
  - A DriverTrip assigned for today
  - 3 DeliveryStops spanning Colombo to Moratuwa

Run from the backend/ directory:
  python scripts/seed_colombo_moratuwa.py

To RESET and re-run, pass --reset:
  python scripts/seed_colombo_moratuwa.py --reset
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
from app.models.driver import DriverTrip, DeliveryStop, DeliveryStopStatus, DriverTripStatus, ProofOfDelivery, IssueReport, SOSAlert

# --- Colombo - Moratuwa Store Locations ------------------------------------------------
# Spanning from Colombo down to Moratuwa

COLOMBO_MORATUWA_STOPS = [
    {
        "sequence":      1,
        "customer_name": "Keells Super – Colpetty",
        "address":       "488 Galle Rd, Colombo 03",
        "latitude":      6.8906,
        "longitude":     79.8501,
        "customer_phone": "+94-11-2574680",
        "notes":         "Deliver to loading bay at rear entrance. Ask for store manager.",
        "order_number":  "ORD-CMB-001",
        "brand":         "Keells Fresh",
        "temperature_zone": "Chilled",
        "delivery_window": "08:00-10:00",
        "weight_kg":     120.5,
        "items": [
            {"sku": "FR-CHK-01", "item_name": "Fresh Broiler Chicken (Whole)", "quantity": 50, "unit_price": 950.0},
            {"sku": "FR-MLK-02", "item_name": "Pasteurized Full Cream Milk 1L", "quantity": 80, "unit_price": 420.0},
        ]
    },
    {
        "sequence":      2,
        "customer_name": "Cargills Food City – Mount Lavinia",
        "address":       "250 Galle Rd, Mount Lavinia",
        "latitude":      6.8367,
        "longitude":     79.8643,
        "customer_phone": "+94-11-2712930",
        "notes":         "Refrigerated items — handle with care. Signature required.",
        "order_number":  "ORD-CMB-002",
        "brand":         "Cargills Frozen",
        "temperature_zone": "Frozen",
        "delivery_window": "09:00-11:00",
        "weight_kg":     300.0,
        "items": [
            {"sku": "FR-ICE-03", "item_name": "Vanilla Bean Gelato Tubs 2L", "quantity": 40, "unit_price": 1850.0},
        ]
    },
    {
        "sequence":      3,
        "customer_name": "Arpico Supercentre – Moratuwa",
        "address":       "300 Galle Rd, Moratuwa",
        "latitude":      6.7731,
        "longitude":     79.8815,
        "customer_phone": "+94-11-2649000",
        "notes":         "Park on side road. Goods entrance is on the left side of building.",
        "order_number":  "ORD-CMB-003",
        "brand":         "Arpico Groceries",
        "temperature_zone": "Ambient",
        "delivery_window": "10:00-12:00",
        "weight_kg":     450.0,
        "items": [
            {"sku": "ST-POLO-01", "item_name": "Pique Cotton Polo Shirts", "quantity": 100, "unit_price": 3800.0},
            {"sku": "TC-UPS-01", "item_name": "Line Interactive UPS 1200VA", "quantity": 10, "unit_price": 24500.0},
        ]
    },
]


def reset_trip(db: Session):
    """Remove existing trip data so the seed can run cleanly."""
    trip_code = "DT-CMB-MOR-001"
    dispatch = db.query(DispatchTrip).filter(DispatchTrip.trip_code == trip_code).first()
    if dispatch:
        driver_trip = db.query(DriverTrip).filter(DriverTrip.dispatch_trip_id == dispatch.id).first()
        if driver_trip:
            # Delete dependent records
            db.query(SOSAlert).filter(SOSAlert.driver_trip_id == driver_trip.id).delete()
            db.query(IssueReport).filter(IssueReport.driver_trip_id == driver_trip.id).delete()
            stops = db.query(DeliveryStop).filter(DeliveryStop.driver_trip_id == driver_trip.id).all()
            for stp in stops:
                db.query(ProofOfDelivery).filter(ProofOfDelivery.stop_id == stp.id).delete()
            db.query(DeliveryStop).filter(DeliveryStop.driver_trip_id == driver_trip.id).delete()
            db.delete(driver_trip)
        
        # Delete shipments linked to this trip
        shipments = db.query(Shipment).filter(Shipment.dispatch_trip_id == dispatch.id).all()
        for ship in shipments:
            db.query(OrderItem).filter(OrderItem.order_id == ship.order_id).delete()
            db.query(Order).filter(Order.id == ship.order_id).delete()
            db.delete(ship)
            
        db.delete(dispatch)
        db.commit()
        print("OK Existing Colombo-Moratuwa data removed.")
    else:
        print("No existing Colombo-Moratuwa data to remove.")


def seed_trip(db: Session):
    print("\n--- Seeding Colombo-Moratuwa delivery route --------------------")

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
        print(f"OK Created driver: {driver.email}")
    else:
        print(f"OK Driver exists: {driver.email}")

    # 2. Create DispatchTrip
    trip_code = "DT-CMB-MOR-001"
    dispatch = db.query(DispatchTrip).filter(DispatchTrip.trip_code == trip_code).first()
    if dispatch:
        print(f"  DispatchTrip {trip_code} already exists — skipping creation.")
        print("  Tip: run with --reset to remove and re-create it.")
    else:
        dispatch = DispatchTrip(
            trip_code=trip_code,
            vehicle_number="TRK-MOR-09",
            driver_name="John Doe",
            origin="Peliyagoda Warehouse",
            destination="Colombo-Moratuwa",
            departure_time=datetime.now(timezone.utc) - timedelta(minutes=30),
        )
        db.add(dispatch)
        db.commit()
        db.refresh(dispatch)
        print(f"OK Created DispatchTrip: {trip_code}")

    # 3. Create DriverTrip
    driver_trip = db.query(DriverTrip).filter(DriverTrip.dispatch_trip_id == dispatch.id).first()
    if driver_trip:
        print(f"  DriverTrip already exists (id={driver_trip.id}) — skipping.")
    else:
        driver_trip = DriverTrip(
            driver_id=driver.id,
            dispatch_trip_id=dispatch.id,
            status=DriverTripStatus.ASSIGNED,
        )
        db.add(driver_trip)
        db.commit()
        db.refresh(driver_trip)
        print(f"OK Created DriverTrip (id={driver_trip.id})")

    # 4. Create DeliveryStops
    existing = db.query(DeliveryStop).filter(DeliveryStop.driver_trip_id == driver_trip.id).count()
    if existing > 0:
        print(f"  {existing} stops already exist - skipping stop creation.")
    else:
        stops_created = []
        for stop_data in COLOMBO_MORATUWA_STOPS:
            # 1. Create Order
            order = Order(
                order_number=stop_data["order_number"],
                client_name=stop_data["customer_name"],
                destination_address=stop_data["address"],
                status=OrderStatus.ALLOCATED,
                brand=stop_data["brand"],
                temperature_zone=stop_data["temperature_zone"],
                delivery_window=stop_data["delivery_window"],
                weight_kg=stop_data["weight_kg"],
                operating_date="2026-10-02"
            )
            db.add(order)
            db.flush() # get order.id
            
            # 2. Create OrderItems
            for item in stop_data["items"]:
                order_item = OrderItem(
                    order_id=order.id,
                    sku=item["sku"],
                    item_name=item["item_name"],
                    quantity=item["quantity"],
                    unit_price=item["unit_price"]
                )
                db.add(order_item)
                
            # 3. Create Shipment
            shipment = Shipment(
                tracking_number=f"TRK-{stop_data['order_number']}",
                order_id=order.id,
                dispatch_trip_id=dispatch.id,
                status=ShipmentStatus.OUT_FOR_DELIVERY,
                latitude=stop_data["latitude"],
                longitude=stop_data["longitude"]
            )
            db.add(shipment)
            db.flush() # get shipment.id
            
            # 4. Create DeliveryStop
            stop = DeliveryStop(
                driver_trip_id=driver_trip.id,
                shipment_id=shipment.id,
                sequence=stop_data["sequence"],
                address=stop_data["address"],
                customer_name=stop_data["customer_name"],
                customer_phone=stop_data["customer_phone"],
                latitude=stop_data["latitude"],
                longitude=stop_data["longitude"],
                notes=stop_data["notes"],
                status=DeliveryStopStatus.PENDING
            )
            db.add(stop)
            stops_created.append(stop_data)

        db.commit()
        print(f"OK Created {len(stops_created)} delivery stops with linked orders:")
        for s in stops_created:
            print(f"    [{s['sequence']}] {s['customer_name']} - {s['address']}")
            print(f"        lat={s['latitude']}, lng={s['longitude']}")

    print("\n--- Done ----------------------------------------------------------")
    print(f"  Login : driver@waypoint.com / driver123")
    print(f"  Trip  : {trip_code} (DriverTrip id={driver_trip.id})")
    print(f"  Map   : 3 pins spanning Colombo to Moratuwa")
    print("-------------------------------------------------------------------\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Colombo-Moratuwa delivery data")
    parser.add_argument("--reset", action="store_true", help="Delete existing data before seeding")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.reset:
            reset_trip(db)
        seed_trip(db)
    finally:
        db.close()
