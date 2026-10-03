/**
 * Offline Sync Queue — Waypoint Logistics (driver)
 *
 * IndexedDB holds everything the driver needs without a signal:
 *   sync_queue     every write the driver made (arrival, delivery, issue, trip completion)
 *   offline_files  photo blobs attached to those writes
 *   trip_cache     the last server copy of each trip (stops, orders, POD rules)
 *   kv             the signed-in driver's profile
 *
 * Every write is saved here first — durably, before the UI says "saved" —
 * and then sent to POST /driver/sync by the engine in lib/driverSync/engine.ts.
 * Neon stays the source of truth: a record only becomes SYNCED when the server
 * confirms it, and conflicts wait for a dispatcher instead of being resolved here.
 *
 * All functions are safe to import during SSR; they do nothing without a browser.
 */

import { openDB, type IDBPDatabase } from "idb";
import { apiFetch, apiFetchUpload, ApiError } from "./api";
import { getToken } from "./auth";
import {
  belongsTo,
  classifyHttpStatus,
  isUnsynced,
  resetForRetry,
  runFlush,
  TransportError,
  type FlushSummary,
  type QueuedAction,
  type ServerResult,
  type SyncActionType,
  type SyncRequest,
} from "./driverSync/engine";

export type { QueuedAction, SyncStatus, FlushSummary } from "./driverSync/engine";

/** @deprecated kept for older imports; same as QueuedAction */
export type PendingAction = QueuedAction;
export type QueueState = "idle" | "syncing" | "error";

/** Failed to save on the phone (storage full, private mode, ...). Nothing was saved. */
export class LocalSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalSaveError";
  }
}

// ─── DB Setup ─────────────────────────────────────────────────────────────────

const DB_NAME = "WaypointOfflineSync";
const DB_VERSION = 2;
const STORE_QUEUE = "sync_queue";
const STORE_FILES = "offline_files";
const STORE_TRIPS = "trip_cache";
const STORE_KV = "kv";

/** Confirmed records stay visible this long before they are pruned. */
const KEEP_SYNCED_MS = 24 * 60 * 60 * 1000;

let _dbPromise: Promise<IDBPDatabase> | null = null;

function browserReady(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/** v1 rows (pending/syncing/failed, single offlinePhotoKey) → v2 shape. */
function migrateV1(old: Record<string, unknown>): QueuedAction {
  const status = old.status === "failed" ? "SYNC_FAILED" : "PENDING_SYNC";
  return {
    action_id: String(old.action_id),
    action_type: old.action_type as SyncActionType,
    trip_id: (old.trip_id as number) ?? null,
    stop_id: (old.stop_id as number) ?? null,
    driver_id: null,
    payload: (old.payload as Record<string, unknown>) ?? {},
    client_timestamp: String(old.client_timestamp),
    label: String(old.label ?? old.action_type),
    sync_status: status,
    attempts: Number(old.retryCount ?? 0),
    next_attempt_at: null,
    last_error: status === "SYNC_FAILED" ? "Could not sync (recorded by an older app version)." : null,
    error_code: null,
    retryable: status !== "SYNC_FAILED",
    photo_keys: old.offlinePhotoKey ? [String(old.offlinePhotoKey)] : [],
    uploaded: {},
    server: null,
    synced_at: null,
  };
}

function getDB(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const qs = db.createObjectStore(STORE_QUEUE, { keyPath: "action_id" });
          qs.createIndex("by_timestamp", "client_timestamp");
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
        if (!db.objectStoreNames.contains(STORE_TRIPS)) db.createObjectStore(STORE_TRIPS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: "key" });

        if (oldVersion === 1) {
          let cursor = await tx.objectStore(STORE_QUEUE).openCursor();
          while (cursor) {
            await cursor.update(migrateV1(cursor.value));
            cursor = await cursor.continue();
          }
        }
      },
    });
  }
  return _dbPromise;
}

function toSaveError(err: unknown): LocalSaveError {
  const name = (err as { name?: string })?.name;
  if (name === "QuotaExceededError") {
    return new LocalSaveError("This phone is out of storage space. The record was NOT saved — free up space and try again.");
  }
  return new LocalSaveError(`Couldn't save on this phone (${(err as Error)?.message ?? "storage unavailable"}). The record was NOT saved.`);
}

/** UUID v4; crypto.randomUUID only exists on HTTPS/localhost (a phone on http://192.168.x.x lacks it). */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ─── Session (read from the stored token, works offline) ─────────────────────

export interface LocalSession {
  driverId: number | null;
  expired: boolean;
}

export function currentSession(): LocalSession {
  const token = getToken();
  if (!token) return { driverId: null, expired: false };
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    const driverId = Number(claims.sub);
    return {
      driverId: Number.isFinite(driverId) ? driverId : null,
      expired: typeof claims.exp === "number" && claims.exp * 1000 <= Date.now(),
    };
  } catch {
    return { driverId: null, expired: false };
  }
}

