"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Signal, BatteryFull, Wifi, WifiOff, MapPin, PackageCheck,
  PenTool, ShieldCheck, TriangleAlert, Map, Home, Layers,
  RefreshCw, CloudUpload, CircleCheck, AlertCircle, Trash2
} from "lucide-react";
import { useSyncContext } from "@/components/SyncProvider";
import type { PendingAction } from "@/lib/syncQueue";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function actionIcon(type: string) {
  switch (type) {
    case "arrive":   return MapPin;
    case "outcome":  return PackageCheck;
    case "pod":      return PenTool;
    case "complete": return CircleCheck;
    case "issue":    return TriangleAlert;
    default:         return CloudUpload;
  }
}

function actionLabel(type: string) {
  switch (type) {
    case "arrive":   return "ARRIVAL";
    case "outcome":  return "DELIVERY OUTCOME";
    case "pod":      return "PROOF OF DELIVERY";
    case "complete": return "TRIP COMPLETE";
    case "issue":    return "ISSUE REPORT";
    default:         return type.toUpperCase();
  }
}

function statusColors(status: PendingAction["status"]) {
  switch (status) {
    case "pending":  return { bg: "#FFF4D6", text: "#A85D00", label: "Pending"  };
    case "syncing":  return { bg: "#EAF2FF", text: "#2167D5", label: "Uploading" };
    case "failed":   return { bg: "#FFEBEB", text: "#D32F2F", label: "Failed"   };
  }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SyncQueuePage() {
  const router = useRouter();
  const { queue, state, online, pendingCount, failedCount, flush, dismissFailed } = useSyncContext();

  const totalCount = queue.length;

  async function handleRetry() {
    if (!online) return;
    await flush();
    if (queue.length === 0) router.push("/driver/queue/sync");
    else router.push("/driver/queue/sync");
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div className="flex flex-col w-full bg-white z-10" style={{ borderBottom: "1px solid #D9E1E8" }}>
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <span className="text-[12px] font-semibold" style={{ color: "#12202E" }}>
            {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: online ? "#18794E" : "#BDBDBD" }}>
              {online ? "Online" : "Offline"}
            </span>
            {online
              ? <Wifi size={16} color="#18794E" />
              : <WifiOff size={16} color="#BDBDBD" />}
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Sync Queue
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {totalCount === 0
                ? "All records synced"
                : `${pendingCount} pending${failedCount > 0 ? ` · ${failedCount} failed` : ""}`}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-[100px] gap-[15px]">

        {/* Status Banner */}
        {!online ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
            <WifiOff size={18} color="#A85D00" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                No internet connection
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                Records saved on this device. Will sync automatically when online.
              </span>
            </div>
          </div>
        ) : state === "syncing" ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#EAF2FF", border: "1px solid rgba(33, 103, 213, 0.25)" }}>
            <RefreshCw size={18} color="#2167D5" className="shrink-0 mt-0.5 animate-spin" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>
                Syncing records…
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>
                Uploading securely in the background.
              </span>
            </div>
          </div>
        ) : totalCount === 0 ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#E8F6EF", border: "1px solid rgba(24, 121, 78, 0.21)" }}>
            <CircleCheck size={18} color="#18794E" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
                All synced!
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
                No pending records. You&apos;re up to date.
              </span>
            </div>
          </div>
        ) : null}

        {/* Failed actions warning */}
        {failedCount > 0 && (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#FFEBEB", border: "1px solid rgba(211, 47, 47, 0.25)" }}>
            <AlertCircle size={18} color="#D32F2F" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#D32F2F" }}>
                {failedCount} record{failedCount > 1 ? "s" : ""} could not sync
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#D32F2F" }}>
                A conflict was detected. Review and dismiss below.
              </span>
            </div>
          </div>
        )}

        {/* Queue list */}
        {totalCount > 0 && (
          <>
            <div className="flex justify-between items-center w-full">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Pending records</span>
              <div className="flex items-center px-[9px] py-[5px] rounded-full" style={{ backgroundColor: "#FFF4D6" }}>
                <span className="font-bold text-[10px]" style={{ color: "#A85D00" }}>{totalCount} total</span>
              </div>
            </div>

            <div className="flex flex-col gap-[9px] w-full">
              {queue.map((record) => {
                const Icon = actionIcon(record.action_type);
                const colors = statusColors(record.status);
                return (
                  <div
                    key={record.action_id}
                    className="flex flex-col p-[13px] gap-[10px] w-full bg-white rounded-xl"
                    style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
                  >
                    <div className="flex items-center gap-[11px] w-full">
                      <div
                        className="flex justify-center items-center w-[38px] h-[38px] rounded-lg shrink-0"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Icon size={19} color="#12202E" />
                      </div>
                      <div className="flex flex-col gap-0.5 w-full">
                        <span className="font-bold text-[10px]" style={{ color: colors.text }}>
                          {actionLabel(record.action_type)}
                        </span>
                        <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>
                          {record.label}
                        </span>
                        <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>
                          {timeAgo(record.client_timestamp)} · Saved on device
                        </span>
                      </div>
                      {record.status === "failed" ? (
                        <button
                          onClick={() => dismissFailed(record.action_id)}
                          className="shrink-0 p-1.5 rounded-full"
                          style={{ backgroundColor: "#FFEBEB" }}
                          title="Dismiss"
                        >
                          <Trash2 size={14} color="#D32F2F" />
                        </button>
                      ) : (
                        <div
                          className="flex items-center px-[9px] py-[5px] rounded-full shrink-0"
                          style={{ backgroundColor: colors.bg }}
                        >
                          <span className="font-medium text-[10px]" style={{ color: colors.text }}>
                            {colors.label}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Info footer */}
        <div className="flex items-center p-3 gap-[9px] w-full bg-white rounded-xl mt-1">
          <ShieldCheck size={18} color="#BDBDBD" className="shrink-0" />
          <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
            Records are stored in your browser&apos;s IndexedDB and sync automatically when you come back online.
          </span>
        </div>

        {/* Retry button */}
        {pendingCount > 0 && online && (
          <button
            onClick={handleRetry}
            disabled={state === "syncing"}
            className="w-full flex justify-center items-center gap-2 h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50 mt-1"
            style={{ backgroundColor: "#092C4C" }}
          >
            {state === "syncing"
              ? <><RefreshCw size={18} className="animate-spin" /> Syncing…</>
              : "Retry sync"}
          </button>
        )}
      </div>

      {/* Bottom Nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white z-50"
        style={{ borderTop: "1px solid #D9E1E8", boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >
        <Link href="/driver" className="flex flex-col items-center gap-1 w-[72px]">
          <Home size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Home</span>
        </Link>
        <Link href="/driver/trip" className="flex flex-col items-center gap-1 w-[72px]">
          <Map size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Map</span>
        </Link>
        <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
          <TriangleAlert size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px] relative">
          <div className="relative">
            <Layers size={22} color="#163A5F" />
            {pendingCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center"
                style={{ backgroundColor: "#A85D00" }}
              >
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
