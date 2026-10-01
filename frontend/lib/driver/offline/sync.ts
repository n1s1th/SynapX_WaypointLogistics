// Sends the outbox to POST /driver/sync, oldest first. The server answers per
// action: applied (dropped from the phone), conflict (kept and shown to the
// driver to resolve) or failed (kept with the reason). Without a connection
// everything stays queued for the next try.

import { ApiError } from "@/lib/api";
import { driverApi } from "../api";
import { deleteOutboxAction, getCachedTrip, listOutbox, putCachedTrip, putOutboxAction } from "./db";
import { applyAction } from "./outbox";
import type { QueuedAction } from "../types";

export interface FlushResult {
  sent: number;
  conflicts: number;
  failed: number;
  /** Stopped because the server could not be reached. */
  offline: boolean;
  /** The server refused the sign-in (expired or not a driver). */
  authError: boolean;
  /** Trips whose records were sent, so their screens can refresh. */
  touchedTrips: number[];
}

/** Keeps one request a reasonable size even with photos attached. */
const BATCH_SIZE = 20;

let running: Promise<FlushResult> | null = null;

/** Fold a record the server accepted into the phone's copy of its trip, so the
 * screen doesn't flash back to the old state before the fresh copy arrives
 * (and stays right if the signal drops straight after the sync). */
async function keepInCachedTrip(action: QueuedAction): Promise<void> {
  if (action.trip_id == null) return;
  try {
    const cached = await getCachedTrip(action.trip_id);
    if (cached) await putCachedTrip(applyAction(cached, action));
  } catch {
    // The refetch after the sync brings the server's copy anyway.
  }
}

/** Flush the outbox. Calls made while a flush runs share it. */
export function flushOutbox(): Promise<FlushResult> {
  running ??= flush().finally(() => {
    running = null;
  });
  return running;
}

async function flush(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, conflicts: 0, failed: 0, offline: false, authError: false, touchedTrips: [] };
  const touched = new Set<number>();
  const pending = (await listOutbox()).filter((action) => action.status === "pending");

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    let response;
    try {
      response = await driverApi.sync(batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) result.authError = true;
      else result.offline = !(err instanceof ApiError) || err.isNetworkError || err.status >= 500;
      for (const action of batch) {
        await putOutboxAction({ ...action, attempts: action.attempts + 1, last_error: message });
      }
      break;
    }

    const byId = new Map(response.results.map((item) => [item.action_id, item]));
    for (const action of batch) {
      const answer = byId.get(action.client_action_id);
      if (!answer) continue; // not processed: stays pending
      if (action.trip_id != null) touched.add(action.trip_id);
      if (answer.status === "applied") {
        await keepInCachedTrip(action);
        await deleteOutboxAction(action.client_action_id);
        result.sent += 1;
      } else if (answer.status === "conflict") {
        await putOutboxAction({
          ...action,
          status: "conflict",
          attempts: action.attempts + 1,
          conflict_code: answer.code ?? undefined,
          last_error: answer.message ?? undefined,
          server_state: answer.server_state ?? undefined,
        });
        result.conflicts += 1;
      } else {
        await putOutboxAction({
          ...action,
          status: "failed",
          attempts: action.attempts + 1,
          last_error: answer.message ?? answer.code ?? "The server refused this record.",
        });
        result.failed += 1;
      }
    }
  }

  result.touchedTrips = [...touched];
  return result;
}
