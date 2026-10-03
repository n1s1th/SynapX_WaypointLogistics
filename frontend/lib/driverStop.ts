/**
 * Driver trip & stop data — server first, IndexedDB cache when offline.
 *
 * Every successful server read refreshes the phone's cache, so whatever the
 * driver opened while online is available offline. Records saved on the phone
 * but not yet confirmed are overlaid on top (see localStopState), marked with
 * their sync status so they are never mistaken for server-confirmed state.
 */
import { apiFetch, ApiError } from "./api";
import { cacheTrip, getCachedTrip, getQueue, listCachedTrips } from "./syncQueue";
import { localStopState, localTripCompletion } from "./driverSync/engine";
import type {
  DeliveryStop, DriverTripDetail, DriverTripSummary, StopOrderInfo, StopStatus, TripStatus,
} from "@/types/driver-map";

export type { StopOrderInfo, StopOrderItem } from "@/types/driver-map";

export interface StopDetail extends DeliveryStop {
  total_stops: number;
  trip_status: TripStatus;
  order: StopOrderInfo | null;
  pod: { id: number; recipient_name: string } | null;
}

export type DataSource = "server" | "cache";

export interface Loaded<T> {
  data: T;
  source: DataSource;
  /** When the cached copy was saved (source = "cache"). */
  cachedAt: string | null;
  /** Why the server copy couldn't be used (source = "cache"). */
  reason?: FailureReason | null;
}

/** offline = no connection; auth = session expired; server = the server answered with an error. */
export type FailureReason = "offline" | "auth" | "server";

export function failureReason(err: unknown): FailureReason {
  if (!(err instanceof ApiError) || err.status === 0) return "offline";
  if (err.status === 401 || err.status === 403) return "auth";
  return "server";
}

/** One line for the driver explaining why the saved copy is shown / nothing loaded. */
export function failureMessage(reason: FailureReason | null | undefined, hasCopy: boolean): string {
  if (reason === "server") {
    return hasCopy
      ? "The Waypoint server has a problem right now · showing the copy saved on this phone"
      : "The Waypoint server has a problem right now and this trip isn't saved on this phone. Try again in a moment or call dispatch.";
  }
  if (reason === "auth") {
    return hasCopy
      ? "Session expired · showing the copy saved on this phone. Sign in to sync."
      : "Your session has expired. Sign in again to load this trip.";
  }
  return hasCopy
    ? "No connection · showing the copy saved on this phone"
    : "No connection, and this trip isn't saved on this phone yet. Open it once while online.";
}

/**
 * Failures where the phone's cached copy should be used instead: no
 * connection, an expired session (records still save locally and sync after
 * sign-in), or the server being down. A 404 / 422 is a real answer and is not.
 */
export function shouldUseCache(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 401 || err.status === 403 || err.status >= 500;
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

/** Apply this phone's unconfirmed records to a trip from the server or cache. */
export function withLocalState(trip: DriverTripDetail): DriverTripDetail {
  const queue = getQueue();
  return {
    ...trip,
    stops: trip.stops.map((stop) => {
      const local = localStopState(stop, queue);
      return {
        ...stop,
        status: local.status as StopStatus,
        outcome_reason: local.outcome_reason,
        local_sync: local.sync,
      };
    }),
  };
}

/** Trip completion recorded on this phone and its sync state, if any. */
export function localCompletion(tripId: number) {
  return localTripCompletion(tripId, getQueue());
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

/** Today's trips. Offline: the trips cached on this phone for the signed-in driver. */
export async function loadTodayTrips(): Promise<Loaded<DriverTripSummary[]>> {
  try {
    const trips = await apiFetch<DriverTripSummary[]>("/driver/trips/today");
    return { data: trips, source: "server", cachedAt: null };
  } catch (err) {
    if (!shouldUseCache(err)) throw err;
    const rows = await listCachedTrips<DriverTripDetail>();
    return {
      data: rows.map((r) => r.data),
      source: "cache",
      cachedAt: rows[0]?.cached_at ?? null,
      reason: failureReason(err),
    };
  }
}

/**
 * One trip with all stops, orders and POD rules; cached on every server read.
 * Returns the server/cached copy as-is — render it through withLocalState()
 * so records saved on this phone show up (and update as they sync).
 */
export async function loadTrip(tripId: number): Promise<Loaded<DriverTripDetail>> {
  try {
    const trip = await apiFetch<DriverTripDetail>(`/driver/trips/${tripId}`);
    await cacheTrip(trip);
    return { data: trip, source: "server", cachedAt: null };
  } catch (err) {
    if (!shouldUseCache(err)) throw err;
    const row = await getCachedTrip<DriverTripDetail>(tripId);
    if (!row) throw err;
    return { data: row.data, source: "cache", cachedAt: row.cached_at, reason: failureReason(err) };
  }
}

/** The trip to drive now: started first, then assigned. Caches whatever it loads. */
export async function loadActiveTrip(): Promise<Loaded<DriverTripDetail> | null> {
  const today = await loadTodayTrips();
  const target =
    today.data.find((t) => t.status === "started") ??
    today.data.find((t) => t.status === "assigned") ??
    null;
  if (!target) return null;
  if (today.source === "cache") {
    const row = await getCachedTrip<DriverTripDetail>(target.id);
    return row ? { data: row.data, source: "cache", cachedAt: row.cached_at, reason: today.reason } : null;
  }
  return loadTrip(target.id);
}

/** Stop detail for the at-stop screens; offline it comes from the cached trip. */
export async function loadStop(stopId: string | number): Promise<Loaded<StopDetail>> {
  try {
    const detail = await apiFetch<StopDetail>(`/driver/stops/${stopId}`);
    return { data: overlayStop(detail), source: "server", cachedAt: null };
  } catch (err) {
    if (!shouldUseCache(err)) throw err;
    for (const row of await listCachedTrips<DriverTripDetail>()) {
      const stop = row.data.stops.find((s) => String(s.id) === String(stopId));
      if (stop) {
        const detail: StopDetail = {
          ...stop,
          order: stop.order ?? null,
          pod: stop.pod ?? null,
          total_stops: row.data.stops.length,
          trip_status: row.data.status,
        };
        return { data: overlayStop(detail), source: "cache", cachedAt: row.cached_at, reason: failureReason(err) };
      }
    }
    throw err;
  }
}

function overlayStop(detail: StopDetail): StopDetail {
  const local = localStopState(detail, getQueue());
  return { ...detail, status: local.status as StopStatus, outcome_reason: local.outcome_reason, local_sync: local.sync };
}

/** @deprecated use loadStop (works offline) */
export function fetchStopDetail(stopId: string | number) {
  return apiFetch<StopDetail>(`/driver/stops/${stopId}`);
}

/** "05:00-07:30" → { open: "05:00", close: "07:30" } */
export function parseWindow(window: string | null | undefined) {
  const [open, close] = (window ?? "").split("-").map((s) => s.trim());
  return { open: open || null, close: close || null };
}

/** Human labels for sync states, shared by every driver screen. */
export const SYNC_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING_SYNC: { label: "Saved on phone · waiting to sync", bg: "#FFF4D6", fg: "#A85D00" },
  SYNCING: { label: "Uploading…", bg: "#EAF2FF", fg: "#2167D5" },
  SYNCED: { label: "Synced", bg: "#E8F6EF", fg: "#18794E" },
  SYNC_FAILED: { label: "Sync failed", bg: "#FDECEF", fg: "#C9363E" },
  CONFLICT: { label: "Conflict · needs review", bg: "#FDECEF", fg: "#C9363E" },
};
