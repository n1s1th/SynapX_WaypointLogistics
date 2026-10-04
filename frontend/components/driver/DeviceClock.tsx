"use client";

/** The status-bar clock on the driver screens: current Sri Lanka time. */
import { useSyncExternalStore, type CSSProperties } from "react";
import { colomboNow } from "@/lib/colomboTime";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}

/** "HH:MM" in Sri Lanka, kept current; "--:--" while the page is server-rendered. */
export function useColomboClock() {
  return useSyncExternalStore(subscribe, () => colomboNow().hhmm, () => "--:--");
}

export default function DeviceClock({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={className} style={style}>{useColomboClock()}</span>;
}
