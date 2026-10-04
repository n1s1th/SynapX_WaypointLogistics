/**
 * Offline Sync Queue — Waypoint Logistics
 *
 * Actions performed while offline (arrive, outcome, pod, complete, issue)
 * are saved to IndexedDB. When connectivity is restored they are flushed
 * to POST /driver/sync in chronological order.
 *
 * Photo files taken offline are stored as Blobs in the "offline_files"
 * object store. During sync the file is uploaded first, the returned URL
 * is injected into the action payload, then the JSON action is sent.
 */

import { openDB, IDBPDatabase } from "idb";
import { apiFetch, apiFetchUpload, ApiError } from "./api";
import { getToken } from "./auth";
import { decodeJwt } from "./keycloak";

export function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncActionType = "arrive" | "outcome" | "pod" | "complete" | "issue" | "sos";
export type ActionStatus   = "pending" | "syncing" | "failed";

export interface PendingAction {
  action_id: string;            // UUID — primary key in IndexedDB
  action_type: SyncActionType;
  stop_id?: number;
  trip_id?: number;
  payload: Record<string, unknown>;
  client_timestamp: string;
  label: string;
  status: ActionStatus;
  retryCount: number;
  /** If set, this action needs a photo uploaded first. The value is the
   *  key used in the "offline_files" object store. */
  offlinePhotoKey?: string;
}

export interface SyncConflict {
  action_id: string;
  stop_id?: number;
  reason: string;
  server_state: Record<string, unknown>;
}

export interface SyncResult {
  processed_count: number;
  conflicts: SyncConflict[];
}

export type QueueState = "idle" | "syncing" | "error";

// ─── DB Setup ─────────────────────────────────────────────────────────────────

const DB_NAME    = "WaypointOfflineSync";
const DB_VERSION = 1;
const STORE_QUEUE = "sync_queue";
const STORE_FILES = "offline_files";

let _dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const qs = db.createObjectStore(STORE_QUEUE, { keyPath: "action_id" });
          qs.createIndex("by_timestamp", "client_timestamp");
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES);
        }
      },
    });
  }
  return _dbPromise;
}

// ─── In-memory state (for React subscriptions) ────────────────────────────────

let _queue: PendingAction[] = [];
let _state: QueueState      = "idle";
let _lastError: string | null = null;
let _listeners: Array<() => void> = [];

function _notify() { _listeners.forEach((fn) => fn()); }

async function _loadQueue() {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE_QUEUE, "by_timestamp");
  _queue = all as PendingAction[];
  _notify();
}

// ─── Init (call once at app startup) ─────────────────────────────────────────

let _initialized = false;

export async function initSyncQueue() {
  if (_initialized) return;
  _initialized = true;
  // A record left "syncing" was cut off (page closed or reloaded mid-send):
  // send it again. The server ignores a repeat of an action it already has.
  const db = await getDB();
  const all = (await db.getAll(STORE_QUEUE)) as PendingAction[];
  await Promise.all(
    all.filter((a) => a.status === "syncing").map((a) => db.put(STORE_QUEUE, { ...a, status: "pending" }))
  );
  await _loadQueue();
  window.addEventListener("online", () => {
    if (_queue.length > 0) flush();
  });
}

// ─── Enqueue a regular action ─────────────────────────────────────────────────

export async function enqueue(
  action: Omit<PendingAction, "action_id" | "client_timestamp" | "status" | "retryCount">
) {
  const item: PendingAction = {
    ...action,
    action_id: generateUUID(),
    client_timestamp: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
  };
  const db = await getDB();
  await db.put(STORE_QUEUE, item);
  await _loadQueue();
  if (navigator.onLine) flush();
}

// ─── Enqueue an action that has an offline photo attached ─────────────────────

export async function enqueueWithPhoto(
  action: Omit<PendingAction, "action_id" | "client_timestamp" | "status" | "retryCount" | "offlinePhotoKey">,
  photoBlob: Blob
) {
  const photoKey = generateUUID();
  const db = await getDB();

  // Save photo blob
  await db.put(STORE_FILES, photoBlob, photoKey);

  const item: PendingAction = {
    ...action,
    action_id: generateUUID(),
    client_timestamp: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
    offlinePhotoKey: photoKey,
  };
  await db.put(STORE_QUEUE, item);
  await _loadQueue();
  if (navigator.onLine) flush();
}

// ─── Remove one item ──────────────────────────────────────────────────────────

export async function dequeue(action_id: string) {
  const db = await getDB();
  await db.delete(STORE_QUEUE, action_id);
  await _loadQueue();
}

// ─── Flush — send pending actions to the server ───────────────────────────────

let _flushInFlight = false;

