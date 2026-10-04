"use client";

import React, { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, Signal, BatteryFull, CalendarClock,
  ClipboardCheck, Map, Home, TriangleAlert, Layers
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cachedGet } from "@/lib/driverCache";
import { mergeLocalProgress } from "@/lib/driverStop";
import DeviceClock from "@/components/driver/DeviceClock";
import SyncStatus from "@/components/driver/SyncStatus";

interface DeliveryStop {
  id: number;
  sequence: number;
  address: string;
  customer_name: string;
  status: string;
}

interface TripDetail {
  id: number;
  dispatch_trip_id: number;
  run_code?: string | null; // e.g. RUN-0067
  vehicle_number?: string | null; // e.g. VEH005
  status: string;
  stops: DeliveryStop[];
  planned_departure: string | null;
  last_window_closes: string | null;
}

/** "2026-10-03T22:00:00Z" → "03:30" in Sri Lanka time */
function colomboHHMM(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });
}

export default function TripDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = use(params);          // ← unwrap the Promise
  const router = useRouter();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    async function loadTrip() {
      try {
        const data = await cachedGet<TripDetail>(`/driver/trips/${tripId}`);
        setTrip({ ...data, stops: mergeLocalProgress(data.stops) });
      } catch (error) {
        console.error("Failed to load trip details:", error);
      } finally {
        setLoading(false);
      }
    }
    loadTrip();
  }, [tripId]);

  async function handleStartTrip() {
    if (trip?.status === "started") {
      router.push(`/driver/trip`);
      return;
    }
    
    setStarting(true);
    try {
      await apiFetch(`/driver/trips/${tripId}/start`, { method: "POST" });
      router.push(`/driver/trip`);
    } catch (error) {
      console.error("Failed to start trip:", error);
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-xs font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <SyncStatus className="text-sm font-normal text-[#BDBDBD]" />
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center gap-3 w-full">
          <Link href="/driver">
            <ChevronLeft size={22} color="#12202E" />
          </Link>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              {trip?.run_code ?? `Trip R-${tripId}`}
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading ? "Loading..." : `${trip?.stops?.length || 0} stops · ${trip?.vehicle_number ? `Truck ${trip.vehicle_number}` : "Delivery"}`}
            </p>
          </div>
        </div>
      </div>

      {/* Overview content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-24 gap-4">
        {loading ? (
          <div className="text-center py-10 text-[#5D6A78] text-sm font-medium">Loading trip details...</div>
        ) : (
          <>
            {/* Schedule metrics */}
            <div className="flex w-full gap-2.5">
              <div 
                className="flex-1 flex flex-col p-3.5 rounded-xl gap-2.5 bg-white"
                style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
              >
                <span className="font-bold text-[22px]" style={{ color: "#163A5F" }}>{colomboHHMM(trip?.planned_departure ?? null)}</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Planned depart</span>
              </div>
              <div 
                className="flex-1 flex flex-col p-3.5 rounded-xl gap-2.5 bg-white"
                style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
              >
                <span className="font-bold text-[22px]" style={{ color: "#12202E" }}>{trip?.last_window_closes ?? "--:--"}</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Last window closes</span>
              </div>
            </div>

            {/* Route title */}
            <div className="flex justify-between items-center w-full">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Stop sequence</span>
              <div className="flex items-center px-2 py-1 rounded-full bg-[#EAF2FF]">
                <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>
                  {trip?.stops?.filter(s => s.status === 'pending' || s.status === 'arrived').length || 0} to deliver
                </span>
              </div>
            </div>

            {/* Stop sequence card */}
            <div 
              className="flex flex-col p-3.5 gap-2.5 rounded-xl bg-white"
              style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
            >
              {trip?.stops?.map((stop, index) => (
                <div key={stop.id} className="flex w-full gap-3">
                  <div className="flex justify-center items-center w-[30px] h-[30px] rounded-full shrink-0" style={{ backgroundColor: "#163A5F" }}>
                    <span className="font-bold text-[12px] text-white">{stop.sequence}</span>
                  </div>
                  <div className="flex flex-col w-full pb-3" style={{ borderBottom: index < trip.stops.length - 1 ? "1px solid #D9E1E8" : "none" }}>
                    <div className="flex justify-between items-baseline w-full">
                      <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{stop.customer_name}</span>
                      <span className="font-semibold text-[12px]" style={{ color: "#163A5F" }}>{stop.status}</span>
                    </div>
                    <span className="font-normal text-[12px] leading-[1.45em] mt-0.5" style={{ color: "#5D6A78" }}>
                      {stop.address}
                    </span>
                  </div>
                </div>
              ))}
              
              {trip?.stops?.length === 0 && (
                <div className="text-center py-4 text-[#5D6A78] text-sm">No stops assigned.</div>
              )}
            </div>

            {/* Pre-trip check banner */}
            <div 
              className="flex p-3 gap-2.5 rounded-xl bg-[#EAF2FF]"
              style={{ border: "1px solid rgba(33, 103, 213, 0.21)" }}
            >
              <ClipboardCheck size={18} color="#2167D5" className="shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 w-full">
                <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>Pre-trip check</span>
                <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>
                  Confirm vehicle is loaded, sealed, and ready to depart.
                </span>
              </div>
            </div>

            {/* Action Button */}
            <div className="w-full">
              <button 
                onClick={handleStartTrip}
                disabled={starting || trip?.status === "completed"}
                className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
                style={{ backgroundColor: "#092C4C" }}
              >
                {starting ? "Starting..." : trip?.status === "started" ? "Resume Trip →" : "Start trip"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* SOS Button */}
      <Link href="/driver/sos">
        <button 
          className="fixed bottom-[96px] right-5 flex justify-center items-center w-[54px] h-[54px] rounded-full text-white font-extrabold text-[12px]"
          style={{ backgroundColor: "#C9363E", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          SOS
        </button>
      </Link>

      {/* Bottom Nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white"
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
          <TriangleAlert size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium" style={{ color: "#5D6A78" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium" style={{ color: "#5D6A78" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
