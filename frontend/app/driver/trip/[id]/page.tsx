"use client";

import React, { use, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, CalendarClock,
  ClipboardCheck, Map, Home, TriangleAlert, Layers
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { loadTrip, withLocalState, failureMessage, failureReason, type DataSource, type FailureReason } from "@/lib/driverStop";
import { useSyncContext } from "@/components/SyncProvider";
import StatusStrip from "@/components/driver/StatusStrip";
import SyncChip from "@/components/driver/SyncChip";
import type { DriverTripDetail } from "@/types/driver-map";

export default function TripDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = use(params);          // ← unwrap the Promise
  const router = useRouter();
  const { online, queue } = useSyncContext();
  const [rawTrip, setTrip] = useState<DriverTripDetail | null>(null);
  // Server/cached copy + anything recorded on this phone that isn't confirmed yet
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trip = useMemo(() => (rawTrip ? withLocalState(rawTrip) : null), [rawTrip, queue]);
  const [source, setSource] = useState<DataSource | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // Opening the trip online saves it (stops, orders, POD rules) on the phone
    loadTrip(Number(tripId))
      .then((res) => {
        setTrip(res.data);
        setSource(res.source);
        setCachedAt(res.cachedAt);
        setReason(res.reason ?? null);
      })
      .catch((err) => setLoadError(failureMessage(failureReason(err), false)))
      .finally(() => setLoading(false));
  }, [tripId]);

  async function handleStartTrip() {
    if (trip?.status === "started") {
      router.push(`/driver/trip`);
      return;
    }
    // Starting needs the server to confirm the assignment and record the start time
    if (!online) {
      toast.error("Connect to start this trip", { description: "The server has to confirm your assignment first." });
      return;
    }

    setStarting(true);
    try {
      await apiFetch(`/driver/trips/${tripId}/start`, { method: "POST" });
      // Cache the server-confirmed started state before leaving
      const fresh = await loadTrip(Number(tripId));
      if (fresh.source !== "server" || fresh.data.status !== "started") throw new Error("Start not confirmed");
      router.push(`/driver/trip`);
    } catch (error) {
      toast.error("Couldn't start the trip", {
        description: error instanceof Error ? error.message : "Check your connection and try again.",
      });
      setStarting(false);
    }
  }

  const openStops = trip?.stops?.filter((s) => s.status === "pending" || s.status === "arrived").length ?? 0;

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <StatusStrip />

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center gap-3 w-full">
          <Link href="/driver">
            <ChevronLeft size={22} color="#12202E" />
          </Link>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Trip R-{tripId}
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading
                ? "Loading..."
                : source === "cache"
                  ? `${trip?.stops?.length || 0} stops · ${reason === "server" ? "server error · " : ""}saved copy${cachedAt ? ` from ${new Date(cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                  : `${trip?.stops?.length || 0} stops · Delivery`}
            </p>
          </div>
        </div>
      </div>

      {/* Overview content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-24 gap-4">
        {loading ? (
          <div className="text-center py-10 text-[#5D6A78] text-sm font-medium">Loading trip details...</div>
        ) : loadError ? (
          <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>{loadError}</span>
          </div>
        ) : (
          <>
            {/* Schedule metrics */}
            <div className="flex w-full gap-2.5">
              <div 
                className="flex-1 flex flex-col p-3.5 rounded-xl gap-2.5 bg-white"
                style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
              >
                <span className="font-bold text-[22px]" style={{ color: "#163A5F" }}>--:--</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Planned depart</span>
              </div>
              <div 
                className="flex-1 flex flex-col p-3.5 rounded-xl gap-2.5 bg-white"
                style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
              >
                <span className="font-bold text-[22px]" style={{ color: "#12202E" }}>--:--</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Last window closes</span>
              </div>
            </div>

            {/* Route title */}
            <div className="flex justify-between items-center w-full">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Stop sequence</span>
              <div className="flex items-center px-2 py-1 rounded-full bg-[#EAF2FF]">
                <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>
                  {openStops} to deliver
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
                      <span className="flex items-center gap-1.5 shrink-0">
                        <SyncChip status={stop.local_sync} short />
                        <span className="font-semibold text-[12px] capitalize" style={{ color: "#163A5F" }}>{stop.status}</span>
                      </span>
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
            <div className="w-full flex flex-col gap-2">
              {!online && trip?.status === "assigned" && (
                <div className="flex p-3 gap-2.5 rounded-xl" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
                  <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                    You&apos;re offline. A trip can only be started online so dispatch can confirm it — deliveries after that work offline.
                  </span>
                </div>
              )}
              <button 
                onClick={handleStartTrip}
                disabled={starting || trip?.status === "completed" || (!online && trip?.status !== "started")}
                className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
                style={{ backgroundColor: "#092C4C" }}
              >
                {starting ? "Starting..." : trip?.status === "started" ? "Resume Trip →" : trip?.status === "completed" ? "Trip completed" : "Start trip"}
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
