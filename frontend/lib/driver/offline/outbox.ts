// Offline outbox: every driver write becomes a QueuedAction with its own id,
// is applied to the phone's copy of the trip straight away, and is sent later by
// the sync engine. The server treats a repeated action as already done, so
// retries are safe.

import { arrivalTiming } from "../format";
import type {
  ActionPayload,
  ActionType,
  DriverStop,
  DriverTrip,
  OutcomePayload,
  PodPayload,
  QueuedAction,
  TripCounts,
} from "../types";
import { putOutboxAction } from "./db";

/** UUID v4. crypto.randomUUID only exists on HTTPS/localhost; a phone testing
 * over http://192.168.x.x still needs ids. */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface NewAction {
  action_type: ActionType;
  trip_id: number | null;
  stop_id?: number | null;
  payload?: ActionPayload;
  label: string;
}

/** Save a write to the outbox. Call once per tap. */
export async function enqueue(input: NewAction): Promise<QueuedAction> {
  const action: QueuedAction = {
    client_action_id: uuid(),
    action_type: input.action_type,
    trip_id: input.trip_id,
    stop_id: input.stop_id ?? null,
    payload: input.payload ?? {},
    created_at: new Date().toISOString(),
    label: input.label,
    status: "pending",
    attempts: 0,
  };
  await putOutboxAction(action);
  return action;
}

// ---- Optimistic apply ------------------------------------------------------------

function isDone(stop: DriverStop): boolean {
  if (stop.status === "rescheduled") return true;
  return ["delivered", "partial", "failed"].includes(stop.status) && Boolean(stop.completed_at);
}

export function recount(stops: DriverStop[]): TripCounts {
  return {
    total: stops.length,
    done: stops.filter(isDone).length,
    delivered: stops.filter((s) => s.status === "delivered").length,
    partial: stops.filter((s) => s.status === "partial").length,
    failed: stops.filter((s) => s.status === "failed").length,
    removed: stops.filter((s) => s.status === "rescheduled").length,
    pod: stops.filter((s) => s.pod !== null).length,
  };
}

function outcomeNote(payload: OutcomePayload, stop: DriverStop): string | null {
  const parts: string[] = [];
  if (payload.outcome === "partial" && payload.delivered_units) {
    for (const [number, units] of Object.entries(payload.delivered_units)) {
      const planned = stop.orders.find((o) => o.order_number === number)?.units;
      parts.push(planned != null ? `${number} ${units}/${planned} units` : `${number} ${units} units`);
    }
  }
  if (payload.reason) parts.push(`Reason: ${payload.reason}`);
  if (payload.note) parts.push(payload.note);
  return parts.length ? parts.join(" · ") : null;
}

function applyToStop(stop: DriverStop, action: QueuedAction): DriverStop {
  const at = action.created_at;
  // A stop dispatch removed refuses records; the sync will report the conflict.
  if (stop.status === "rescheduled") return stop;
  switch (action.action_type) {
    case "arrive":
      if (stop.status !== "pending") return stop;
      return { ...stop, status: "arrived", arrived_at: at, timing: arrivalTiming(at, stop.outlet) };
    case "outcome": {
      const payload = action.payload as OutcomePayload;
      if (stop.completed_at) return stop;
      const arrived = stop.arrived_at ?? at;
      return {
        ...stop,
        status: payload.outcome,
        arrived_at: arrived,
        timing: stop.timing ?? arrivalTiming(arrived, stop.outlet),
        note: outcomeNote(payload, stop),
        completed_at: payload.outcome === "failed" ? at : stop.completed_at,
      };
    }
    case "pod": {
      if (stop.pod) return stop;
      const payload = action.payload as PodPayload;
      return {
        ...stop,
        pod: {
          recipient_name: payload.recipient_name,
          has_signature: Boolean(payload.signature_data),
          has_photo: Boolean(payload.photo_url),
          created_at: at,
        },
        completed_at: at,
      };
    }
    case "complete_stop":
      return stop.completed_at ? stop : { ...stop, completed_at: at };
    default:
      return stop;
  }
}

/** The trip as it looks after one queued action. The input is not changed. */
export function applyAction(trip: DriverTrip, action: QueuedAction): DriverTrip {
  if (action.trip_id !== trip.id && !trip.stops.some((s) => s.id === action.stop_id)) return trip;
  let next: DriverTrip = trip;
  if (action.stop_id != null) {
    next = { ...trip, stops: trip.stops.map((s) => (s.id === action.stop_id ? applyToStop(s, action) : s)) };
  }
  switch (action.action_type) {
    case "complete_trip":
      next = { ...next, status: "completed", completed_at: next.completed_at ?? action.created_at };
      break;
    case "checkin":
      next = {
        ...next,
        status: "completed",
        completed_at: next.completed_at ?? action.created_at,
        checked_in_at: next.checked_in_at ?? action.created_at,
      };
      break;
    case "issue":
      next = { ...next, open_issues: next.open_issues + 1 };
      break;
  }
  return { ...next, counts: recount(next.stops) };
}

/** The server's copy plus everything still waiting in the outbox, in order. */
export function withPending(trip: DriverTrip, outbox: QueuedAction[]): DriverTrip {
  return outbox
    .filter((action) => action.status === "pending")
    .reduce((current, action) => applyAction(current, action), trip);
}
