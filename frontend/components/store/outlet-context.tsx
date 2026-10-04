"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StoreManager, StoreOutlet } from "@/components/store/mock-data";

// The signed-in manager and their outlet, loaded once by the store layout and shared with the shell and
// client screens.
const StoreSessionContext = createContext<{ outlet: StoreOutlet | null; manager: StoreManager | null }>({
  outlet: null,
  manager: null,
});

export function StoreOutletProvider({
  outlet,
  manager,
  children,
}: {
  outlet: StoreOutlet | null;
  manager: StoreManager | null;
  children: ReactNode;
}) {
  return <StoreSessionContext.Provider value={{ outlet, manager }}>{children}</StoreSessionContext.Provider>;
}

/** null when the outlet couldn't be loaded (e.g. the server is unreachable). */
export function useStoreOutlet() {
  return useContext(StoreSessionContext).outlet;
}

/** The signed-in store manager; null when it couldn't be loaded. */
export function useStoreManager() {
  return useContext(StoreSessionContext).manager;
}