// ─── In-memory mirror (for React subscriptions) ──────────────────────────────

let _queue: QueuedAction[] = [];
let _state: QueueState = "idle";
let _lastError: string | null = null;
let _authBlocked = false;
let _lastSyncAt: string | null = null;
let _listeners: Array<() => void> = [];

function _notify() {
  _listeners.forEach((fn) => fn());
}

async function _loadQueue() {
  const db = await getDB();
  _queue = (await db.getAllFromIndex(STORE_QUEUE, "by_timestamp")) as QueuedAction[];
  _notify();
}

// ─── Init (call once at app startup) ─────────────────────────────────────────

let _initialized = false;

export async function initSyncQueue() {
  if (_initialized || !browserReady()) return;
  _initialized = true;
  try {
    // Ask the browser not to evict our data under storage pressure
    await navigator.storage?.persist?.();
  } catch {
    // Not supported: data still lives in IndexedDB, just without the guarantee
  }
  const db = await getDB();
  const all = (await db.getAll(STORE_QUEUE)) as QueuedAction[];
  const tx = db.transaction([STORE_QUEUE, STORE_FILES], "readwrite");
  const now = Date.now();
  for (const a of all) {
    if (a.sync_status === "SYNCING") {
      // The app was closed mid-sync; the server dedupes, so just send it again
      await tx.objectStore(STORE_QUEUE).put({ ...a, sync_status: "PENDING_SYNC" });
    } else if (a.sync_status === "SYNCED" && a.synced_at && now - Date.parse(a.synced_at) > KEEP_SYNCED_MS) {
      await tx.objectStore(STORE_QUEUE).delete(a.action_id);
      for (const key of a.photo_keys) await tx.objectStore(STORE_FILES).delete(key);
    }
  }
  await tx.done;
  await _loadQueue();
}

// ─── Saving records ───────────────────────────────────────────────────────────

export interface NewRecord {
  action_type: SyncActionType;
  trip_id: number | null;
  stop_id?: number | null;
  payload: Record<string, unknown>;
  label: string;
}

/**
 * Save a record (and its photos) to IndexedDB in one transaction. Resolves
 * only once the browser has committed it; throws LocalSaveError otherwise.
 * Then starts a sync in the background.
 */
export async function saveRecord(input: NewRecord, photos: Blob[] = []): Promise<QueuedAction> {
  if (!browserReady()) throw new LocalSaveError("Offline storage is not available in this browser.");
  const photoKeys = photos.map(() => uuid());
  const action: QueuedAction = {
    action_id: uuid(),
    action_type: input.action_type,
    trip_id: input.trip_id,
    stop_id: input.stop_id ?? null,
    driver_id: currentSession().driverId,
    payload: input.payload,
    client_timestamp: new Date().toISOString(),
    label: input.label,
    sync_status: "PENDING_SYNC",
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    error_code: null,
    retryable: true,
    photo_keys: photoKeys,
    uploaded: {},
    server: null,
    synced_at: null,
  };

  try {
    const db = await getDB();
    const tx = db.transaction([STORE_QUEUE, STORE_FILES], "readwrite");
    await Promise.all([
      ...photos.map((blob, i) => tx.objectStore(STORE_FILES).put(blob, photoKeys[i])),
      tx.objectStore(STORE_QUEUE).put(action),
      tx.done,
    ]);
  } catch (err) {
    throw toSaveError(err);
  }

  await _loadQueue();
  void flush();
  return action;
}

/** Compatibility with the report page (single optional photo). */
export function enqueue(action: Omit<NewRecord, "payload"> & { payload?: Record<string, unknown>; stop_id?: number | null }) {
  return saveRecord({ ...action, payload: action.payload ?? {} });
}

export function enqueueWithPhoto(
  action: Omit<NewRecord, "payload"> & { payload?: Record<string, unknown>; stop_id?: number | null },
  photoBlob: Blob,
) {
  return saveRecord({ ...action, payload: action.payload ?? {} }, [photoBlob]);
}

// ─── Transport ────────────────────────────────────────────────────────────────

function toTransportError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  if (err instanceof ApiError) return new TransportError(classifyHttpStatus(err.status), err.status, err.message);
  return new TransportError("network", 0, "No connection to the server.");
}

async function uploadPhoto(blob: Blob, fileId: string): Promise<string> {
  const form = new FormData();
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  form.append("file", blob, `${fileId}.${ext}`);
  form.append("client_file_id", fileId);
  try {
    const { photo_url } = await apiFetchUpload<{ photo_url: string }>("/driver/upload/photo", form);
    return photo_url;
  } catch (err) {
    throw toTransportError(err);
  }
}

