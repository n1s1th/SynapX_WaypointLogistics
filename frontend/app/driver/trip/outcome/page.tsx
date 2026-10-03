"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PackageCheck, PackageMinus, PackageX, Ban, Check,
} from "lucide-react";
import { toast } from "sonner";
import { loadStop, type StopDetail } from "@/lib/driverStop";
import { saveRecord, LocalSaveError } from "@/lib/syncQueue";
import { isOpenStatus } from "@/lib/driverSync/engine";
import { useSyncContext } from "@/components/SyncProvider";
import StopDeliveryDetails from "@/components/driver/StopDeliveryDetails";
import StatusStrip from "@/components/driver/StatusStrip";
import SyncChip from "@/components/driver/SyncChip";

type Choice = "delivered" | "partial" | "refused" | "failed";

const OPTIONS: { value: Choice; title: string; hint: string; Icon: typeof PackageCheck }[] = [
  { value: "delivered", title: "Full delivery", hint: "All expected goods were accepted.", Icon: PackageCheck },
  { value: "partial", title: "Partial delivery", hint: "Some goods were not delivered.", Icon: PackageMinus },
  { value: "refused", title: "Refused by outlet", hint: "The outlet would not accept the goods.", Icon: Ban },
  { value: "failed", title: "Could not deliver", hint: "Closed, no access, or no one to receive.", Icon: PackageX },
];

const REASONS: Record<"refused" | "failed", string[]> = {
  refused: ["Damaged goods", "Wrong items", "Not ordered", "Arrived too late", "Other"],
  failed: ["Outlet closed", "No one to receive", "Access blocked", "Wrong address", "Other"],
};

function DeliveryOutcomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stop_id");
  const { online } = useSyncContext();

  const [selectedOutcome, setSelectedOutcome] = useState<Choice>("delivered");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!stopId) return;
    loadStop(stopId)
      .then(({ data, source }) => {
        setStop(data);
        setFromCache(source === "cache");
      })
      .catch(() => setStop(null))
      .finally(() => setLoading(false));
  }, [stopId]);

  const needsReason = selectedOutcome === "refused" || selectedOutcome === "failed";
  const alreadyRecorded = stop ? !isOpenStatus(stop.status) : false;

  async function handleContinue() {
    if (!stop) return;
    if (!needsReason) {
      router.push(`/driver/trip/proof?stop_id=${stop.id}&outcome=${selectedOutcome}`);
      return;
    }
    if (selectedOutcome === "failed" && !reason) {
      toast.error("Choose why the delivery failed");
      return;
    }

    setSubmitting(true);
    const detail = [reason !== "Other" ? reason : null, note.trim() || null].filter(Boolean).join(" — ");
    try {
      // Saved on the phone first (durable), then synced; no proof of delivery for a failed stop
      await saveRecord({
        action_type: "deliver",
        trip_id: stop.driver_trip_id,
        stop_id: stop.id,
        payload: { outcome: selectedOutcome, reason: detail },
        label: `${selectedOutcome === "refused" ? "Refused" : "Not delivered"} · ${stop.customer_name}`,
      });
      toast.success(`Stop ${stop.sequence} saved as ${selectedOutcome === "refused" ? "refused" : "not delivered"}`, {
        description: online ? "Syncing with dispatch." : "Saved on this phone — it will sync when signal returns.",
      });
      router.push("/driver/trip");
    } catch (err) {
      toast.error(err instanceof LocalSaveError ? err.message : "Couldn't save the outcome.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-hidden" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

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
              {loading ? "Loading..." : stop?.customer_name || "Unknown Stop"}
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em] truncate max-w-full" style={{ color: "#5D6A78" }}>
              {loading ? "..." : stop?.address}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Sheet */}
      <div
        className="flex flex-col flex-1 bg-white px-5 pb-5 pt-4 gap-[14px] z-20 relative overflow-y-auto"
        style={{ boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >
        {fromCache && (
          <div className="w-full p-3 rounded-xl text-[12px] shrink-0" style={{ backgroundColor: "#FFF4D6", color: "#A85D00" }}>
            Showing the order saved on this phone. Your record will sync when signal returns.
          </div>
        )}

        {/* What is being delivered here */}
        {loading ? (
          <div className="w-full h-[120px] rounded-xl animate-pulse shrink-0" style={{ backgroundColor: "#F2F5F8" }} />
        ) : stop ? (
          <StopDeliveryDetails stop={stop} />
        ) : (
          <div className="w-full p-3 rounded-xl text-[12px] shrink-0" style={{ backgroundColor: "#FFF4D6", color: "#A85D00" }}>
            This stop isn&apos;t saved on this phone. Open the trip once while online so its orders are available offline.
          </div>
        )}

        {stop && alreadyRecorded ? (
          /* Already recorded — locally or on the server — so it can't be recorded twice */
          <div className="flex flex-col gap-2 p-3.5 rounded-xl shrink-0" style={{ backgroundColor: "#E8F6EF" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[14px] capitalize" style={{ color: "#18794E" }}>
                Recorded as {stop.status}
              </span>
              <SyncChip status={stop.local_sync} short />
            </div>
            {stop.outcome_reason && <span className="text-[12px]" style={{ color: "#5D6A78" }}>{stop.outcome_reason}</span>}
            <Link href="/driver/trip" className="text-[13px] font-bold underline" style={{ color: "#092C4C" }}>Back to route</Link>
          </div>
        ) : stop ? (
          <>
            {/* Sheet heading */}
            <div className="flex flex-col gap-1 w-full shrink-0">
              <h2 className="font-bold text-[20px] leading-tight" style={{ color: "#12202E" }}>
                What happened at this stop?
              </h2>
              <p className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>
                {stop.local_sync === "SYNC_FAILED"
                  ? "The last record for this stop was not accepted — record it again."
                  : "Choose the outcome before adding proof of delivery."}
              </p>
            </div>

            {/* Outcome options */}
            <div className="flex flex-col gap-2 w-full shrink-0">
              {OPTIONS.map(({ value, title, hint, Icon }) => {
                const active = selectedOutcome === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setSelectedOutcome(value); setReason(null); }}
                    className="flex items-center w-full p-3 gap-[11px] rounded-xl text-left"
                    style={{
                      backgroundColor: active ? "#E8F6EF" : "#FFFFFF",
                      border: `2px solid ${active ? "#18794E" : "transparent"}`,
                      boxShadow: active ? "none" : "0px 5px 16px 0px rgba(22, 58, 95, 0.08)",
                      outline: active ? "none" : "1px solid #D9E1E8",
                    }}
                  >
                    <div className="flex justify-center items-center w-[34px] h-[34px] rounded-full shrink-0" style={{ backgroundColor: active ? "#18794E" : "#F2F5F8" }}>
                      <Icon size={18} color={active ? "#FFFFFF" : "#12202E"} />
                    </div>
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{title}</span>
                      <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>{hint}</span>
                    </div>
                    <div
                      className="flex justify-center items-center w-[22px] h-[22px] rounded-full shrink-0"
                      style={{ backgroundColor: active ? "#18794E" : "#FFFFFF", border: `2px solid ${active ? "#18794E" : "#D9E1E8"}` }}
                    >
                      {active && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Reason (refused / failed) */}
            {needsReason && (
              <div className="flex flex-col gap-2 w-full shrink-0">
                <span className="font-semibold text-[12px]" style={{ color: "#12202E" }}>
                  {selectedOutcome === "failed" ? "Why couldn't it be delivered?" : "Why was it refused? (optional)"}
                </span>
                <div className="flex flex-wrap gap-2">
                  {REASONS[selectedOutcome as "refused" | "failed"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className="px-3 py-2 rounded-full text-[12px] font-semibold"
                      style={reason === r
                        ? { backgroundColor: "#092C4C", color: "#FFFFFF" }
                        : { backgroundColor: "#F2F5F8", color: "#12202E", border: "1px solid #D9E1E8" }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for dispatch (optional)"
                  rows={2}
                  maxLength={200}
                  className="w-full p-3 rounded-md text-[13px] outline-none resize-none"
                  style={{ border: "1px solid #E5E5E2", color: "#12202E" }}
                />
              </div>
            )}

            {/* Primary Action Button */}
            <div className="mt-auto pt-2 shrink-0">
              <button
                onClick={handleContinue}
                disabled={submitting}
                className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
                style={{ backgroundColor: "#092C4C" }}
              >
                {submitting ? "Saving..." : needsReason ? "Save outcome" : "Continue to proof of delivery"}
              </button>
            </div>
          </>
        ) : null}
      </div>

    </div>
  );
}

export default function DeliveryOutcomePage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <DeliveryOutcomeContent />
    </React.Suspense>
  );
}
