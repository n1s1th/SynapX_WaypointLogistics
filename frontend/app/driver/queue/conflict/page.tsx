"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  TriangleAlert, Smartphone, Cloud, Map, Home, Layers, RefreshCw, CircleCheck, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useSyncContext } from "@/components/SyncProvider";
import StatusStrip from "@/components/driver/StatusStrip";
import type { QueuedAction } from "@/lib/syncQueue";

const CODE_TITLE: Record<string, string> = {
  STOP_REMOVED: "Stop removed before your record synced",
  STOP_MOVED: "Stop moved to another trip",
  TRIP_REASSIGNED: "Trip reassigned to another driver",
  STOP_ALREADY_RESOLVED: "Stop already recorded on the server",
  TRIP_ALREADY_COMPLETED: "Trip was already completed",
};

function timeOf(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
}

function describeRecord(a: QueuedAction): { title: string; detail: string } {
  const p = a.payload as Record<string, unknown>;
  const outcome = String(p.outcome ?? "");
  const items = p.delivered_items as Record<string, number> | undefined;
  const photos = a.photo_keys.length;
  if (a.action_type === "deliver") {
    const title =
      outcome === "partial" ? `Partial delivery at ${timeOf(a.client_timestamp)}`
      : outcome === "refused" ? `Refused at ${timeOf(a.client_timestamp)}`
      : outcome === "failed" ? `Not delivered at ${timeOf(a.client_timestamp)}`
      : `Delivery completed at ${timeOf(a.client_timestamp)}`;
    const parts = [
      p.recipient_name ? `Received by ${p.recipient_name}` : null,
      p.signature_data ? "signature" : null,
      photos ? `${photos} photo${photos === 1 ? "" : "s"}` : null,
      items ? `${Object.values(items).reduce((s, n) => s + n, 0)} units` : null,
      p.reason ? String(p.reason) : null,
    ].filter(Boolean);
    return { title, detail: parts.join(" · ") || "Recorded on this phone." };
  }
  return { title: `${a.label} at ${timeOf(a.client_timestamp)}`, detail: "Recorded on this phone." };
}

