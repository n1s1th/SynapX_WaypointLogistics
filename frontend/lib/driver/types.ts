// Shapes of the driver API (backend/app/schemas/driver.py). Statuses are the
// lowercase values the API sends. Datetimes are UTC ISO strings; window times
// are Colombo wall-clock "HH:MM".

export type RunState = "being_loaded" | "ready" | "in_progress" | "completed";
export type TripStatus = "assigned" | "started" | "completed";
export type StopStatus = "pending" | "arrived" | "delivered" | "partial" | "failed" | "rescheduled";
export type StopOutcome = "delivered" | "partial" | "failed";
export type DockType = "rear_dock" | "street" | "mall_bay";

export interface VehicleRef {
  code: string;
  type: string;
  temperature_mode: string;
  depot: string | null;
}

export interface PlaceRef {
  name: string;
  latitude: number;
  longitude: number;
}

export interface OutletRef {
  code: string;
  name: string;
  district: string;
  brand: string;
  dock_type: DockType;
  van_only: boolean;
  window_start: string | null;
  window_end: string | null;
}

export interface RunRef {
  code: string;
  trip_number: number;
  brand: string;
  district: string;
  wave: string | null;
  departs_at: string | null;
  plan_version: number;
}

export interface DriverMe {
  id: number;
  full_name: string;
  email: string;
  role: string;
  driver_code: string;
  phone: string | null;
  license_type: string | null;
  vehicle: VehicleRef | null;
  depot: PlaceRef | null;
}

export interface RunCard {
  code: string;
  trip_id: number | null;
  trip_number: number;
  brand: string | null;
  district: string | null;
  wave: string | null;
  departs_at: string | null;
  depot: string | null;
  loader_status: string | null;
  state: RunState;
  stop_count: number;
  stops_done: number;
  has_chilled: boolean;
  checked_in: boolean;
  vehicle: VehicleRef | null;
}

export interface StopOrder {
  order_number: string;
  temperature: "chilled" | "ambient" | string;
  units: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  on_truck: boolean;
  loader_state: string | null;
}

export interface PodSummary {
  recipient_name: string;
  has_signature: boolean;
  has_photo: boolean;
  created_at: string;
}

export interface StopTiming {
  status: "early" | "on_time" | "late";
  minutes: number;
}

export interface DriverStop {
  id: number;
  sequence: number;
  status: StopStatus;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  location_approximate: boolean;
  outlet: OutletRef | null;
  eta: string | null;
  handling_minutes: number | null;
  departed_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  timing: StopTiming | null;
  orders: StopOrder[];
  note: string | null;
  removed_reason: string | null;
  pod: PodSummary | null;
}

export interface TripCounts {
  total: number;
  done: number;
  delivered: number;
  partial: number;
  failed: number;
  removed: number;
  pod: number;
}

export interface DriverTrip {
  id: number;
  status: TripStatus;
  started_at: string | null;
  completed_at: string | null;
  checked_in_at: string | null;
  run: RunRef | null;
  vehicle: VehicleRef | null;
  depot: PlaceRef | null;
  stops: DriverStop[];
  counts: TripCounts;
  open_issues: number;
}

export interface SheetStop {
  sequence: number;
  name: string;
  outlet: OutletRef | null;
  eta: string | null;
  handling_minutes: number | null;
  latitude: number;
  longitude: number;
  location_approximate: boolean;
  orders: StopOrder[];
}

export interface RunSheet {
  code: string;
  state: RunState;
  trip_id: number | null;
  loader_status: string;
  released_at: string | null;
  run: RunRef;
  vehicle: VehicleRef | null;
  depot: PlaceRef;
  stops: SheetStop[];
}

export type IssueType =
  | "vehicle_breakdown"
  | "traffic_delay"
  | "customer_unavailable"
  | "damaged_goods"
  | "wrong_address"
  | "other";

export interface IssueReport {
  id: number;
  driver_trip_id: number;
  stop_id: number | null;
  issue_type: IssueType;
  description: string;
  status: string;
  created_at: string;
}

export interface SosAlert {
  id: number;
  driver_trip_id: number | null;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  status: "triggered" | "acknowledged" | "resolved";
  triggered_at: string;
}

export interface Availability {
  for_date: string;
  confirmed: boolean;
  confirmed_at: string | null;
}

// ---- Offline outbox ------------------------------------------------------

export type ActionType =
  | "arrive"
  | "outcome"
  | "pod"
  | "complete_stop"
  | "issue"
  | "complete_trip"
  | "checkin"
  | "sos"
  | "ready_tomorrow";

export interface OutcomePayload {
  outcome: StopOutcome;
  reason?: string;
  note?: string;
  delivered_units?: Record<string, number>;
}

export interface PodPayload {
  recipient_name: string;
  signature_data?: string;
  photo_url?: string;
  notes?: string;
}

export interface IssuePayload {
  issue_type: IssueType;
  category: string;
  description: string;
  stop_id?: number | null;
  photo_url?: string;
}

export interface SosPayload {
  driver_trip_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  message?: string;
}

export type ActionPayload =
  | Record<string, never>
  | OutcomePayload
  | PodPayload
  | IssuePayload
  | SosPayload;

/** A write saved on the phone, waiting to reach the server. */
export interface QueuedAction {
  client_action_id: string;
  action_type: ActionType;
  trip_id: number | null;
  stop_id: number | null;
  payload: ActionPayload;
  /** When the driver did it (sent as client_timestamp). */
  created_at: string;
  /** Short human label, e.g. "Arrival · Fresh Gampaha". */
  label: string;
  status: "pending" | "conflict" | "failed";
  attempts: number;
  last_error?: string;
  conflict_code?: string;
  server_state?: Record<string, unknown>;
}

export interface SyncActionResult {
  action_id: string;
  status: "applied" | "conflict" | "failed";
  code: string | null;
  message: string | null;
  server_state: Record<string, unknown> | null;
}

export interface SyncResult {
  processed_count: number;
  results: SyncActionResult[];
}
