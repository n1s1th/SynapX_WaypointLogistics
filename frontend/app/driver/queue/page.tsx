"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  WifiOff, MapPin, PackageCheck, PenTool, ShieldCheck, TriangleAlert, Map, Home, Layers,
  RefreshCw, CloudUpload, CircleCheck, AlertCircle, Trash2, KeyRound, ChevronRight, Flag,
} from "lucide-react";
import { toast } from "sonner";
import { useSyncContext } from "@/components/SyncProvider";
import StatusStrip from "@/components/driver/StatusStrip";
import SyncChip from "@/components/driver/SyncChip";
import { listCachedTrips, type CachedTripRow, type QueuedAction } from "@/lib/syncQueue";
import { localCompletion, withLocalState } from "@/lib/driverStop";
import { isOpenStatus } from "@/lib/driverSync/engine";
import type { DriverTripDetail } from "@/types/driver-map";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function actionIcon(type: string) {
  switch (type) {
    case "arrive":        return MapPin;
    case "deliver":       return PackageCheck;
    case "outcome":       return PackageCheck;
    case "pod":           return PenTool;
    case "complete_trip":
    case "complete":      return CircleCheck;
    case "issue":         return TriangleAlert;
    default:              return CloudUpload;
  }
}

function actionLabel(type: string) {
  switch (type) {
    case "arrive":        return "ARRIVAL";
    case "deliver":       return "DELIVERY & PROOF";
    case "outcome":       return "DELIVERY OUTCOME";
    case "pod":           return "PROOF OF DELIVERY";
    case "complete_trip":
    case "complete":      return "TRIP COMPLETE";
    case "issue":         return "ISSUE REPORT";
    default:              return type.toUpperCase();
  }
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_DOT: Record<string, string> = {
  delivered: "#18794E", partial: "#A85D00", failed: "#C9363E", rescheduled: "#7C3AED", arrived: "#2167D5", pending: "#D9E1E8",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SyncQueuePage() {
  const {
    queue, state, online, authBlocked, outstandingCount, failedCount, conflictCount, pendingCount,
    retryAll, retryRecord, dismissRecord,
  } = useSyncContext();
  const [trips, setTrips] = useState<CachedTripRow<DriverTripDetail>[]>([]);

  useEffect(() => {
    listCachedTrips<DriverTripDetail>().then(setTrips).catch(() => setTrips([]));
  }, [queue.length]);

  // Cached server copy + this phone's unconfirmed records
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tripViews = useMemo(() => trips.map((row) => ({ row, trip: withLocalState(row.data) })), [trips, queue]);

  const attention = queue.filter((a) => a.sync_status === "CONFLICT" || a.sync_status === "SYNC_FAILED");
  const waiting = queue.filter((a) => a.sync_status === "PENDING_SYNC" || a.sync_status === "SYNCING");
  const synced = queue.filter((a) => a.sync_status === "SYNCED");

  async function handleRetry() {
    const summary = await retryAll();
    if (!summary) {
      toast.error(authBlocked ? "Sign in again to sync." : "Couldn't reach the server. Your records are safe on this phone.");
    } else if (summary.stoppedBy === "network") {
      toast.error("Still no connection. Your records are safe on this phone.");
    } else if (summary.synced) {
      toast.success(`${summary.synced} record${summary.synced === 1 ? "" : "s"} synced`);
    }
  }

  async function handleRemove(a: QueuedAction) {
    try {
      await dismissRecord(a.action_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Can't remove this record yet.");
    }
  }

  function renderRecord(record: QueuedAction) {
    const Icon = actionIcon(record.action_type);
    const removable = record.sync_status === "SYNCED" || (record.sync_status === "SYNC_FAILED" && !record.retryable);
    return (
      <div
        key={record.action_id}
        className="flex flex-col p-[13px] gap-[10px] w-full bg-white rounded-xl"
        style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
      >
        <div className="flex items-center gap-[11px] w-full">
          <div className="flex justify-center items-center w-[38px] h-[38px] rounded-lg shrink-0" style={{ backgroundColor: "#F2F5F8" }}>
            <Icon size={19} color="#12202E" />
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>{actionLabel(record.action_type)}</span>
            <span className="font-bold text-[14px] truncate" style={{ color: "#12202E" }}>{record.label}</span>
            <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>
              Recorded {timeOf(record.client_timestamp)}
              {record.synced_at ? ` · synced ${timeOf(record.synced_at)}` : " · saved on this phone"}
              {record.photo_keys.length ? ` · ${record.photo_keys.length} photo${record.photo_keys.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <SyncChip status={record.sync_status} short />
        </div>

        {record.last_error && record.sync_status !== "SYNCED" && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ backgroundColor: record.sync_status === "PENDING_SYNC" ? "#F2F5F8" : "#FDECEF" }}>
            <AlertCircle size={14} color={record.sync_status === "PENDING_SYNC" ? "#5D6A78" : "#C9363E"} className="shrink-0 mt-px" />
            <span className="text-[12px] leading-[1.45em]" style={{ color: record.sync_status === "PENDING_SYNC" ? "#5D6A78" : "#C9363E" }}>
              {record.last_error}
            </span>
          </div>
        )}

        {(record.sync_status === "CONFLICT" || record.sync_status === "SYNC_FAILED" || removable) && (
          <div className="flex gap-2">
            {record.sync_status === "CONFLICT" && (
              <Link href={`/driver/queue/conflict?id=${record.action_id}`} className="flex-1">
                <span className="flex items-center justify-center gap-1.5 h-[38px] rounded-md text-[13px] font-semibold text-white" style={{ backgroundColor: "#092C4C" }}>
                  <Flag size={14} /> Review conflict
                </span>
              </Link>
            )}
            {record.sync_status === "SYNC_FAILED" && record.retryable && (
              <button
                onClick={() => retryRecord(record.action_id)}
                className="flex-1 flex items-center justify-center gap-1.5 h-[38px] rounded-md text-[13px] font-semibold bg-white"
                style={{ border: "1px solid #E5E5E2", color: "#171A1F" }}
              >
                <RefreshCw size={14} /> Retry now
              </button>
            )}
            {removable && (
              <button
                onClick={() => handleRemove(record)}
                className="flex items-center justify-center gap-1.5 h-[38px] px-3 rounded-md text-[13px] font-semibold"
                style={{ backgroundColor: "#FDECEF", color: "#C9363E" }}
                title="Remove from this phone"
              >
                <Trash2 size={14} /> {record.sync_status === "SYNCED" ? "Clear" : "Remove"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div className="flex flex-col w-full bg-white z-10" style={{ borderBottom: "1px solid #D9E1E8" }}>
        {/* Device status */}
        <StatusStrip />

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Offline Queue
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {outstandingCount === 0
                ? "Everything on this phone is synced"
                : `${pendingCount} waiting${failedCount ? ` · ${failedCount} failed` : ""}${conflictCount ? ` · ${conflictCount} conflict` : ""}`}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-[100px] gap-[15px]">

        {/* Status Banner */}
        {authBlocked && outstandingCount > 0 ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#FDECEF", border: "1px solid rgba(201, 54, 62, 0.21)" }}>
            <KeyRound size={18} color="#C9363E" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>Your session has expired</span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>
                Your records are kept on this phone. <Link href="/driver/login" className="underline font-bold">Sign in</Link> to sync them.
              </span>
            </div>
          </div>
        ) : !online ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
            <WifiOff size={18} color="#A85D00" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                No connection to Waypoint
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                Keep delivering — records and photos are saved on this phone and sync automatically.
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
        ) : outstandingCount === 0 ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#E8F6EF", border: "1px solid rgba(24, 121, 78, 0.21)" }}>
            <CircleCheck size={18} color="#18794E" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
                All synced!
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
                Dispatch has every record from this phone.
              </span>
            </div>
          </div>
        ) : null}

        {/* Trips saved on this phone */}
        {tripViews.length > 0 && (
          <div className="flex flex-col gap-[9px] w-full">
            <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Trips on this phone</span>
            {tripViews.map(({ row, trip }) => {
              const completion = localCompletion(trip.id);
              const done = trip.stops.filter((s) => !isOpenStatus(s.status)).length;
              return (
                <div key={trip.id} className="flex flex-col w-full bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #D9E1E8" }}>
                  <div className="flex justify-between items-center px-3.5 py-3" style={{ backgroundColor: "#F2F5F8" }}>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Trip R-{trip.id}</span>
                      <span className="text-[11px]" style={{ color: "#5D6A78" }}>
                        {done}/{trip.stops.length} stops · saved {timeOf(row.cached_at)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-bold text-[10px] uppercase" style={{ color: "#163A5F" }}>
                        {trip.status === "completed" ? "Completed" : completion ? "Completed on phone" : trip.status}
                      </span>
                      {trip.status !== "completed" && completion && <SyncChip status={completion.sync_status} short />}
                    </div>
                  </div>
                  {trip.stops.map((stop) => {
                    const open = isOpenStatus(stop.status) && trip.status === "started";
                    const content = (
                      <div className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderTop: "1px solid #EDF0F3" }}>
                        <div
                          className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[11px] font-bold"
                          style={{ backgroundColor: STATUS_DOT[stop.status] ?? "#D9E1E8", color: stop.status === "pending" ? "#5D6A78" : "#FFFFFF" }}
                        >
                          {stop.sequence}
                        </div>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-bold text-[13px] truncate" style={{ color: "#12202E" }}>{stop.customer_name}</span>
                          <span className="text-[11px] truncate" style={{ color: "#8793A0" }}>
                            {stop.order ? `${stop.order.order_number} · ${stop.order.units ?? "-"} units` : stop.address}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-[10px] font-bold uppercase" style={{ color: stop.status === "pending" ? "#5D6A78" : STATUS_DOT[stop.status] }}>
                            {stop.status}
                          </span>
                          <SyncChip status={stop.local_sync} short />
                        </div>
                        {open && <ChevronRight size={16} color="#8793A0" className="shrink-0" />}
                      </div>
                    );
                    // Any open stop can be worked, in any order
                    return open ? (
                      <Link key={stop.id} href={`/driver/trip/outcome?stop_id=${stop.id}`}>{content}</Link>
                    ) : (
                      <div key={stop.id}>{content}</div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Records */}
        {attention.length > 0 && (
          <div className="flex flex-col gap-[9px] w-full">
            <span className="font-bold text-[18px]" style={{ color: "#C9363E" }}>Needs attention</span>
            {attention.map(renderRecord)}
          </div>
        )}

        {waiting.length > 0 && (
          <div className="flex flex-col gap-[9px] w-full">
            <div className="flex justify-between items-center w-full">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Waiting to sync</span>
              <div className="flex items-center px-[9px] py-[5px] rounded-full" style={{ backgroundColor: "#FFF4D6" }}>
                <span className="font-bold text-[10px]" style={{ color: "#A85D00" }}>{waiting.length} on this phone</span>
              </div>
            </div>
            {waiting.map(renderRecord)}
          </div>
        )}

        {synced.length > 0 && (
          <div className="flex flex-col gap-[9px] w-full">
            <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Synced today</span>
            {synced.map(renderRecord)}
          </div>
        )}

        {/* Info footer */}
        <div className="flex items-center p-3 gap-[9px] w-full bg-white rounded-xl mt-1">
          <ShieldCheck size={18} color="#BDBDBD" className="shrink-0" />
          <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
            Records and photos stay on this phone until the server confirms them — even if you close the app or sign out.
          </span>
        </div>

        {/* Retry button */}
        {outstandingCount > 0 && (
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
            {outstandingCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center"
                style={{ backgroundColor: "#A85D00" }}
              >
                {outstandingCount > 9 ? "9+" : outstandingCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
