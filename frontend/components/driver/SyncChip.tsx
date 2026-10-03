"use client";

/** Small pill showing a record's sync state, separate from its delivery status. */
import { SYNC_LABEL } from "@/lib/driverStop";

export default function SyncChip({ status, short = false }: { status: string | null | undefined; short?: boolean }) {
  if (!status) return null;
  const cfg = SYNC_LABEL[status];
  if (!cfg) return null;
  const text = short
    ? { PENDING_SYNC: "Not synced", SYNCING: "Uploading", SYNCED: "Synced", SYNC_FAILED: "Sync failed", CONFLICT: "Conflict" }[status] ?? cfg.label
    : cfg.label;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[10px] whitespace-nowrap"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {text}
    </span>
  );
}
