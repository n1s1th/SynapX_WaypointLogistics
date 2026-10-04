"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Signal, BatteryFull, MapPinCheck, LocateFixed,
  Map as MapIcon, Home, TriangleAlert, Layers
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { fetchStopDetail, parseWindow, updateCachedStop, type StopDetail } from "@/lib/driverStop";
import { useSyncContext } from "@/components/SyncProvider";
import DeviceClock from "@/components/driver/DeviceClock";

function ArrivalContent() {
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stop_id");

  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { enqueue } = useSyncContext();
  const deliveryWindow = parseWindow(stop?.order?.delivery_window);

  useEffect(() => {
    if (!stopId) return;
    // A screen left (or set up twice in development) must not queue the arrival again
    let cancelled = false;

    async function loadDataAndArrive() {
      let loaded: StopDetail | null = null;
      try {
        // Step 1: Load stop details for display (the phone's copy when there's no signal)
        loaded = await fetchStopDetail(stopId!);
        setStop(loaded);
      } catch (error) {
        console.error("Failed to load stop details:", error);
      }

      // Step 2: Mark arrival — idempotent on backend (safe to call even if already arrived)
      try {
        await apiFetch(`/driver/stops/${stopId}/arrive`, { method: "PATCH" });
      } catch (error) {
        // No signal: keep the arrival time on the phone; it syncs when signal returns
        if (cancelled) return;
        if (error instanceof ApiError && error.isNetworkError && loaded?.status === "pending") {
          await enqueue({
            action_type: "arrive",
            stop_id: Number(stopId),
            payload: {},
            label: `Arrived · ${loaded.customer_name}`,
          });
          updateCachedStop(stopId!, { status: "arrived" });
        } else {
          console.warn("Arrive call skipped (stop may already be arrived):", error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDataAndArrive();
    return () => {
      cancelled = true;
    };
  }, [stopId, enqueue]);


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

      {/* Toast Area */}
      <div className="w-full px-[15px] py-[10px] z-10" style={{ backgroundColor: "#F2F5F8" }}>
        <div 
          className="flex flex-col p-4 w-full bg-white rounded-lg"
          style={{ border: "1px solid #E5E5E2", height: "76px" }}
        >
          <span className="font-semibold text-[13px]" style={{ color: "#18385F" }}>Arrival detected</span>
          <span className="font-normal text-[12px] mt-1" style={{ color: "#6B7280" }}>
            Timestamp and location captured automatically.
          </span>
        </div>
      </div>

      {/* Arrival Map */}
      <div className="relative w-full overflow-hidden shrink-0 z-0" style={{ height: "142px", backgroundColor: "#F2F5F8" }}>
        {/* Map placeholder */}
        <div className="absolute inset-0">
          <div className="absolute left-[38px] top-[-30px] w-[26.57px] h-[202px] bg-white" />
          <div className="absolute left-[118px] top-[-30px] w-[26.57px] h-[202px] bg-white" />
          <div className="absolute left-[198px] top-[-30px] w-[26.57px] h-[202px] bg-white" />
          <div className="absolute left-[278px] top-[-30px] w-[26.57px] h-[202px] bg-white" />
          <div className="absolute left-[348px] top-[-30px] w-[26.57px] h-[202px] bg-white" />
          
          <div className="absolute left-0 top-[26px] w-full h-[10px] bg-white" />
          <div className="absolute left-0 top-[92px] w-full h-[10px] bg-white" />
          <div className="absolute left-0 top-[103px] w-full h-[64px] bg-white" />
          
          <div className="absolute left-[260px] top-0 w-[130px] h-full" style={{ backgroundColor: "#DCEAF4" }} />
          
          <svg className="absolute left-[22px] top-[30px] w-[320px] h-[230px]" style={{ pointerEvents: "none" }}>
            <path d="M21,188 L152,98 L248,46 L306,12" stroke="#2167D5" strokeWidth="5" strokeDasharray="10,7" fill="none" />
          </svg>

          {/* Map Dimmer */}
          <div className="absolute inset-0" style={{ backgroundColor: "rgba(11, 39, 67, 0.6)" }} />

          {/* Current location & Pins (scaled/positioned for small map) */}
          <div className="absolute left-[111px] top-[182px] w-[18px] h-[18px] rounded-full border-4 border-white z-10" style={{ backgroundColor: "#2167D5" }} />
          <div className="absolute left-[43px] top-[218px] w-[30px] h-[30px] flex justify-center items-center rounded-full border-[3px] border-white shadow-sm z-10" style={{ backgroundColor: "#18794E" }}>
            <span className="text-[12px] font-bold text-white">✓</span>
          </div>
          <div className="absolute left-[174px] top-[128px] w-[30px] h-[30px] flex justify-center items-center rounded-full border-[3px] border-white shadow-sm z-10" style={{ backgroundColor: "#163A5F" }}>
            <span className="text-[12px] font-bold text-white">{stop?.sequence || ""}</span>
          </div>
        </div>
      </div>

      {/* Bottom Sheet */}
      <div 
        className="flex flex-col flex-1 bg-white px-5 pb-5 pt-2.5 gap-[14px] z-20 relative"
        style={{ boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)", marginTop: "-20px" }}
      >
        {/* Drag Handle */}
        <div className="w-full flex justify-center pb-2">
          <div className="w-[40px] h-[4px] rounded-full" style={{ backgroundColor: "#D9E1E8" }} />
        </div>

        {/* Arrival Heading */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex justify-center items-center w-[44px] h-[44px] rounded-full shrink-0" style={{ backgroundColor: "#E8F6EF" }}>
            <MapPinCheck size={22} color="#18794E" />
          </div>
          <div className="flex flex-col gap-0.5 w-full">
            <h2 className="font-bold text-[24px]" style={{ color: "#12202E" }}>You’ve arrived</h2>
            <p className="font-normal text-[12px] truncate" style={{ color: "#5D6A78" }}>{stop?.address}</p>
          </div>
        </div>

        {/* Arrival Times */}
        <div className="flex w-full gap-2.5">
          <div className="flex-1 flex flex-col p-3.5 rounded-xl gap-1" style={{ backgroundColor: "#F2F5F8" }}>
            <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>
              {deliveryWindow.close ? `WINDOW · FROM ${deliveryWindow.open}` : "EXPECTED"}
            </span>
            <span className="font-bold text-[22px]" style={{ color: "#12202E" }}>
              {deliveryWindow.close ? `by ${deliveryWindow.close}` : "--:--"}
            </span>
          </div>
          <div className="flex-1 flex flex-col p-3.5 rounded-xl gap-1" style={{ backgroundColor: "#E8F6EF" }}>
            <span className="font-bold text-[10px]" style={{ color: "#18794E" }}>ACTUAL · NOW</span>
            <span className="font-bold text-[22px]" style={{ color: "#18794E" }}>
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Capture Confirmation */}
        <div className="flex items-center p-3 gap-2.5 rounded-xl" style={{ backgroundColor: "#EAF2FF" }}>
          <LocateFixed size={18} color="#2167D5" className="shrink-0" />
          <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>
            Geofence captured the timestamp and location automatically.
          </span>
        </div>

        {/* Primary Action Button */}
        <Link href={`/driver/trip/outcome${stopId ? `?stop_id=${stopId}` : ""}`} className="mt-auto pt-2">
          <button 
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
            style={{ backgroundColor: "#092C4C" }}
          >
            Continue
          </button>
        </Link>
      </div>

    </div>
  );
}

export default function ArrivalPage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <ArrivalContent />
    </React.Suspense>
  );
}
