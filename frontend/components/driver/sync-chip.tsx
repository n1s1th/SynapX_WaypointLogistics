"use client";

// Connection and sync state for the header. Colour is always paired with an
// icon and words (frontend/AGENTS.md: never status by colour alone).

import Link from "next/link";
import { CloudCheck, CloudOff, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDriver } from "./driver-provider";

export function SyncChip() {
  const { online, syncing, pendingCount, conflictCount, failedCount } = useDriver();

  let tone: string;
  let Icon = CloudCheck;
  let label: string;
  if (conflictCount + failedCount > 0) {
    tone = "bg-destructive-muted text-destructive";
    Icon = TriangleAlert;
    label = `${conflictCount + failedCount} need${conflictCount + failedCount === 1 ? "s" : ""} attention`;
  } else if (!online) {
    tone = "bg-warning-muted text-warning";
    Icon = CloudOff;
    label = pendingCount ? `Offline · ${pendingCount} saved on phone` : "Offline · saved on phone";
  } else if (syncing) {
    tone = "bg-info-muted text-info";
    Icon = RefreshCw;
    label = "Syncing…";
  } else if (pendingCount > 0) {
    tone = "bg-warning-muted text-warning";
    Icon = CloudUpload;
    label = `${pendingCount} waiting to sync`;
  } else {
    tone = "bg-success-muted text-success";
    label = "Synced";
  }

  return (
    <Link
      href="/driver/queue"
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        tone,
      )}
      aria-live="polite"
    >
      <Icon className={cn("size-3.5", Icon === RefreshCw && "animate-spin")} aria-hidden />
      {label}
    </Link>
  );
}
