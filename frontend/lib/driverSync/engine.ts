/**
 * Driver offline sync engine — pure logic, no browser APIs.
 *
 * Storage (IndexedDB) and transport (fetch) are injected, so the same code runs
 * in the app (lib/syncQueue.ts) and in Node tests (tests/driver-sync). Keep this
 * file free of runtime imports and of TS-only syntax (enums, parameter
 * properties) so `node --experimental-strip-types` can load it directly.
 *
 * Delivery status and sync status are separate: a stop can be locally
 * "delivered" while its record is still PENDING_SYNC. Only a server "applied"
 * answer marks a record SYNCED.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncStatus = "PENDING_SYNC" | "SYNCING" | "SYNCED" | "SYNC_FAILED" | "CONFLICT";

/** deliver = outcome + quantities + proof of delivery for one stop, saved atomically. */
export type SyncActionType =
  | "arrive"
  | "deliver"
  | "issue"
  | "complete_trip"
  // Queued by the previous app version; still accepted by the server
  | "outcome"
  | "pod"
  | "complete";

export type DeliveryOutcome = "delivered" | "partial" | "failed" | "refused";

/** One answer from POST /driver/sync (backend SyncEventResult). */
export interface ServerResult {
  action_id: string;
  status: "applied" | "conflict" | "rejected";
  duplicate: boolean;
  code: string | null;
  message: string | null;
  trip_id: number | null;
  stop_id: number | null;
  server_state: Record<string, unknown> | null;
  received_at: string;
  reviewed: boolean;
  review_note: string | null;
}

export interface QueuedAction {
  /** Idempotency key, generated once when the driver taps and reused on every retry. */
  action_id: string;
  action_type: SyncActionType;
  trip_id: number | null;
  stop_id: number | null;
  /** Who recorded it; only that driver's session may send it. */
  driver_id: number | null;
  payload: Record<string, unknown>;
  /** When it happened on the phone (sent to the server as event time). */
  client_timestamp: string;
  label: string;
  sync_status: SyncStatus;
  attempts: number;
  /** Epoch ms before which a failed record is not retried automatically. */
  next_attempt_at: number | null;
  last_error: string | null;
  error_code: string | null;
  /** SYNC_FAILED records are retried automatically only when this is true. */
  retryable: boolean;
  /** Keys of photo blobs stored alongside the record (also used as upload ids). */
  photo_keys: string[];
  /** photo key → server URL, saved as each upload succeeds so retries skip it. */
  uploaded: Record<string, string>;
  server: ServerResult | null;
  synced_at: string | null;
}

export type TransportErrorKind = "network" | "auth" | "server" | "client";

/** Raised by transport functions; anything else is treated as a network failure. */
export class TransportError extends Error {
  kind: TransportErrorKind;
  status: number;

