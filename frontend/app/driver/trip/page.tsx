"use client";

/**
 * Driver Route Map — /driver/trip
 *
 * Replaces the previous SVG-placeholder map with a real MapLibre GL map.
 *
 * Data sources:
 *  - GET /api/v1/driver/trips/today   → find the STARTED trip
 *  - GET /api/v1/driver/trips/{id}    → get full stop list with lat/lng
 *
 * GPS:
 *  - Uses browser Geolocation API (navigator.geolocation.watchPosition)
 *  - Does NOT fake GPS coordinates
 *  - Clearly falls back when GPS is unavailable
 *
 * Architecture:
 *  - Map canvas is created ONCE (ref pattern) to avoid re-renders
 *  - Stop markers updated via MapLibre directly, not React re-renders
 *  - Bottom sheet pattern for mobile (swipe-friendly)
 */

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, Home, Map as MapIcon, TriangleAlert, Layers,
  List, AlertCircle, RefreshCw, Loader2
} from "lucide-react";
import { type Map as MapLibreMap } from "maplibre-gl";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { cachedGet } from "@/lib/driverCache";
import { gpsLabel } from "@/lib/gps";
import { fetchStopDetail, isStopDelivered, isStopOpen, mergeLocalProgress, rememberActiveTrip } from "@/lib/driverStop";
import type { DriverTripDetail, DeliveryStop, GPSPosition } from "@/types/driver-map";

// Heavy map canvas loaded client-side only
const DriverMapCanvas = dynamic(() => import("@/components/driver-map/DriverMapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#EDF2F7]">
      <Loader2 size={28} className="animate-spin text-[#2167D5]" />
    </div>
  ),
});

import DriverMapControls from "@/components/driver-map/DriverMapControls";
import NextDeliveryCard from "@/components/driver-map/NextDeliveryCard";
import DeliveryStopSheet from "@/components/driver-map/DeliveryStopSheet";
import DriverRouteProgress from "@/components/driver-map/DriverRouteProgress";
import StopSequenceList from "@/components/driver-map/StopSequenceList";
import MapOfflineState from "@/components/driver-map/MapOfflineState";
import NavigationButton from "@/components/driver-map/NavigationButton";

// ─── View modes & States ──────────────────────────────────────────────────────
type ViewMode = "map" | "list";
type MapState = "NO_ACTIVE_ROUTE" | "ACTIVE_ROUTE" | "COMPLETED_ROUTE" | "OFFLINE";

