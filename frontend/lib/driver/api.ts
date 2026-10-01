// Driver API calls. Reads go straight to the server; writes made during a trip go
// through the offline outbox (lib/driver/offline) and reach the server via /sync.

import { apiFetch as fetchFromApi, ApiError } from "@/lib/api";
import { isSimulatedOffline } from "./demo";
import type {
  Availability,
  DriverMe,
  DriverStop,
  DriverTrip,
  PodPayload,
  QueuedAction,
  RunCard,
  RunSheet,
  SosAlert,
  SosPayload,
  StopOutcome,
  SyncResult,
} from "./types";

/** Give up on a request after this long, so a weak signal can't hang the app. */
const TIMEOUT_MS = 15_000;

/** Like the shared apiFetch, but fails as "no signal" while the demo switch is on. */
function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (isSimulatedOffline()) return Promise.reject(new ApiError("No signal (simulated)", 0));
  return fetchFromApi<T>(path, init);
}

function withTimeout(init: RequestInit = {}, ms = TIMEOUT_MS): RequestInit {
  return { ...init, signal: AbortSignal.timeout(ms) };
}

const enc = encodeURIComponent;

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface ConflictRecord {
  outcome?: StopOutcome;
  reason?: string;
  arrived_at?: string;
  completed_at?: string;
  pod?: PodPayload & { client_timestamp?: string };
}

export const driverApi = {
  login(email: string, password: string) {
    const body = new URLSearchParams({ username: email, password });
    return apiFetch<LoginResponse>("/auth/login", withTimeout({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }));
  },

  me: () => apiFetch<DriverMe>("/driver/me", withTimeout()),
  runs: () => apiFetch<RunCard[]>("/driver/runs", withTimeout()),
  runSheet: (code: string) => apiFetch<RunSheet>(`/driver/runs/${enc(code)}`, withTimeout()),
  trip: (tripId: number) => apiFetch<DriverTrip>(`/driver/trips/${tripId}`, withTimeout()),

  /** Collect a released run (gate-out). Online only: it happens at the depot. */
  startRun: (code: string) =>
    apiFetch<DriverTrip>(`/driver/runs/${enc(code)}/start`, withTimeout({ method: "POST" })),
  startTrip: (tripId: number) =>
    apiFetch<DriverTrip>(`/driver/trips/${tripId}/start`, withTimeout({ method: "POST" })),

  /** Send queued offline actions, oldest first. */
  sync: (actions: QueuedAction[]) =>
    apiFetch<SyncResult>("/driver/sync", withTimeout({
      method: "POST",
      body: JSON.stringify(
        actions.map((action) => ({
          action_id: action.client_action_id,
          action_type: action.action_type,
          trip_id: action.trip_id,
          stop_id: action.stop_id,
          payload: action.payload,
          client_timestamp: action.created_at,
        })),
      ),
    }, 30_000)),

  resolve: (stopId: number, resolution: "keep_record" | "flag_review", record?: ConflictRecord) =>
    apiFetch<DriverStop>(`/driver/stops/${stopId}/resolve`, withTimeout({
      method: "POST",
      body: JSON.stringify({ resolution, record }),
    })),

  sos: (payload: SosPayload) =>
    apiFetch<SosAlert>("/driver/sos", withTimeout({ method: "POST", body: JSON.stringify(payload) }, 10_000)),
  sosStatus: (alertId: number) => apiFetch<SosAlert>(`/driver/sos/${alertId}`, withTimeout()),

  availability: () => apiFetch<Availability>("/driver/ready-tomorrow", withTimeout()),

  /** Demo only: dispatch removes a stop after departure (backend dev route).
   * Sent even while "no signal" is simulated: it stands in for the dispatcher. */
  demoDeferStop: (code: string, sequence: number, reason: string) =>
    fetchFromApi<DriverTrip>(`/driver/dev/runs/${enc(code)}/stops/${sequence}/defer`, withTimeout({
      method: "POST",
      body: JSON.stringify({ reason }),
    })),
};