  constructor(kind: TransportErrorKind, status: number, message: string) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SyncRequest {
  action_id: string;
  action_type: SyncActionType;
  trip_id: number | null;
  stop_id: number | null;
  payload: Record<string, unknown>;
  client_timestamp: string;
}

export interface FlushDeps {
  list(): Promise<QueuedAction[]>;
  save(action: QueuedAction): Promise<void>;
  getBlob(key: string): Promise<Blob | undefined>;
  deleteBlob(key: string): Promise<void>;
  /** Upload one photo; fileId makes the upload idempotent on the server. */
  upload(blob: Blob, fileId: string): Promise<string>;
  send(request: SyncRequest): Promise<ServerResult>;
  now(): number;
  /** Signed-in driver, or null when there is no usable session. */
  driverId: number | null;
  random?: () => number;
}

export interface FlushSummary {
  attempted: number;
  synced: number;
  conflicts: number;
  rejected: number;
  retrying: number;
  /** Why the flush stopped early, if it did. */
  stoppedBy: "network" | "auth" | null;
}

// ─── Policy ───────────────────────────────────────────────────────────────────

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
/** After this many automatic attempts a record waits for a manual retry. */
export const MAX_AUTO_ATTEMPTS = 8;

const UNSYNCED: SyncStatus[] = ["PENDING_SYNC", "SYNCING", "SYNC_FAILED"];

export function classifyHttpStatus(status: number): TransportErrorKind {
  if (status === 0) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "server";
  return "client";
}

/** Bounded exponential backoff with ±20% jitter. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
  return Math.round(exp * (0.8 + 0.4 * random()));
}

export function isUnsynced(action: QueuedAction): boolean {
  return UNSYNCED.includes(action.sync_status);
}

export function belongsTo(action: QueuedAction, driverId: number | null): boolean {
  if (driverId == null) return false;
  // Records from before driver stamping are sent by whoever is signed in; the
  // server still checks the trip belongs to that driver.
  return action.driver_id == null || action.driver_id === driverId;
}

function byTime(a: QueuedAction, b: QueuedAction): number {
  return a.client_timestamp.localeCompare(b.client_timestamp) || a.action_id.localeCompare(b.action_id);
}

/**
 * Records to send now, oldest first. A trip completion waits until every other
 * record for that trip has synced, so the server sees the stops first.
 */
export function selectSendable(queue: QueuedAction[], now: number, driverId: number | null): QueuedAction[] {
  const due = (a: QueuedAction) =>
    a.sync_status === "PENDING_SYNC" ||
    a.sync_status === "SYNCING" ||
    (a.sync_status === "SYNC_FAILED" && a.retryable && a.attempts < MAX_AUTO_ATTEMPTS && (a.next_attempt_at ?? 0) <= now);

  return queue
    .filter((a) => belongsTo(a, driverId) && due(a))
    .filter((a) => {
      if (a.action_type !== "complete_trip") return true;
      return !queue.some(
        (b) => b !== a && b.trip_id === a.trip_id && b.action_type !== "complete_trip" && isUnsynced(b),
      );
    })
    .sort(byTime);
}

/** Records for the same trip that a pending completion is waiting on. */
export function completionBlockers(queue: QueuedAction[], tripId: number): QueuedAction[] {
  return queue.filter((b) => b.trip_id === tripId && b.action_type !== "complete_trip" && isUnsynced(b));
}

// ─── Applying a server answer ─────────────────────────────────────────────────

/** Returns the updated record and which blobs can now be deleted from the phone. */
export function applyServerResult(
  action: QueuedAction,
  result: ServerResult,
  now: number,
): { action: QueuedAction; releaseBlobs: string[] } {
  const base = { ...action, server: result, last_error: result.message, error_code: result.code };

  if (result.status === "applied") {
    // Confirmed: drop the signature and photos from the phone, keep the receipt
    const payload = { ...action.payload };
    delete payload.signature_data;
    return {
      action: {
        ...base,
        payload,
        sync_status: "SYNCED",
        synced_at: new Date(now).toISOString(),
        last_error: null,
        error_code: null,
        retryable: false,
        next_attempt_at: null,
      },
      releaseBlobs: action.photo_keys,
    };
  }
  if (result.status === "conflict") {
    // Keep every piece of evidence until a dispatcher has reviewed it
    return { action: { ...base, sync_status: "CONFLICT", retryable: false, next_attempt_at: null }, releaseBlobs: [] };
  }
  return { action: { ...base, sync_status: "SYNC_FAILED", retryable: false, next_attempt_at: null }, releaseBlobs: [] };
}

function failTransient(action: QueuedAction, message: string, now: number, random?: () => number): QueuedAction {
  const attempts = action.attempts + 1;
  return {
    ...action,
    sync_status: "SYNC_FAILED",
    retryable: true,
    attempts,
    next_attempt_at: now + backoffMs(attempts, random),
    last_error: attempts >= MAX_AUTO_ATTEMPTS ? `${message} Tap Retry sync to try again.` : message,
    error_code: "TRANSIENT",
  };
}

// ─── Flush ────────────────────────────────────────────────────────────────────

/**
 * Send due records one at a time. Each record is saved after every step
 * (photo uploaded, answer received), so a crash, reload or lost response
 * resumes safely: uploads and sync events are both idempotent on the server.
 */
export async function runFlush(deps: FlushDeps): Promise<FlushSummary> {
  const summary: FlushSummary = { attempted: 0, synced: 0, conflicts: 0, rejected: 0, retrying: 0, stoppedBy: null };
  if (deps.driverId == null) {
    summary.stoppedBy = "auth";
    return summary;
  }

  const queue = await deps.list();
  for (const queued of selectSendable(queue, deps.now(), deps.driverId)) {
    summary.attempted++;
    let action: QueuedAction = { ...queued, sync_status: "SYNCING" };
    await deps.save(action);

    try {
      // 1. Evidence first: every photo must be on the server before the record
      for (const key of action.photo_keys) {
        if (action.uploaded[key]) continue;
        const blob = await deps.getBlob(key);
        if (!blob) {
          throw new TransportError("client", 0, "A delivery photo is missing from this phone. Record the delivery again.");
        }
        const url = await deps.upload(blob, key);
        action = { ...action, uploaded: { ...action.uploaded, [key]: url } };
        await deps.save(action);
      }

      // 2. The record itself
      const payload = action.photo_keys.length
        ? { ...action.payload, photo_urls: action.photo_keys.map((k) => action.uploaded[k]) }
        : action.payload;
      const result = await deps.send({
        action_id: action.action_id,
        action_type: action.action_type,
        trip_id: action.trip_id,
        stop_id: action.stop_id,
        payload,
        client_timestamp: action.client_timestamp,
      });

      const applied = applyServerResult(action, result, deps.now());
      await deps.save(applied.action);
      for (const key of applied.releaseBlobs) {
        try {
          await deps.deleteBlob(key);
        } catch {
          // Leftover blobs are pruned later; the record is already safe on the server
        }
      }
      if (result.status === "applied") summary.synced++;
      else if (result.status === "conflict") summary.conflicts++;
      else summary.rejected++;
    } catch (err) {
      const e = err instanceof TransportError ? err : new TransportError("network", 0, "No connection to the server.");

      if (e.kind === "network" || e.kind === "auth") {
        // Nothing reached the server (or it will answer the same again): park
        // the record unchanged and stop — the rest would fail the same way.
        await deps.save({
          ...action,
          sync_status: "PENDING_SYNC",
          last_error: e.kind === "auth" ? "Sign in again to sync." : "Waiting for connection.",
          error_code: e.kind === "auth" ? "AUTH_REQUIRED" : "OFFLINE",
        });
        summary.stoppedBy = e.kind;
        break;
      }
      if (e.kind === "server") {
        await deps.save(failTransient(action, e.message || "Server error.", deps.now(), deps.random));
        summary.retrying++;
        continue;
      }
      // A request the server will never accept as sent: keep it for the driver
      await deps.save({ ...action, sync_status: "SYNC_FAILED", retryable: false, last_error: e.message, error_code: "CLIENT_ERROR" });
      summary.rejected++;
    }
  }
  return summary;
}

/** Make a failed record due again now (manual Retry). Conflicts are never retried this way. */
export function resetForRetry(action: QueuedAction): QueuedAction {
  if (action.sync_status !== "SYNC_FAILED") return action;
  return { ...action, sync_status: "PENDING_SYNC", attempts: 0, next_attempt_at: null, retryable: true };
}

// ─── Local view of a trip ─────────────────────────────────────────────────────

export interface StopLike {
  id: number;
  status: string;
  outcome_reason?: string | null;
}

export interface LocalStopState {
  status: string;
  outcome_reason: string | null;
  /** Sync state of the record behind this status; null = server-confirmed. */
  sync: SyncStatus | null;
  action_id: string | null;
}

const OPEN = ["pending", "arrived"];

export function isOpenStatus(status: string): boolean {
  return OPEN.includes(status);
}

function outcomeStatus(outcome: unknown): string {
  return outcome === "refused" ? "failed" : String(outcome);
}

/**
 * What to show for a stop: the server's status, overlaid with anything the
 * driver recorded on this phone that the server has not confirmed yet.
 */
export function localStopState(stop: StopLike, queue: QueuedAction[]): LocalStopState {
  const server: LocalStopState = { status: stop.status, outcome_reason: stop.outcome_reason ?? null, sync: null, action_id: null };
  const mine = queue.filter((a) => a.stop_id === stop.id).sort(byTime);
  const deliver = [...mine].reverse().find((a) => a.action_type === "deliver");
  const conflict = mine.find((a) => a.sync_status === "CONFLICT");

  if (!isOpenStatus(stop.status)) {
    // The server has a final answer; still flag a conflicting local record
    return conflict ? { ...server, sync: "CONFLICT", action_id: conflict.action_id } : server;
  }

  if (deliver) {
    if (deliver.sync_status === "SYNC_FAILED" && !deliver.retryable) {
      // Rejected: the local record is not valid, the stop is still open
      return { ...server, sync: "SYNC_FAILED", action_id: deliver.action_id };
    }
    const outcome = deliver.payload.outcome;
    const reason = outcome === "refused"
      ? ["Refused by outlet", deliver.payload.reason].filter(Boolean).join(": ")
      : (deliver.payload.reason as string | undefined) ?? null;
    return { status: outcomeStatus(outcome), outcome_reason: reason, sync: deliver.sync_status, action_id: deliver.action_id };
  }

  const arrive = [...mine].reverse().find((a) => a.action_type === "arrive" && a.sync_status !== "SYNC_FAILED");
  if (arrive && stop.status === "pending") {
    return { ...server, status: "arrived", sync: arrive.sync_status === "SYNCED" ? null : arrive.sync_status, action_id: arrive.action_id };
  }
  return server;
}

/** Local state of a trip completion recorded on this phone, if any. */
export function localTripCompletion(tripId: number, queue: QueuedAction[]): QueuedAction | null {
  const completions = queue.filter((a) => a.trip_id === tripId && a.action_type === "complete_trip").sort(byTime);
  return completions.length ? completions[completions.length - 1] : null;
}
