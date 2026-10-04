"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  getQueue, getState, getLastError,
  subscribe, flush, enqueue, enqueueWithPhoto, dequeue, dismissFailed,
  initSyncQueue, PendingAction, QueueState
} from "./syncQueue";

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
  const [queue, setQueue]         = useState<PendingAction[]>([]);
  const [state, setState]         = useState<QueueState>("idle");
  const [online, setOnline]       = useState<boolean>(true);   // optimistic default
  const [lastError, setLastError] = useState<string | null>(null);
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Probe & update online state ───────────────────────────────────────────
  const checkOnline = useCallback(async () => {
    const reachable = await probeConnectivity();
    setOnline(reachable);
    // If we just came back online and there are pending items, flush
    if (reachable && getQueue().filter((a) => a.status === "pending").length > 0) {
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
    };
    sync();
    const unsubscribe = subscribe(sync);

    // ── Initial probe (don't wait for the interval) ─────────────────────────
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

  return {
    queue,
    state,
    online,
    lastError,
    pendingCount:  queue.filter((a) => a.status === "pending").length,
    failedCount:   queue.filter((a) => a.status === "failed").length,
    syncingCount:  queue.filter((a) => a.status === "syncing").length,
    flush,
    enqueue,
    enqueueWithPhoto,
    dequeue,
    dismissFailed,
  };
}
