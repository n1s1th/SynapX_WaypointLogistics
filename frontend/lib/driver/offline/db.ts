// IndexedDB on the driver's phone: the last server copy of each trip and run
// sheet, the run list and profile, and the outbox of records made offline.
// Raw IndexedDB, no dependency (same approach as lib/loader/offline/db.ts).

import type { DriverTrip, QueuedAction, RunSheet } from "../types";

const DB_NAME = "waypoint-driver";
const DB_VERSION = 1;
const TRIPS = "trips";
const SHEETS = "sheets";
const KV = "kv";
const OUTBOX = "outbox";

interface KvEntry<T> {
  key: string;
  value: T;
  saved_at: string;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRIPS)) db.createObjectStore(TRIPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SHEETS)) db.createObjectStore(SHEETS, { keyPath: "code" });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OUTBOX)) {
        const outbox = db.createObjectStore(OUTBOX, { keyPath: "client_action_id" });
        outbox.createIndex("created_at", "created_at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = undefined;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

// ---- Trips and run sheets --------------------------------------------------

export async function getCachedTrip(tripId: number): Promise<DriverTrip | undefined> {
  return request((await store(TRIPS, "readonly")).get(tripId));
}

export async function putCachedTrip(trip: DriverTrip): Promise<void> {
  await request((await store(TRIPS, "readwrite")).put(trip));
}

export async function getCachedSheet(code: string): Promise<RunSheet | undefined> {
  return request((await store(SHEETS, "readonly")).get(code));
}

export async function putCachedSheet(sheet: RunSheet): Promise<void> {
  await request((await store(SHEETS, "readwrite")).put(sheet));
}

// ---- Small values (run list, profile, availability) ------------------------

export async function getValue<T>(key: string): Promise<{ value: T; saved_at: string } | undefined> {
  const entry = (await request((await store(KV, "readonly")).get(key))) as KvEntry<T> | undefined;
  return entry ? { value: entry.value, saved_at: entry.saved_at } : undefined;
}

export async function putValue<T>(key: string, value: T): Promise<void> {
  const entry: KvEntry<T> = { key, value, saved_at: new Date().toISOString() };
  await request((await store(KV, "readwrite")).put(entry));
}

// ---- Outbox -------------------------------------------------------------------

/** Every queued action, oldest first. */
export async function listOutbox(): Promise<QueuedAction[]> {
  const index = (await store(OUTBOX, "readonly")).index("created_at");
  return request(index.getAll());
}

export async function putOutboxAction(action: QueuedAction): Promise<void> {
  await request((await store(OUTBOX, "readwrite")).put(action));
}

export async function deleteOutboxAction(clientActionId: string): Promise<void> {
  await request((await store(OUTBOX, "readwrite")).delete(clientActionId));
}

/** On sign-out: drop the cached trips and profile. The outbox is kept, so records
 * made offline still reach the server when this driver signs in again. */
export async function clearCachedData(): Promise<void> {
  for (const name of [TRIPS, SHEETS, KV]) {
    await request((await store(name, "readwrite")).clear());
  }
}
