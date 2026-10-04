/**
 * Stop detail for the driver's at-stop screens (arrived → outcome → proof).
 * Backed by GET /driver/stops/{id}, which includes the order being delivered.
 */
import { apiFetch, ApiError } from "./api";
import { readCache, writeCache } from "./driverCache";
import type { DeliveryStop, TripStatus } from "@/types/driver-map";

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
  /** False when the order is on the plan but the loader didn't load it. */
  on_truck?: boolean;
  items: StopOrderItem[];
}

export interface StopDetail extends DeliveryStop {
  total_stops: number;
  trip_status: TripStatus;
  /** The first of `orders`. */
  order: StopOrderInfo | null;
  /** Every order dropped at this stop (a Fresh outlet can get a dry and a chilled one). */
  orders?: StopOrderInfo[];
  pod: { id: number; recipient_name: string } | null;
}

/**
 * A stop the driver still has to finish: not reached yet, or marked delivered /
 * partial but its proof isn't saved (they went back from the proof screen).
 * A failed stop is closed by its outcome and the issue report.
 */
export function isStopOpen(stop: { status: string; completed_at: string | null }) {
  if (stop.status === "pending" || stop.status === "arrived") return true;
  return (stop.status === "delivered" || stop.status === "partial") && !stop.completed_at;
}

/** Delivered (full or partial) and its proof saved: done, for the map and the progress counts. */
export function isStopDelivered(stop: { status: string; completed_at: string | null }) {
  return (stop.status === "delivered" || stop.status === "partial") && !isStopOpen(stop);
}

// The last copy of each stop, so the at-stop screens still open with no
// signal. The map saves every open stop of the trip while it has signal, and
// an action saved offline moves the copy on (updateCachedStop).
const stopPath = (stopId: string | number) => `/driver/stops/${stopId}`;

type Progress = { status: string; completed_at?: string | null };
type StopLike = Progress & { id: number; arrived_at?: string | null };

/** How far a stop has got: 0 not reached · 1 arrived · 2 outcome recorded · 3 closed. */
function progress(stop: Progress) {
  if (stop.completed_at || stop.status === "rescheduled") return 3;
  if (stop.status === "delivered" || stop.status === "partial" || stop.status === "failed") return 2;
  return stop.status === "arrived" ? 1 : 0;
}

/** Save a stop, never moving it back behind what the driver already did offline. */
function cacheStop(detail: StopDetail) {
  const local = getCachedStop(detail.id);
  const ahead = local && progress(local) > progress(detail);
  writeCache(stopPath(detail.id), ahead
    ? { ...detail, status: local.status, arrived_at: local.arrived_at, completed_at: local.completed_at, pod: local.pod }
    : detail);
}

export function getCachedStop(stopId: string | number): StopDetail | null {
  return readCache<StopDetail>(stopPath(stopId));
}

/**
 * A trip's stops with what the driver did offline laid over them: each stop
 * as far along as either the trip's copy or the stop's own copy says.
 */
export function mergeLocalProgress<S extends StopLike>(stops: S[]): S[] {
  return stops.map((stop) => {
    const local = getCachedStop(stop.id);
    if (!local || progress(local) <= progress(stop)) return stop;
    return {
      ...stop,
      status: local.status,
      arrived_at: local.arrived_at ?? stop.arrived_at,
      completed_at: local.completed_at ?? stop.completed_at,
    } as S;
  });
}

// The trip under way, so an SOS sent with no signal still names it
const ACTIVE_TRIP_KEY = "driver-active-trip";

/** "peliyagoda" → "Peliyagoda Depot"; no depot known (old test trips) → "Your depot". */
export function depotLabel(depot: string | null | undefined) {
  return depot ? `${depot.charAt(0).toUpperCase()}${depot.slice(1)} Depot` : "Your depot";
}

export function rememberActiveTrip(tripId: number | null) {
  try {
    if (tripId === null) localStorage.removeItem(ACTIVE_TRIP_KEY);
    else localStorage.setItem(ACTIVE_TRIP_KEY, String(tripId));
  } catch {
    // storage blocked: the SOS goes without a trip
  }
}

export function getRememberedTrip(): number | null {
  try {
    const value = localStorage.getItem(ACTIVE_TRIP_KEY);
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

/** After an action is saved offline, so the next screen shows the stop as it will be. */
export function updateCachedStop(stopId: string | number, changes: Partial<StopDetail>) {
  const stop = getCachedStop(stopId);
  if (stop) writeCache(stopPath(stopId), { ...stop, ...changes });
}

export async function fetchStopDetail(stopId: string | number) {
  try {
    const detail = await apiFetch<StopDetail>(stopPath(stopId));
    cacheStop(detail);
    return getCachedStop(stopId) ?? detail;
  } catch (err) {
    const cached = err instanceof ApiError && err.isNetworkError ? getCachedStop(stopId) : null;
    if (cached) return cached;
    throw err;
  }
}

/** "05:00-07:30" → { open: "05:00", close: "07:30" } */
export function parseWindow(window: string | null | undefined) {
  const [open, close] = (window ?? "").split("-").map((s) => s.trim());
  return { open: open || null, close: close || null };
}
