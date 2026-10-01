"use client";

// Driver app runtime: the sign-in guard, connectivity, the offline outbox and
// automatic sync. Every /driver page sits inside it (app/driver/layout.tsx).

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/auth";
import { clearCachedData, listOutbox } from "@/lib/driver/offline/db";
import { enqueue, type NewAction } from "@/lib/driver/offline/outbox";
import { flushOutbox, type FlushResult } from "@/lib/driver/offline/sync";
import { isSimulatedOffline, subscribeSimulatedOffline } from "@/lib/driver/demo";
import type { QueuedAction } from "@/lib/driver/types";

/** Retry queued records this often while there are some. */
const AUTO_SYNC_MS = 30_000;
const PUBLIC_PATHS = new Set(["/driver/login"]);

export interface LastSync {
  at: string;
  result: FlushResult;
}

interface DriverContextValue {
  /** The browser has a network and the server answered the last request. */
  online: boolean;
  outbox: QueuedAction[];
  pendingCount: number;
  conflictCount: number;
  failedCount: number;
  syncing: boolean;
  lastSync: LastSync | null;
  /** Bumps whenever records reached the server, so screens refetch. */
  dataVersion: number;
  /** Save a write on the phone, show it at once, and send it when possible. */
  perform: (input: NewAction) => Promise<QueuedAction>;
  syncNow: () => Promise<FlushResult | null>;
  refreshOutbox: () => Promise<void>;
  /** Screens report whether the server answered, to keep `online` honest. */
  reportReachable: (reachable: boolean) => void;
  refreshData: () => void;
  signOut: () => Promise<void>;
}

const DriverContext = React.createContext<DriverContextValue | null>(null);

/** The outbox, or null where IndexedDB isn't available (private mode): the app still works online. */
async function readOutbox(): Promise<QueuedAction[] | null> {
  try {
    return await listOutbox();
  } catch {
    return null;
  }
}

function countPending(items: QueuedAction[]): number {
  return items.filter((item) => item.status === "pending").length;
}

/** A network, and the demo "no signal" switch off. */
function connected(): boolean {
  return navigator.onLine && !isSimulatedOffline();
}

function subscribeConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  const unsubscribeDemo = subscribeSimulatedOffline(callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
    unsubscribeDemo();
  };
}

function subscribeStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function DriverProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.has(pathname);

  // null while rendering on the server: the token lives in localStorage.
  const signedIn = React.useSyncExternalStore(
    subscribeStorage,
    () => Boolean(getToken()),
    () => null,
  );
  const browserOnline = React.useSyncExternalStore(subscribeConnectivity, connected, () => true);

  const [reachable, setReachable] = React.useState(true);
  const [outbox, setOutbox] = React.useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = React.useState(false);
  const [lastSync, setLastSync] = React.useState<LastSync | null>(null);
  const [dataVersion, setDataVersion] = React.useState(0);
  const pendingRef = React.useRef(0);
  const signingOutRef = React.useRef(false);

  React.useEffect(() => {
    if (isPublic) signingOutRef.current = false;
    if (!isPublic && signedIn === false && !signingOutRef.current) {
      router.replace(`/driver/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isPublic, signedIn, pathname, router]);

  const refreshOutbox = React.useCallback(async () => {
    const items = await readOutbox();
    if (items === null) return;
    pendingRef.current = countPending(items);
    setOutbox(items);
  }, []);

  const signOut = React.useCallback(async () => {
    signingOutRef.current = true;
    clearToken();
    try {
      await clearCachedData();
    } catch {
      // Nothing cached.
    }
    router.replace("/driver/login");
  }, [router]);

  const syncNow = React.useCallback(async (): Promise<FlushResult | null> => {
    if (!getToken()) return null;
    setSyncing(true);
    try {
      const result = await flushOutbox();
      setReachable(!result.offline);
      setLastSync({ at: new Date().toISOString(), result });
      if (result.sent + result.conflicts + result.failed > 0) setDataVersion((v) => v + 1);
      return result;
    } catch {
      return null;
    } finally {
      setSyncing(false);
      await refreshOutbox();
    }
  }, [refreshOutbox]);

  const perform = React.useCallback(
    async (input: NewAction) => {
      const action = await enqueue(input);
      await refreshOutbox();
      if (connected()) void syncNow();
      return action;
    },
    [refreshOutbox, syncNow],
  );

  const retryIfPending = React.useEffectEvent(() => {
    if (connected() && pendingRef.current > 0) void syncNow();
  });
  const syncOnReconnect = React.useEffectEvent(() => void syncNow());

  // First load, then retry whenever the connection comes back and every 30 s.
  React.useEffect(() => {
    if (isPublic || !signedIn) return;
    let cancelled = false;
    void readOutbox().then((items) => {
      if (cancelled || items === null) return;
      pendingRef.current = countPending(items);
      setOutbox(items);
      retryIfPending();
    });
    const onOnline = () => syncOnReconnect();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => retryIfPending(), AUTO_SYNC_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [isPublic, signedIn]);

  const value = React.useMemo<DriverContextValue>(
    () => ({
      online: browserOnline && reachable,
      outbox,
      pendingCount: outbox.filter((item) => item.status === "pending").length,
      conflictCount: outbox.filter((item) => item.status === "conflict").length,
      failedCount: outbox.filter((item) => item.status === "failed").length,
      syncing,
      lastSync,
      dataVersion,
      perform,
      syncNow,
      refreshOutbox,
      reportReachable: setReachable,
      refreshData: () => setDataVersion((v) => v + 1),
      signOut,
    }),
    [browserOnline, reachable, outbox, syncing, lastSync, dataVersion, perform, syncNow, refreshOutbox, signOut],
  );

  // Signed out pages wait for the redirect instead of flashing empty screens.
  if (!isPublic && !signedIn) return <div className="min-h-dvh bg-background" aria-busy="true" />;

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

export function useDriver(): DriverContextValue {
  const context = React.useContext(DriverContext);
  if (!context) throw new Error("useDriver must be used inside DriverProvider");
  return context;
}
