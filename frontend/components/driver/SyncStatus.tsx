"use client";

/** The status-bar sync word on the driver screens: what the offline queue is doing. */
import type { CSSProperties } from "react";
import { useSyncContext } from "@/components/SyncProvider";

export default function SyncStatus({ className, style }: { className?: string; style?: CSSProperties }) {
  const { online, pendingCount } = useSyncContext();
  const label = online
    ? pendingCount > 0 ? `Syncing ${pendingCount}` : "Synced"
    : pendingCount > 0 ? `Offline · ${pendingCount} saved` : "Offline";
  return <span className={className} style={style}>{label}</span>;
}
