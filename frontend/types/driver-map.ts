// ============================================================
// Driver Map – TypeScript types
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

export interface StopOrderItem {
  sku: string;
  item_name: string;
  quantity: number;
}

export interface StopOrderInfo {
  order_number: string;
  brand: string | null;
  temperature_zone: string | null;
  delivery_window: string | null;
  units: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  notes: string | null;
  items: StopOrderItem[];
}

/** What the server requires before it accepts a stop (backend POD_REQUIREMENTS). */
export interface PodRequirements {
  recipient_name: boolean;
  signature: boolean;
  min_photos: number;
  max_photos: number;
  delivered_quantities: string;
  failure_reason: boolean;
}

/** Sync state of a locally recorded change; absent/null = server-confirmed. */
export type LocalSyncStatus = "PENDING_SYNC" | "SYNCING" | "SYNCED" | "SYNC_FAILED" | "CONFLICT";

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
  outcome_reason?: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string;
  order?: StopOrderInfo | null;
  pod_requirements?: PodRequirements;
  pod?: { id: number; recipient_name: string } | null;
  /** Set when status comes from a record on this phone the server hasn't confirmed. */
  local_sync?: LocalSyncStatus | null;
}

export interface DriverTripDetail {
  id: number;
  driver_id: number;
  dispatch_trip_id: number;
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
