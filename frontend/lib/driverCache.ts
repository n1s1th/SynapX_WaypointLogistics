/**
 * The driver app's last-known server data, kept on the phone so the screens
 * still show the trip with no signal. Reads only: what the driver does offline
 * goes through the sync queue (lib/syncQueue.ts).
 */
import { apiFetch, ApiError } from "./api";

const PREFIX = "driver-cache:";

export function readCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(path: string, data: T) {
  try {
    localStorage.setItem(PREFIX + path, JSON.stringify(data));
  } catch {
    // storage full or blocked: the screens just need signal
  }
}

/**
 * Have the service worker save a driver page for offline use. A page reached by
 * an in-app tap is not saved on its own; this is for pages whose address holds
 * an id (/driver/trip/12), which can't be saved up front.
 */
export function keepPageOffline(path: string) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  fetch(path, { headers: { Accept: "text/html" } }).catch(() => undefined);
}

/** GET that keeps the last answer and returns it when there's no signal. */
export async function cachedGet<T>(path: string): Promise<T> {
  try {
    const data = await apiFetch<T>(path);
    writeCache(path, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.isNetworkError) {
      const cached = readCache<T>(path);
      if (cached !== null) return cached;
    }
    throw err;
  }
}