async function sendRecord(request: SyncRequest): Promise<ServerResult> {
  let response: { results?: ServerResult[] };
  try {
    response = await apiFetch<{ results?: ServerResult[] }>("/driver/sync", {
      method: "POST",
      body: JSON.stringify([request]),
    });
  } catch (err) {
    throw toTransportError(err);
  }
  const result = response.results?.find((r) => r.action_id === request.action_id);
  if (!result) throw new TransportError("server", 502, "The server did not confirm this record.");
  return result;
}

// ─── Flush ────────────────────────────────────────────────────────────────────

let _flushPromise: Promise<FlushSummary | null> | null = null;

/** Send every due record. Calls made while a flush runs share it. */
export function flush(): Promise<FlushSummary | null> {
  if (!browserReady()) return Promise.resolve(null);
  _flushPromise ??= _flush().finally(() => {
    _flushPromise = null;
  });
  return _flushPromise;
}

async function _flush(): Promise<FlushSummary | null> {
  const session = currentSession();
  if (session.driverId == null || session.expired) {
    _authBlocked = _queue.some((a) => isUnsynced(a));
    _notify();
    return null;
  }

  _state = "syncing";
  _notify();
  const db = await getDB();
  try {
    const summary = await runFlush({
      list: async () => (await db.getAll(STORE_QUEUE)) as QueuedAction[],
      save: async (a) => {
        await db.put(STORE_QUEUE, a);
        await _loadQueue();
      },
      getBlob: async (key) => (await db.get(STORE_FILES, key)) as Blob | undefined,
      deleteBlob: async (key) => {
        await db.delete(STORE_FILES, key);
      },
      upload: uploadPhoto,
      send: sendRecord,
      now: () => Date.now(),
      driverId: session.driverId,
    });
    _authBlocked = summary.stoppedBy === "auth";
    _lastError = null;
    if (summary.synced > 0 || summary.conflicts > 0 || summary.rejected > 0) {
      _lastSyncAt = new Date().toISOString();
      window.dispatchEvent(new CustomEvent("driver-sync:flushed", { detail: summary }));
    }
    _state = "idle";
    return summary;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : "Sync failed";
    _state = "error";
    return null;
  } finally {
    await _loadQueue();
  }
}

/** Resolve once a record leaves PENDING_SYNC/SYNCING, or after timeoutMs. */
export function waitForRecord(actionId: string, timeoutMs: number): Promise<QueuedAction | null> {
  return new Promise((resolve) => {
    const check = () => {
      const a = _queue.find((x) => x.action_id === actionId) ?? null;
      if (a && a.sync_status !== "PENDING_SYNC" && a.sync_status !== "SYNCING") {
        done(a);
        return true;
      }
      return false;
    };
    const timer = setTimeout(() => done(_queue.find((x) => x.action_id === actionId) ?? null), timeoutMs);
    const unsubscribe = subscribe(() => void check());
    function done(a: QueuedAction | null) {
      clearTimeout(timer);
      unsubscribe();
      resolve(a);
    }
    check();
  });
}

// ─── Driver actions on records ────────────────────────────────────────────────

/** Manual Retry: make a failed record due now and sync. Conflicts are not retried. */
export async function retryRecord(actionId: string) {
  const db = await getDB();
  const a = (await db.get(STORE_QUEUE, actionId)) as QueuedAction | undefined;
  if (!a) return;
  await db.put(STORE_QUEUE, resetForRetry(a));
  await _loadQueue();
  return flush();
}

/** Retry everything that failed with a retryable error, then sync. */
export async function retryAll() {
  const db = await getDB();
  const all = (await db.getAll(STORE_QUEUE)) as QueuedAction[];
  for (const a of all) {
    if (a.sync_status === "SYNC_FAILED" && a.retryable) await db.put(STORE_QUEUE, resetForRetry(a));
  }
  await _loadQueue();
  return flush();
}

/**
 * Remove a record from this phone. Allowed only when the server no longer
 * needs it: confirmed, rejected (to be recorded again), or a conflict a
 * dispatcher has reviewed.
 */
export async function dismissRecord(actionId: string) {
  const db = await getDB();
  const a = (await db.get(STORE_QUEUE, actionId)) as QueuedAction | undefined;
  if (!a) return;
  const removable =
    a.sync_status === "SYNCED" ||
    (a.sync_status === "SYNC_FAILED" && !a.retryable) ||
    (a.sync_status === "CONFLICT" && a.server?.reviewed);
  if (!removable) throw new Error("This record still needs to reach the server or be reviewed by a dispatcher.");
  const tx = db.transaction([STORE_QUEUE, STORE_FILES], "readwrite");
  await Promise.all([
    tx.objectStore(STORE_QUEUE).delete(actionId),
    ...a.photo_keys.map((k) => tx.objectStore(STORE_FILES).delete(k)),
    tx.done,
  ]);
  await _loadQueue();
}

