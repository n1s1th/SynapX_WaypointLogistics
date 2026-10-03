"use client";

import React, { createContext, useContext } from "react";
import { useSyncQueue } from "@/lib/useSyncQueue";

// ─── Context ──────────────────────────────────────────────────────────────────

type SyncContextValue = ReturnType<typeof useSyncQueue>;

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