export default function DriverRouteMapPage() {
  const router = useRouter();
  const mapRef = useRef<MapLibreMap | null>(null);

  // ── Data state ─────────────────────────────────────────────────
  const [trip, setTrip] = useState<DriverTripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [completing, setCompleting] = useState(false);

  // ── GPS state ──────────────────────────────────────────────────
  const [gpsPosition, setGpsPosition] = useState<GPSPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const gpsWatchId = useRef<number | null>(null);

  // ── UI state ───────────────────────────────────────────────────
  const [selectedStop, setSelectedStop] = useState<DeliveryStop | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map");

  // ─── Derived values ───────────────────────────────────────────
  const stops = trip?.stops ?? [];
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);

  // Next stop = first one still open (by sequence), including a delivery whose proof isn't saved yet
  const nextStop = sortedStops.find(isStopOpen) ?? null;

  const allTerminal = stops.length > 0 && !stops.some(isStopOpen);

  const stopsWithCoords = stops.filter((s) => s.latitude && s.longitude);

  // Determine Map State
  let mapState: MapState = "NO_ACTIVE_ROUTE";
  if (offline && !trip) {
    mapState = "OFFLINE";
  } else if (trip) {
    if (allTerminal) {
      mapState = "COMPLETED_ROUTE";
    } else {
      mapState = "ACTIVE_ROUTE";
    }
  }

  // ─── Load trip data ───────────────────────────────────────────
  const loadTrip = useCallback(async () => {
    try {
      const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
      // Prioritise STARTED, then ASSIGNED
      const target =
        trips.find((t) => t.status === "started") ??
        trips.find((t) => t.status === "assigned") ??
        null;

      if (target) {
        const fetched = await cachedGet<DriverTripDetail>(`/driver/trips/${target.id}`);
        // What the driver did offline (still in the sync queue) shows on the map too
        const detail = { ...fetched, stops: mergeLocalProgress(fetched.stops) };
        setTrip(detail);
        setLastUpdated(new Date());
        setOffline(false);
        // Keep a copy of every open stop on the phone, so its screens open with no signal
        detail.stops.filter(isStopOpen).forEach((s) => fetchStopDetail(s.id).catch(() => undefined));
        rememberActiveTrip(detail.status === "started" ? detail.id : null);
      } else {
        setTrip(null);
        setOffline(false);
        rememberActiveTrip(null);
      }
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrip();
    // Poll for stop status changes every 30 seconds (passive refresh)
    const interval = setInterval(loadTrip, 30_000);
    return () => clearInterval(interval);
  }, [loadTrip]);

  // ─── GPS watch ────────────────────────────────────────────────
  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("GPS not available on this device");
      return;
    }
    if (gpsWatchId.current !== null) return; // already watching

    gpsWatchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
        });
        setGpsError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError("Location permission denied");
        } else {
          setGpsError("GPS unavailable");
        }
        gpsWatchId.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    startGps();
    return () => {
      if (gpsWatchId.current !== null) {
        navigator.geolocation?.clearWatch(gpsWatchId.current);
        gpsWatchId.current = null;
      }
    };
  }, [startGps]);

  // ─── Fly to GPS position ──────────────────────────────────────
  const handleLocateMe = useCallback(() => {
    const map = mapRef.current;
    if (!map || !gpsPosition) {
      startGps();
      toast.error("No location yet", {
        description: "Turn on location and allow it for this site.",
      });
      return;
    }
    map.flyTo({
      center: [gpsPosition.lng, gpsPosition.lat],
      zoom: 15,
      duration: 700,
    });
  }, [gpsPosition, startGps]);

  // ─── Complete trip ────────────────────────────────────────────
  async function handleCompleteTrip() {
    if (!trip) return;
    setCompleting(true);
    try {
      await apiFetch(`/driver/trips/${trip.id}/complete`, { method: "POST" });
      router.push("/driver/trip/summary");
    } catch {
      setCompleting(false);
    }
  }

  // ─── Loading skeleton ─────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}
      >
        <Loader2 size={36} className="animate-spin text-[#2167D5]" />
        <span className="text-[14px] font-medium text-[#5D6A78]">
          Loading your route…
        </span>
      </div>
    );
  }



  // ─── Main render ──────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <div
        className="flex flex-col w-full bg-white z-30"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Title bar */}
        <div className="flex px-4 py-2.5 items-center justify-between w-full">
          <div className="flex items-center gap-2.5">
            <Link href="/driver">
              <ChevronLeft size={22} color="#12202E" />
            </Link>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-[17px] font-bold leading-tight text-[#12202E]">
                {trip ? trip.run_code ?? `Trip R-${trip.id}` : "Route Map"}
              </h1>
              <p className="text-[11px] text-[#5D6A78]">
                {gpsPosition
                  ? gpsLabel(gpsPosition.accuracy)
                  : gpsError
                  ? `⚠ ${gpsError}`
                  : "Locating…"}
                {trip && ` · ${trip.vehicle_number ? `Truck ${trip.vehicle_number}` : `Dispatch #${trip.dispatch_trip_id}`}`}
              </p>
            </div>
          </div>

          {/* View toggle: Map / List */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg"
            style={{ backgroundColor: "#F2F5F8" }}
          >
            <button
              id="driver-view-map-btn"
              onClick={() => setViewMode("map")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-bold transition-all"
              style={{
                backgroundColor: viewMode === "map" ? "#0B2743" : "transparent",
                color: viewMode === "map" ? "white" : "#5D6A78",
              }}
            >
              <MapIcon size={14} />
              Map
            </button>
            <button
              id="driver-view-list-btn"
              onClick={() => setViewMode("list")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-bold transition-all"
              style={{
                backgroundColor: viewMode === "list" ? "#0B2743" : "transparent",
                color: viewMode === "list" ? "white" : "#5D6A78",
              }}
            >
              <List size={14} />
              List
            </button>
          </div>
        </div>
      </div>

      {/* ── Offline banner ────────────────────────────────────── */}
      {offline && (
        <div
          className="flex items-center gap-2 px-4 py-2 z-20"
          style={{ backgroundColor: "#FFF4D6", borderBottom: "1px solid #F0B429" }}
        >
          <AlertCircle size={14} color="#A85D00" />
          <span className="text-[12px] font-medium text-[#A85D00] flex-1">
            Connection lost · Showing last known route
          </span>
          <button
            onClick={() => { setOffline(false); loadTrip(); }}
            className="text-[12px] font-bold text-[#A85D00] underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── MAP VIEW ─────────────────────────────────────────── */}
      {viewMode === "map" && (
        <div className="flex flex-col flex-1 relative">
          {/* Map container */}
          <div className="relative flex-1" style={{ minHeight: "50vh" }}>
            <DriverMapCanvas
              stops={stops}
              gpsPosition={gpsPosition}
              tripId={trip?.id ?? 0}
              onStopClick={(stop) => setSelectedStop(stop)}
              mapRef={mapRef}
            />

            {/* Map controls — top right */}
            <div className="absolute top-3 right-3 z-10">
              <DriverMapControls
                mapRef={mapRef}
                stops={stops}
                nextStop={nextStop}
                onLocateMe={handleLocateMe}
              />
            </div>

            {/* Stop count badge — top left */}
            {mapState === "ACTIVE_ROUTE" && (
              <div
                className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ backgroundColor: "rgba(9,44,76,0.92)", backdropFilter: "blur(4px)" }}
              >
                <span className="text-[11px] font-bold text-white">
                  {stops.filter(isStopDelivered).length}
                  /{stops.length} stops done
                </span>
              </div>
            )}
          </div>

          {/* ── Bottom panel ────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-4 pt-3 pb-[88px] bg-[#F2F5F8]">

            {/* Offline full-block state */}
            {mapState === "OFFLINE" && (
              <MapOfflineState
                lastUpdated={lastUpdated}
                onRetry={() => { setOffline(false); loadTrip(); }}
              />
            )}

            {/* Progress bar */}
            {(mapState === "ACTIVE_ROUTE" || mapState === "COMPLETED_ROUTE") && stops.length > 0 && (
              <DriverRouteProgress stops={stops} />
            )}

            {/* Selected stop sheet (tap on marker) */}
            {selectedStop && (
              <DeliveryStopSheet
                stop={selectedStop}
                tripId={trip?.id ?? 0}
                onClose={() => setSelectedStop(null)}
                mapRef={mapRef}
                gpsPosition={gpsPosition}
              />
            )}

            {/* Next delivery card */}
            {!selectedStop && mapState === "ACTIVE_ROUTE" && nextStop && (
              <NextDeliveryCard
                stop={nextStop}
                tripId={trip!.id}
                totalStops={stops.length}
                mapRef={mapRef}
                gpsPosition={gpsPosition}
              />
            )}

            {/* All stops done — complete trip */}
            {!selectedStop && mapState === "COMPLETED_ROUTE" && (
              <AllDoneCard
                tripId={trip!.id}
                completing={completing}
                onComplete={handleCompleteTrip}
              />
            )}

            {/* No trip / empty state */}
            {!selectedStop && mapState === "NO_ACTIVE_ROUTE" && (
              <div
                className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-white text-center"
                style={{ border: "1px solid #D9E1E8" }}
              >
                <MapIcon size={32} color="#D9E1E8" />
                <span className="text-[14px] font-bold text-[#12202E]">NO ACTIVE ROUTE</span>
                <span className="text-[12px] text-[#5D6A78]">
                  You currently have no assigned delivery route.
                </span>
                <Link href="/driver">
                  <button className="mt-2 px-5 py-2 rounded-xl font-bold text-white text-[13px]" style={{ backgroundColor: "#092C4C" }}>
                    Back to Home
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className="flex flex-col flex-1 px-4 pt-4 pb-[88px] gap-3 overflow-y-auto">
          {mapState === "OFFLINE" && (
            <MapOfflineState
              lastUpdated={lastUpdated}
              onRetry={() => { setOffline(false); loadTrip(); }}
            />
          )}

          {(mapState === "ACTIVE_ROUTE" || mapState === "COMPLETED_ROUTE") && stops.length > 0 && <DriverRouteProgress stops={stops} />}

          {selectedStop && (
            <DeliveryStopSheet
              stop={selectedStop}
              tripId={trip?.id ?? 0}
              onClose={() => setSelectedStop(null)}
              mapRef={mapRef}
              gpsPosition={gpsPosition}
            />
          )}

          {!selectedStop && mapState === "ACTIVE_ROUTE" && nextStop && (
            <NextDeliveryCard
              stop={nextStop}
              tripId={trip!.id}
              totalStops={stops.length}
              mapRef={mapRef}
              gpsPosition={gpsPosition}
            />
          )}

          {!selectedStop && mapState === "COMPLETED_ROUTE" && (
            <AllDoneCard
              tripId={trip!.id}
              completing={completing}
              onComplete={handleCompleteTrip}
            />
          )}

          {!selectedStop && mapState === "NO_ACTIVE_ROUTE" && (
            <div
              className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-white text-center"
              style={{ border: "1px solid #D9E1E8" }}
            >
              <MapIcon size={32} color="#D9E1E8" />
              <span className="text-[14px] font-bold text-[#12202E]">NO ACTIVE ROUTE</span>
              <span className="text-[12px] text-[#5D6A78]">
                You currently have no assigned delivery route.
              </span>
            </div>
          )}

          {stops.length > 0 ? (
            <StopSequenceList
              stops={stops}
              onStopClick={(s) => {
                setSelectedStop(s);
                setViewMode("map");
              }}
            />
          ) : (
            <div className="text-center py-10 text-[#5D6A78] text-sm">
              No stops found for this trip.
            </div>
          )}
        </div>
      )}

      {/* ── SOS FAB ──────────────────────────────────────────── */}
      <Link href="/driver/sos">
        <button
          id="driver-sos-fab"
          className="fixed bottom-[88px] right-4 flex justify-center items-center w-[54px] h-[54px] rounded-full text-white font-extrabold text-[12px] z-50"
          style={{
            backgroundColor: "#C9363E",
            boxShadow: "0px 4px 16px rgba(201,54,62,0.4)",
          }}
        >
          SOS
        </button>
      </Link>

      {/* ── Bottom Nav ───────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white z-40"
        style={{ borderTop: "1px solid #D9E1E8", boxShadow: "0px -8px 28px rgba(11,39,67,0.12)" }}
      >
        <Link href="/driver" className="flex flex-col items-center gap-1 w-[72px]">
          <Home size={22} color="#8793A0" />
          <span className="text-[10px] font-medium text-[#8793A0]">Home</span>
        </Link>
        <Link href="/driver/trip" className="flex flex-col items-center gap-1 w-[72px]">
          <MapIcon size={22} color="#2167D5" />
          <span className="text-[10px] font-bold text-[#2167D5]">Map</span>
        </Link>
        <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
          <TriangleAlert size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium text-[#5D6A78]">Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium text-[#5D6A78]">Queue</span>
        </Link>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────



function AllDoneCard({
  tripId,
  completing,
  onComplete,
}: {
  tripId: number;
  completing: boolean;
  onComplete: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-2xl"
      style={{ backgroundColor: "#E8F6EF", border: "2px solid #18794E" }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-full"
          style={{ backgroundColor: "#18794E" }}
        >
          <span className="text-white text-[18px]">✓</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[15px] font-bold text-[#12202E]">All Stops Completed!</span>
          <span className="text-[12px] text-[#5D6A78]">Return to depot and complete the trip.</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Link href="/driver/trip/depot">
          <button
            className="w-full h-[50px] flex items-center justify-center rounded-xl font-bold text-white text-[15px]"
            style={{ backgroundColor: "#18794E" }}
          >
            Return to Depot
          </button>
        </Link>
        <button
          id="driver-complete-trip-btn"
          onClick={onComplete}
          disabled={completing}
          className="w-full h-[44px] flex items-center justify-center rounded-xl font-bold text-[14px] disabled:opacity-50 transition-all"
          style={{ backgroundColor: "#F2F5F8", color: "#5D6A78" }}
        >
          {completing ? "Completing…" : "Complete Trip"}
        </button>
      </div>
    </div>
  );
}
