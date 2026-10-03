"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  getQueue, getState, getLastError, getAuthBlocked, getLastSyncAt,
  subscribe, flush, enqueue, enqueueWithPhoto, saveRecord, dequeue, dismissFailed,
  dismissRecord, retryRecord, retryAll, recheckConflict, outstandingFor, currentSession,
  initSyncQueue, type QueuedAction, type QueueState,
} from "./syncQueue";
import { belongsTo, selectSendable } from "./driverSync/engine";

// ─── Active connectivity probe ────────────────────────────────────────────────
// navigator.onLine is unreliable — it only checks if a network interface is UP,
// not if the backend is actually reachable (e.g. WiFi disconnected but loopback
// is still active). We probe the health endpoint every PROBE_INTERVAL ms.

const PROBE_URLS = [
  process.env.NEXT_PUBLIC_API_URL,
  "http://localhost:8000",
  "http://localhost:5000",
].filter(Boolean) as string[];

const PROBE_INTERVAL = 5000;  // check every 5 s
const PROBE_TIMEOUT  = 3000;  // give up after 3 s

async function probeConnectivity(): Promise<boolean> {
  for (const base of PROBE_URLS) {
    try {
      const res = await fetch(`${base}/api/v1/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT),
        cache: "no-store",
      });
      if (res.ok) return true;
    } catch {
      // try next
    }
  }
  return false;
}

// ─── Shared module-level state (survives re-renders) ─────────────────────────

let _initialized  = false;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSyncQueue() {
  const [queue, setQueue]         = useState<QueuedAction[]>([]);
  const [state, setState]         = useState<QueueState>("idle");
  const [online, setOnline]       = useState<boolean>(true);   // optimistic default
  const [lastError, setLastError] = useState<string | null>(null);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [lastSyncAt, setLastSyncAt]   = useState<string | null>(null);
  const [driverId, setDriverId]       = useState<number | null>(null);
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Probe & update online state ───────────────────────────────────────────
  const checkOnline = useCallback(async () => {
    const reachable = await probeConnectivity();
    setOnline(reachable);
    setDriverId(currentSession().driverId);
    // Reachable and something is due (new records, or a failed one whose backoff ran out)
    if (reachable && selectSendable(getQueue(), Date.now(), currentSession().driverId).length > 0) {
      flush();
    }
  }, []);

  useEffect(() => {
    // ── Init IndexedDB once ─────────────────────────────────────────────────
    if (!_initialized) {
      _initialized = true;
      initSyncQueue();
    }

    // ── Subscribe to queue changes ──────────────────────────────────────────
    const sync = () => {
      setQueue([...getQueue()]);
      setState(getState());
      setLastError(getLastError());
      setAuthBlocked(getAuthBlocked());
      setLastSyncAt(getLastSyncAt());
    };
    sync();
    const unsubscribe = subscribe(sync);

    // ── Initial probe (don't wait for the interval) ─────────────────────────
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkOnline();

    // ── Recurring probe ─────────────────────────────────────────────────────
    intervalRef.current = setInterval(checkOnline, PROBE_INTERVAL);

    // ── navigator events as a HINT to re-probe immediately ──────────────────
    // (They can give false positives but they're a good early-warning signal)
    const handleOnline  = () => checkOnline();
    const handleOffline = () => { setOnline(false); checkOnline(); };
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      unsubscribe();
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkOnline]);

  const mine = queue.filter((a) => belongsTo(a, driverId));

  return {
    queue: mine,
    state,
    online,
    lastError,
    authBlocked,
    lastSyncAt,
    driverId,
    /** Waiting to be sent (new, uploading, or failed and due to retry). */
    pendingCount:  mine.filter((a) => a.sync_status === "PENDING_SYNC" || a.sync_status === "SYNCING").length,
    failedCount:   mine.filter((a) => a.sync_status === "SYNC_FAILED").length,
    syncingCount:  mine.filter((a) => a.sync_status === "SYNCING").length,
    conflictCount: mine.filter((a) => a.sync_status === "CONFLICT").length,
    syncedCount:   mine.filter((a) => a.sync_status === "SYNCED").length,
    /** Not yet confirmed by the server (or a conflict nobody has reviewed). */
    outstandingCount: outstandingFor(driverId).length,
    flush,
    retryAll,
    retryRecord,
    recheckConflict,
    saveRecord,
    enqueue,
    enqueueWithPhoto,
    dequeue,
    dismissFailed,
    dismissRecord,
  };
}