export async function flush(): Promise<SyncResult | null> {
  // Records go out only with the login of the driver who made them.
  if (_flushInFlight || !ownsQueue()) return null;
  const pending = _queue.filter((a) => a.status === "pending");
  if (pending.length === 0) return null;

  _flushInFlight = true;
  _state = "syncing";
  _notify();

  const db = await getDB();

  try {
    // Process each action individually in timestamp order so we can handle
    // photo uploads per-action without bundling everything in one big POST.
    let processed_count = 0;
    const conflicts: SyncConflict[] = [];

    for (const action of pending) {
      // Mark as syncing in DB
      await db.put(STORE_QUEUE, { ...action, status: "syncing" });
      await _loadQueue();

      try {
        let finalPayload = { ...action.payload };

        // If action has an attached offline photo, upload it first
        if (action.offlinePhotoKey) {
          const blob = await db.get(STORE_FILES, action.offlinePhotoKey) as Blob | undefined;
          if (blob) {
            const formData = new FormData();
            formData.append("file", blob, "offline_photo.jpg");
            const { photo_url } = await apiFetchUpload<{ photo_url: string }>(
              "/driver/upload/photo",
              formData
            );
            finalPayload = { ...finalPayload, photo_url };
            // Clean up the stored file
            await db.delete(STORE_FILES, action.offlinePhotoKey);
          }
        }

        // Send the action to the batch sync endpoint
        const result = await apiFetch<SyncResult>("/driver/sync", {
          method: "POST",
          body: JSON.stringify([{ ...action, payload: finalPayload }]),
        });

        if (result.conflicts.length > 0) {
          conflicts.push(...result.conflicts);
          // Mark as failed — keep in queue for manual review
          await db.put(STORE_QUEUE, { ...action, status: "failed", retryCount: action.retryCount + 1 });
        } else {
          processed_count++;
          await db.delete(STORE_QUEUE, action.action_id);
        }
      } catch (err: unknown) {
        if (err instanceof ApiError && !err.isNetworkError) {
          // Server rejected it (e.g. 400, 500). Mark as failed so driver can dismiss it.
          await db.put(STORE_QUEUE, { ...action, status: "failed", retryCount: action.retryCount + 1 });
        } else {
          // Network error mid-sync — stop and try again later
          await db.put(STORE_QUEUE, { ...action, status: "pending" });
          break;
        }
      }
    }

    await _loadQueue();
    _state = "idle";
    _notify();
    return { processed_count, conflicts };
  } catch (err: unknown) {
    _lastError = err instanceof Error ? err.message : "Sync failed";
    _state = "error";
    _notify();
    return null;
  } finally {
    _flushInFlight = false;
  }
}

// ─── Dismiss a failed action ──────────────────────────────────────────────────

export async function dismissFailed(action_id: string) {
  const db = await getDB();
  await db.delete(STORE_QUEUE, action_id);
  await _loadQueue();
}

// ─── Owner: the driver these records belong to ──────────────────────────────
// Phones are shared. The server says who is logged in (claimQueue, from the
// driver session check); until then, and for anyone else, nothing is sent.

const OWNER_KEY = "driver-queue-owner";

interface QueueOwner {
  userId: number;
  sub: string | null; // the login token's subject, so the check works offline
}

function tokenSubject(): string | null {
  const token = getToken();
  return token ? decodeJwt<{ sub?: string }>(token)?.sub ?? null : null;
}

function readOwner(): QueueOwner | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    return raw ? (JSON.parse(raw) as QueueOwner) : null;
  } catch {
    return null;
  }
}

function ownsQueue(): boolean {
  const sub = tokenSubject();
  return sub !== null && readOwner()?.sub === sub;
}

/** The server says driver `userId` is logged in. Returns true when the records
 *  on the phone were another driver's: they are deleted, never sent as this one. */
export async function claimQueue(userId: number): Promise<boolean> {
  const owner = readOwner();
  const switched = owner !== null && owner.userId !== userId;
  if (switched) await clearQueue();
  localStorage.setItem(OWNER_KEY, JSON.stringify({ userId, sub: tokenSubject() }));
  void flush();
  return switched;
}

// ─── Forget everything (a different driver logged in on this phone) ─────────

export async function clearQueue() {
  const db = await getDB();
  await db.clear(STORE_QUEUE);
  await db.clear(STORE_FILES);
  await _loadQueue();
}

// ─── Getters ──────────────────────────────────────────────────────────────────

export function getQueue(): PendingAction[] { return _queue; }
export function getState(): QueueState      { return _state; }
export function getLastError(): string | null { return _lastError; }

// ─── Subscribe (for useSyncQueue hook) ────────────────────────────────────────

export function subscribe(fn: () => void): () => void {
  _listeners = [..._listeners, fn];
  return () => { _listeners = _listeners.filter((l) => l !== fn); };
}
