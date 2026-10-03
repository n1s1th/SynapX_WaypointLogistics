"use client";

/**
 * Always-visible connection & sync status for the driver app. Hidden only
 * when the phone is online and every record is confirmed by the server.
 */
import Link from "next/link";
import { CloudUpload, KeyRound, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { useSyncContext } from "@/components/SyncProvider";

export default function DriverSyncBar() {
  const { online, state, authBlocked, pendingCount, failedCount, conflictCount, outstandingCount } = useSyncContext();

  let tone: { bg: string; fg: string; border: string } | null = null;
  let Icon = WifiOff;
  let text = "";

  if (authBlocked && outstandingCount > 0) {
    tone = { bg: "#FDECEF", fg: "#C9363E", border: "rgba(201, 54, 62, 0.21)" };
    Icon = KeyRound;
    text = `Session expired · ${outstandingCount} record${outstandingCount === 1 ? "" : "s"} kept on this phone. Sign in to sync.`;
  } else if (!online) {
    tone = { bg: "#FFF4D6", fg: "#A85D00", border: "rgba(168, 93, 0, 0.21)" };
    Icon = WifiOff;
    text = outstandingCount > 0
      ? `Offline · ${outstandingCount} record${outstandingCount === 1 ? "" : "s"} saved on this phone`
      : "Offline · showing the last saved trip";
  } else if (conflictCount > 0) {
    tone = { bg: "#FDECEF", fg: "#C9363E", border: "rgba(201, 54, 62, 0.21)" };
    Icon = TriangleAlert;
    text = `${conflictCount} record${conflictCount === 1 ? "" : "s"} need dispatcher review`;
  } else if (failedCount > 0) {
    tone = { bg: "#FDECEF", fg: "#C9363E", border: "rgba(201, 54, 62, 0.21)" };
    Icon = TriangleAlert;
    text = `${failedCount} record${failedCount === 1 ? "" : "s"} could not sync`;
  } else if (pendingCount > 0 || state === "syncing") {
    tone = { bg: "#EAF2FF", fg: "#2167D5", border: "rgba(33, 103, 213, 0.25)" };
    Icon = state === "syncing" ? RefreshCw : CloudUpload;
    text = `Syncing ${pendingCount} record${pendingCount === 1 ? "" : "s"}…`;
  }

  if (!tone) return null;

  return (
    <Link
      href={authBlocked ? "/driver/login" : "/driver/queue"}
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[60] flex items-center gap-2 px-4 py-2"
      style={{ backgroundColor: tone.bg, borderBottom: `1px solid ${tone.border}`, fontFamily: "Inter, sans-serif" }}
    >
      <Icon size={15} color={tone.fg} className={`shrink-0 ${state === "syncing" && Icon === RefreshCw ? "animate-spin" : ""}`} />
      <span className="text-[12px] font-semibold flex-1 truncate" style={{ color: tone.fg }}>{text}</span>
      <span className="text-[11px] font-bold underline shrink-0" style={{ color: tone.fg }}>
        {authBlocked ? "Sign in" : "Queue"}
      </span>
    </Link>
  );
}
