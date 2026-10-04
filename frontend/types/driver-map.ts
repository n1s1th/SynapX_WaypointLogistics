// ============================================================
// Driver Map â€“ TypeScript types
// Derived from actual backend schemas (driver.py, fleet.py)
// ============================================================

export type StopStatus =
  | "pending"
  | "arrived"
  | "delivered"
  | "failed"
  | "partial"
  | "rescheduled";

export type TripStatus = "assigned" | "started" | "completed";

export interface DeliveryStop {
  id: number;
  driver_trip_id: number;
  shipment_id: number | null;
  sequence: number;
  address: string;
  customer_name: string;
  customer_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  status: StopStatus;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DriverTripDetail {
  id: number;
  driver_id: number;
  dispatch_trip_id: number;
  run_code?: string | null; // e.g. RUN-0067, as the dispatcher and loader call it
  vehicle_number?: string | null; // the truck, e.g. VEH005
  status: TripStatus;
  assigned_date: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  stops: DeliveryStop[];
}

export interface DriverTripSummary {
  id: number;
  driver_id: number;
  dispatch_trip_id: number;
  status: TripStatus;
  assigned_date: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

/** GPS position from browser Geolocation API */
export interface GPSPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  timestamp: number;
}

/** Stop with resolved visual state for map rendering */
export interface StopMapState extends DeliveryStop {
  visualState: "completed" | "current" | "upcoming" | "problem";
  hasCoords: boolean;
}

export type SpecialLocationType = "home" | "work" | "depot";

export interface SpecialLocation {
  id: string;
  type: SpecialLocationType;
  label: string;
  latitude: number;
  longitude: number;
}

