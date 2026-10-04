// Flag photos waiting to upload. Kept in their own IndexedDB database, apart
// from the outbox: the flag itself is queued and sent exactly as before, and
// its photo follows once the flag is on the server (keyed by the flag's
// client_action_id). A photo never holds the flag back.

import { NetworkError, type Transport } from "./transport";

const DB_NAME = "waypoint-loader-photos";
const STORE = "photos";

export interface QueuedPhoto {
  client_action_id: string;
  run_code: string;
  order_number: string;
  blob: Blob;
  created_at: string;
}

/** Fired on window when a photo is queued or uploaded, so screens and the uploader react. */
export const PHOTO_QUEUE_EVENT = "waypoint-loader-photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_action_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => window.dispatchEvent(new Event(PHOTO_QUEUE_EVENT));

/** Keep a flag's photo until it uploads. Best effort: no IndexedDB, no photo. */
export async function queuePhoto(photo: QueuedPhoto): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(photo));
    changed();
  } catch {
    // Storage blocked: the flag still goes; only its photo is lost.
  }
}

export async function queuedPhotos(): Promise<QueuedPhoto[]> {
  try {
    return await run("readonly", (s) => s.getAll() as IDBRequest<QueuedPhoto[]>);
  } catch {
    return [];
  }
}

/** The photo still waiting for one run's order (a run has one flag per order). */
export async function queuedPhotoFor(runCode: string, orderNumber: string): Promise<QueuedPhoto | undefined> {
  return (await queuedPhotos()).find((p) => p.run_code === runCode && p.order_number === orderNumber);
}

async function remove(clientActionId: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(clientActionId));
  } catch {
    // Left in place: the next upload finds the photo already attached.
  }
}

let uploading = false;

/**
 * Upload every queued photo. A photo whose flag is not on the server yet
 * stays for the next sync; one the server refuses (too big, wrong type) is
 * dropped; offline, everything stays.
 */
export async function uploadQueuedPhotos(transport: Transport): Promise<void> {
  if (uploading) return;
  uploading = true;
  try {
    for (const photo of await queuedPhotos()) {
      let result: Awaited<ReturnType<Transport["uploadIssuePhoto"]>>;
      try {
        result = await transport.uploadIssuePhoto(photo.client_action_id, photo.blob);
      } catch (err) {
        if (err instanceof NetworkError) return;
        throw err;
      }
      if (result !== "not_found") {
        await remove(photo.client_action_id);
        changed();
      }
    }
  } finally {
    uploading = false;
  }
}
