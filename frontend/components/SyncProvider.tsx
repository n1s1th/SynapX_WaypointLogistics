"use client";

import React, { createContext, useContext } from "react";
import { useSyncQueue } from "@/lib/useSyncQueue";
import type { PendingAction, QueueState } from "@/lib/syncQueue";
import { flush, enqueue, enqueueWithPhoto, dequeue, dismissFailed } from "@/lib/syncQueue";

// ─── Context ──────────────────────────────────────────────────────────────────

interface SyncContextValue {
  queue: PendingAction[];
  state: QueueState;
  online: boolean;
  lastError: string | null;
  pendingCount: number;
  failedCount: number;
  syncingCount: number;
  flush: typeof flush;
  enqueue: typeof enqueue;
  enqueueWithPhoto: typeof enqueueWithPhoto;
  dequeue: typeof dequeue;
  dismissFailed: typeof dismissFailed;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSyncContext must be used within SyncProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const sync = useSyncQueue();

  return (
    <SyncContext.Provider value={sync}>
      {children}
    </SyncContext.Provider>
  );
}
