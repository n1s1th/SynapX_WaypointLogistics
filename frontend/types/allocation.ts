export interface OrderGroupSuggestion {
  order_ids: number[];
  depot: string;
  brand: string | null;
  district: string | null;
  operating_date: string | null;
  total_weight_kg: number | null;
  total_volume_m3: number | null;
  required_temperature: string;
  outlet_count: number;
  required_vehicle_type?: "van" | null;
  van_only_outlets?: string[];
}

export interface ConstraintCheck {
  status: "pass" | "fail" | "unknown";
  message: string;
  blocking?: boolean;
  [key: string]: unknown;
}

export interface RouteSummary {
  route_feasible: boolean;
  route_fingerprint: string;
  input_fingerprint: string;
  estimated_fuel_liters: number | null;
  warnings: string[];
  violations: { outlet_code: string; constraint: string; message: string }[];
  arrivals: RouteStopResult[];
  stop_count: number;
  ordered_outlet_codes: string[];
  estimated_distance_km: number | null;
  estimated_duration_minutes: number | null;
  scheduled_elapsed_minutes: number | null;
  window_feasible: boolean | null;
  source: string;
}

export interface RouteStopResult {
  outlet_code: string;
  name: string;
  arrival_at: string | null;
  service_start_at: string | null;
  window_start: string | null;
  window_end: string | null;
  service_minutes: number | null;
  handling_minutes: number;
  depart_at: string | null;
  window_status: "PASS" | "AT_RISK" | "FAIL";
  reason: string;
}

export interface RouteComparison {
  current: RouteSummary;
  proposed: RouteSummary;
  base_version: number;
  current_route_fingerprint: string;
}

export interface VehicleRecommendation {
  vehicle_id: number;
  vehicle_code: string;
  eligible: boolean;
  recommendation_score: number | null;
  recommendation_level: "BEST_MATCH" | "GOOD_MATCH" | "LOW_MATCH" | "INELIGIBLE";
  constraints: Record<string, ConstraintCheck>;
  route_summary: RouteSummary;
  reasons: string[];
}

export interface AllocationRecommendation {
  order_group: OrderGroupSuggestion;
  group_violations: { constraint: string; message: string; order_id?: number }[];
  vehicles: VehicleRecommendation[];
}