/** Ask the server again about a conflict (deduped there, never re-applied). */
export async function recheckConflict(actionId: string): Promise<QueuedAction | null> {
  const db = await getDB();
  const a = (await db.get(STORE_QUEUE, actionId)) as QueuedAction | undefined;
  if (!a || a.sync_status !== "CONFLICT") return a ?? null;
  const payload = a.photo_keys.length
    ? { ...a.payload, photo_urls: a.photo_keys.map((k) => a.uploaded[k]).filter(Boolean) }
    : a.payload;
  const result = await sendRecord({
    action_id: a.action_id, action_type: a.action_type, trip_id: a.trip_id, stop_id: a.stop_id,
    payload, client_timestamp: a.client_timestamp,
  });
  const updated: QueuedAction = { ...a, server: result, last_error: result.message ?? a.last_error };
  await db.put(STORE_QUEUE, updated);
  await _loadQueue();
  return updated;
}

/** @deprecated use dismissRecord */
export const dismissFailed = dismissRecord;
/** @deprecated use dismissRecord */
export const dequeue = dismissRecord;

// ─── Trip cache ───────────────────────────────────────────────────────────────

export interface CachedTripRow<T> {
  id: number;
  driver_id: number;
  data: T;
  cached_at: string;
}

export async function cacheTrip<T extends { id: number; driver_id: number }>(trip: T): Promise<void> {
  if (!browserReady()) return;
  try {
    const db = await getDB();
    await db.put(STORE_TRIPS, { id: trip.id, driver_id: trip.driver_id, data: trip, cached_at: new Date().toISOString() });
  } catch {
    // A cache write failing is not fatal: the previous copy (if any) stays usable
  }
}

export async function getCachedTrip<T>(tripId: number): Promise<CachedTripRow<T> | null> {
  if (!browserReady()) return null;
  const db = await getDB();
  return ((await db.get(STORE_TRIPS, tripId)) as CachedTripRow<T> | undefined) ?? null;
}

/** Cached trips for the signed-in driver only, newest first. */
export async function listCachedTrips<T>(): Promise<CachedTripRow<T>[]> {
  if (!browserReady()) return [];
  const { driverId } = currentSession();
  if (driverId == null) return [];
  const db = await getDB();
  const rows = (await db.getAll(STORE_TRIPS)) as CachedTripRow<T>[];
  return rows.filter((r) => r.driver_id === driverId).sort((a, b) => b.cached_at.localeCompare(a.cached_at));
}

export async function cacheProfile(profile: { id: number; full_name: string }): Promise<void> {
  if (!browserReady()) return;
  try {
    const db = await getDB();
    await db.put(STORE_KV, { key: "profile", value: profile });
  } catch {
    // Non-critical
  }
}

export async function getCachedProfile(): Promise<{ id: number; full_name: string } | null> {
  if (!browserReady()) return null;
  const db = await getDB();
  const row = (await db.get(STORE_KV, "profile")) as { value: { id: number; full_name: string } } | undefined;
  const { driverId } = currentSession();
  return row && row.value.id === driverId ? row.value : null;
}

// ─── Sign-out policy ──────────────────────────────────────────────────────────

/** Records that still need the server (or a dispatcher) for this driver. */
export function outstandingFor(driverId: number | null): QueuedAction[] {
  return _queue.filter((a) => belongsTo(a, driverId) && (isUnsynced(a) || (a.sync_status === "CONFLICT" && !a.server?.reviewed)));
}

/**
 * Call before clearing the token. Unsynced records and their evidence are
 * always kept (they sync after the next sign-in). Cached trips — customer
 * names, addresses, orders — are removed when nothing is waiting on them.
 */
export async function prepareSignOut(): Promise<{ kept: number }> {
  if (!browserReady()) return { kept: 0 };
  const kept = outstandingFor(currentSession().driverId).length;
  if (kept === 0) {
    const db = await getDB();
    const tx = db.transaction([STORE_TRIPS, STORE_KV], "readwrite");
    await Promise.all([tx.objectStore(STORE_TRIPS).clear(), tx.objectStore(STORE_KV).clear(), tx.done]);
  }
  return { kept };
}

// ─── Getters & subscription ───────────────────────────────────────────────────

export function getQueue(): QueuedAction[] {
  return _queue;
}
export function getState(): QueueState {
  return _state;
}
export function getLastError(): string | null {
  return _lastError;
}
export function getAuthBlocked(): boolean {
  return _authBlocked;
}
export function getLastSyncAt(): string | null {
  return _lastSyncAt;
}

export function subscribe(fn: () => void): () => void {
  _listeners = [..._listeners, fn];
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}