function ConflictCard({ record }: { record: QueuedAction }) {
  const { recheckConflict, dismissRecord } = useSyncContext();
  const [checking, setChecking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const mine = describeRecord(record);
  const reviewed = Boolean(record.server?.reviewed);
  const code = record.server?.code ?? record.error_code ?? "";
  const serverStatus = (record.server?.server_state as { status?: string } | null)?.status;

  async function check() {
    setChecking(true);
    try {
      const updated = await recheckConflict(record.action_id);
      toast[updated?.server?.reviewed ? "success" : "info"](
        updated?.server?.reviewed ? "Dispatch has reviewed this conflict" : "Still waiting for dispatcher review",
      );
    } catch {
      toast.error("Couldn't reach the server. Your record is still safe on this phone.");
    } finally {
      setChecking(false);
    }
  }

  async function remove() {
    try {
      await dismissRecord(record.action_id);
      toast.success("Removed from this phone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Can't remove this record yet.");
    }
  }

  return (
    <div className="flex flex-col gap-[15px] w-full">
      {/* Banner */}
      <div
        className="flex p-3 gap-2.5 rounded-xl w-full"
        style={{ backgroundColor: "#FDECEF", border: "1px solid rgba(201, 54, 62, 0.21)" }}
      >
        <TriangleAlert size={18} color="#C9363E" className="shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>
            Sync conflict — {record.label.split("·").pop()?.trim()}
          </span>
          <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>
            The plan changed while you were offline
          </span>
        </div>
      </div>

      {/* Card: Offline Record */}
      <div
        className="flex flex-col p-[15px] gap-[10px] w-full rounded-xl"
        style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
      >
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <Smartphone size={18} color="#2167D5" />
            <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>YOUR RECORD · ON THIS PHONE</span>
          </div>
          <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>{timeOf(record.client_timestamp)}</span>
        </div>
        <h3 className="font-bold text-[18px]" style={{ color: "#12202E" }}>{mine.title}</h3>
        <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>{mine.detail}</p>
      </div>

      {/* Conflict divider */}
      <div className="flex items-center gap-[10px] w-full">
        <div className="flex-1 h-[1px]" style={{ backgroundColor: "#D9E1E8" }}></div>
        <div className="px-[10px] py-[5px] rounded-full" style={{ backgroundColor: "#F2F5F8", border: "1px solid #D9E1E8" }}>
          <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>VERSUS</span>
        </div>
        <div className="flex-1 h-[1px]" style={{ backgroundColor: "#D9E1E8" }}></div>
      </div>

      {/* Card: Current Plan */}
      <div
        className="flex flex-col p-[15px] gap-[10px] w-full rounded-xl"
        style={{ backgroundColor: "#FDECEF", border: "2px solid #C9363E" }}
      >
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <Cloud size={18} color="#C9363E" />
            <span className="font-bold text-[10px]" style={{ color: "#C9363E" }}>CURRENT PLAN · SERVER</span>
          </div>
          <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>{timeOf(record.server?.received_at)}</span>
        </div>
        <h3 className="font-bold text-[18px]" style={{ color: "#12202E" }}>{CODE_TITLE[code] ?? "The plan changed"}</h3>
        <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
          {record.server?.message ?? record.last_error}
          {serverStatus ? ` Server status: ${serverStatus}.` : ""}
        </p>
      </div>

      {/* Review state — resolution is the dispatcher's call, never automatic */}
      {reviewed ? (
        <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#E8F6EF", border: "1px solid rgba(24, 121, 78, 0.21)" }}>
          <CircleCheck size={18} color="#18794E" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>Reviewed by dispatch</span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
              {record.server?.review_note || "No note added."} You can now remove this record from your phone.
            </span>
          </div>
        </div>
      ) : (
        <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
          Dispatch has been sent your record (without the signature or photos). Nothing is overwritten or deleted —
          your proof stays on this phone until a dispatcher reviews it.
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col w-full gap-[9px]">
        {!reviewed && (
          <button
            onClick={check}
            disabled={checking}
            className="w-full flex justify-center items-center gap-2 h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
            style={{ backgroundColor: "#092C4C" }}
          >
            <RefreshCw size={18} className={checking ? "animate-spin" : ""} />
            {checking ? "Checking…" : "Check review status"}
          </button>
        )}
        {reviewed && !confirmRemove && (
          <button
            onClick={() => setConfirmRemove(true)}
            className="w-full flex justify-center items-center gap-2 h-[40px] rounded-md font-semibold text-[13px] bg-white"
            style={{ border: "1px solid #E5E5E2", color: "#171A1F" }}
          >
            <Trash2 size={15} /> Remove from this phone
          </button>
        )}
        {confirmRemove && (
          <div className="flex flex-col gap-2 p-3 rounded-xl" style={{ backgroundColor: "#FDECEF" }}>
            <span className="text-[12px]" style={{ color: "#C9363E" }}>
              This deletes the signature and photos on this phone. Dispatch has already reviewed it.
            </span>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRemove(false)} className="flex-1 h-[38px] rounded-md text-[13px] font-semibold bg-white" style={{ border: "1px solid #E5E5E2" }}>
                Keep
              </button>
              <button onClick={remove} className="flex-1 h-[38px] rounded-md text-[13px] font-semibold text-white" style={{ backgroundColor: "#C9363E" }}>
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SyncConflictContent() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("id");
  const { queue } = useSyncContext();
  const conflicts = queue.filter((a) => a.sync_status === "CONFLICT" && (!focusId || a.action_id === focusId));

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <StatusStrip />

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Sync Queue
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {conflicts.length === 0 ? "No conflicts" : `${conflicts.length} record${conflicts.length === 1 ? "" : "s"} need${conflicts.length === 1 ? "s" : ""} attention`}
            </p>
          </div>
        </div>
      </div>

      {/* Conflict Content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-[100px] gap-[24px]">
        {conflicts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-white text-center" style={{ border: "1px solid #D9E1E8" }}>
            <CircleCheck size={28} color="#18794E" />
            <span className="text-[14px] font-bold" style={{ color: "#12202E" }}>No conflicts on this phone</span>
            <Link href="/driver/queue" className="text-[13px] font-bold underline" style={{ color: "#092C4C" }}>Back to queue</Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-[5px] w-full">
              <h2 className="font-bold text-[24px] leading-[1.25em]" style={{ color: "#12202E" }}>
                Waiting for dispatcher review
              </h2>
              <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
                Your offline record and the dispatch plan disagree. Nothing will be removed or overwritten automatically.
              </p>
            </div>
            {conflicts.map((c) => <ConflictCard key={c.action_id} record={c} />)}
          </>
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
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#163A5F" />
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}

export default function SyncConflictPage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <SyncConflictContent />
    </React.Suspense>
  );
}
