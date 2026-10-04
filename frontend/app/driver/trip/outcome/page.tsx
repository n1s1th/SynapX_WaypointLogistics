"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Signal, BatteryFull, PackageCheck, PackageMinus, TriangleAlert, Check, ChevronLeft,
  Map as MapIcon, Home, Layers
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";
import { fetchStopDetail, updateCachedStop, type StopDetail } from "@/lib/driverStop";
import { useSyncContext } from "@/components/SyncProvider";
import StopDeliveryDetails from "@/components/driver/StopDeliveryDetails";
import DeviceClock from "@/components/driver/DeviceClock";

const OUTCOME_OPTIONS = [
  { value: "full", title: "Full delivery", hint: "All expected goods were accepted.", Icon: PackageCheck },
  { value: "partial", title: "Partial delivery", hint: "Some goods were not delivered.", Icon: PackageMinus },
  { value: "issue", title: "Delivery issue", hint: "Delivery could not be completed.", Icon: TriangleAlert },
];

function DeliveryOutcomeContent() {
  const router = useRouter();
  const { enqueue } = useSyncContext();
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stop_id");

  const [selectedOutcome, setSelectedOutcome] = useState("full");
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!stopId) return;
    fetchStopDetail(stopId)
      .then((detail) => {
        // POD already captured (e.g. driver pressed back) — nothing left to do here
        if (detail.pod) {
          router.replace("/driver/trip");
          return;
        }
        setStop(detail);
        if (detail.status === "partial") setSelectedOutcome("partial");
        if (detail.status === "failed") setSelectedOutcome("issue");
      })
      .catch((error) => console.error("Failed to fetch stop data:", error))
      .finally(() => setLoading(false));
  }, [stopId, router]);

  async function handleContinue() {
    if (!stopId) return;
    setSubmitting(true);

    let backendOutcome = "delivered";
    if (selectedOutcome === "partial") backendOutcome = "partial";
    if (selectedOutcome === "issue") backendOutcome = "failed";

    // A failed stop has no proof of delivery — the driver reports why instead
    const next = backendOutcome === "failed"
      ? `/driver/report?stop_id=${stopId}`
      : `/driver/trip/proof?stop_id=${stopId}`;

    try {
      await apiFetch(`/driver/stops/${stopId}/outcome`, {
        method: "PATCH",
        body: JSON.stringify({ outcome: backendOutcome })
      });
      router.push(next);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) {
        // No signal: keep the outcome on the phone and carry on; it syncs before the proof
        await enqueue({
          action_type: "outcome",
          stop_id: Number(stopId),
          payload: { outcome: backendOutcome },
          label: `Outcome · ${stop?.customer_name ?? "stop"}`,
        });
        updateCachedStop(stopId, { status: backendOutcome as StopDetail["status"] });
        toast.success("Saved on this device", { description: "It will sync when signal returns." });
        router.push(next);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Couldn't save the outcome");
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
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>Online</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-2 py-1 items-center gap-1 w-full">
          <button
            type="button"
            onClick={() => router.push("/driver/trip")}
            disabled={submitting}
            aria-label="Back to map"
            className="flex items-center justify-center w-11 h-11 shrink-0 disabled:opacity-50"
          >
            <ChevronLeft size={22} color="#12202E" />
          </button>
          <div className="flex flex-col gap-0.5 min-w-0">
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

        {/* What is being delivered here */}
        {loading ? (
          <div className="w-full h-[120px] rounded-xl animate-pulse shrink-0" style={{ backgroundColor: "#F2F5F8" }} />
        ) : stop ? (
          <StopDeliveryDetails stop={stop} />
        ) : (
          <div className="w-full p-3 rounded-xl text-[12px] shrink-0" style={{ backgroundColor: "#FFF4D6", color: "#A85D00" }}>
            Couldn&apos;t load this stop&apos;s delivery details.
          </div>
        )}

        {/* Outcome options */}
        <div className="flex flex-col gap-1 shrink-0">
          <h2 className="font-bold text-[16px]" style={{ color: "#12202E" }}>What happened at this stop?</h2>
          <p className="text-[12px]" style={{ color: "#5D6A78" }}>Choose the outcome before adding proof of delivery.</p>
        </div>
        <div className="flex flex-col gap-2 w-full shrink-0" role="radiogroup" aria-label="Delivery outcome">
          {OUTCOME_OPTIONS.map(({ value, title, hint, Icon }) => {
            const selected = selectedOutcome === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedOutcome(value)}
                className="flex items-center w-full min-h-[58px] p-3 gap-[11px] rounded-xl text-left"
                style={{
                  backgroundColor: selected ? "#E8F6EF" : "#FFFFFF",
                  border: `2px solid ${selected ? "#18794E" : "transparent"}`,
                  boxShadow: selected ? "none" : "0px 5px 16px 0px rgba(22, 58, 95, 0.08)",
                  outline: selected ? "none" : "1px solid #D9E1E8",
                }}
              >
                <div className="flex justify-center items-center w-[34px] h-[34px] rounded-full shrink-0" style={{ backgroundColor: selected ? "#18794E" : "#F2F5F8" }}>
                  <Icon size={18} color={selected ? "#FFFFFF" : "#12202E"} />
                </div>
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{title}</span>
                  <span className="text-[12px]" style={{ color: "#5D6A78" }}>{hint}</span>
                </div>
                <div
                  className="flex justify-center items-center w-[22px] h-[22px] rounded-full shrink-0"
                  style={{ backgroundColor: selected ? "#18794E" : "#FFFFFF", border: `2px solid ${selected ? "#18794E" : "#D9E1E8"}` }}
                >
                  {selected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Primary Action Button */}
        <div className="mt-auto pt-2 shrink-0">
          <button
            onClick={handleContinue}
            disabled={submitting || loading || !stop}
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
            style={{ backgroundColor: "#092C4C" }}
          >
            {submitting ? "Saving..." : selectedOutcome === "issue" ? "Continue to report the issue" : "Continue to proof of delivery"}
          </button>
        </div>
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
