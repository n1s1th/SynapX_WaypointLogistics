"use client";

import { useState, useCallback } from "react";
import { Navigation2, X, ChevronRight, Loader2 } from "lucide-react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { DeliveryStop, GPSPosition } from "@/types/driver-map";

interface NavigationButtonProps {
  stop: DeliveryStop;
  mapRef: React.MutableRefObject<MapLibreMap | null>;
  gpsPosition: GPSPosition | null;
  className?: string;
}

// ─── OSRM step instruction cleaner ───────────────────────────────────────────
function cleanInstruction(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")       // strip HTML tags
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Fetch route from OSRM (free, no API key) ────────────────────────────────
async function fetchOSRMRoute(
  from: [number, number],   // [lng, lat]
  to: [number, number]      // [lng, lat]
): Promise<{ coordinates: [number, number][]; steps: string[] } | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) return null;

  const route = data.routes[0];
  const coordinates: [number, number][] = route.geometry.coordinates;

  // Flatten all step maneuver instructions
  const steps: string[] = [];
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const text = cleanInstruction(step.maneuver?.instruction || step.name || "");
      const dist = step.distance < 1000
        ? `${Math.round(step.distance)} m`
        : `${(step.distance / 1000).toFixed(1)} km`;
      if (text) steps.push(`${text} — ${dist}`);
    }
  }

  return { coordinates, steps };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NavigationButton({
  stop,
  mapRef,
  gpsPosition,
  className = "",
}: NavigationButtonProps) {
  const [status, setStatus]   = useState<"idle" | "loading" | "active">("idle");
  const [steps, setSteps]     = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError]     = useState<string | null>(null);

  const startNavigation = useCallback(async () => {
    const map = mapRef.current;
    if (!stop.latitude || !stop.longitude) {
      setError("No coordinates for this stop.");
      return;
    }

    setStatus("loading");
    setError(null);

    const destination: [number, number] = [stop.longitude, stop.latitude];

    // Use GPS if available, otherwise start from the destination area
    const origin: [number, number] = gpsPosition
      ? [gpsPosition.lng, gpsPosition.lat]
      : [stop.longitude - 0.01, stop.latitude - 0.01]; // dummy nearby origin

    try {
      const route = await fetchOSRMRoute(origin, destination);

      if (!route) {
        setError("Could not get route. Check your connection.");
        setStatus("idle");
        return;
      }

      // Draw route on the in-app MapLibre map
      if (map) {
        // Add or update nav-route source
        if (!map.getSource("nav-route")) {
          map.addSource("nav-route", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "nav-route-casing",
            type: "line",
            source: "nav-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#fff", "line-width": 8, "line-opacity": 0.6 },
          });
          map.addLayer({
            id: "nav-route-line",
            type: "line",
            source: "nav-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#2167D5", "line-width": 5 },
          });
        }

        (map.getSource("nav-route") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: route.coordinates },
          }],
        });

        // Fly to show the full route
        const lngs = route.coordinates.map(c => c[0]);
        const lats = route.coordinates.map(c => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, duration: 800 }
        );
      }

      setSteps(route.steps);
      setStepIndex(0);
      setStatus("active");
    } catch {
      setError("Failed to load route. Try again.");
      setStatus("idle");
    }
  }, [stop, mapRef, gpsPosition]);

  const stopNavigation = useCallback(() => {
    setStatus("idle");
    setSteps([]);
    setStepIndex(0);
    setError(null);

    // Clear nav route from map
    const map = mapRef.current;
    if (map && map.getSource("nav-route")) {
      (map.getSource("nav-route") as GeoJSONSource).setData({
        type: "FeatureCollection", features: [],
      });
    }
  }, [mapRef]);

  // ── Active navigation HUD ───────────────────────────────────────────────────
  if (status === "active" && steps.length > 0) {
    const currentStep = steps[stepIndex];
    const isLast = stepIndex >= steps.length - 1;

    return (
      <div className={`flex flex-col gap-2 rounded-xl overflow-hidden ${className}`}
        style={{ border: "2px solid #2167D5", backgroundColor: "#EAF2FF" }}>
        {/* Current instruction */}
        <div className="flex items-start gap-3 px-3 pt-3 pb-1">
          <div className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
            style={{ backgroundColor: "#2167D5" }}>
            <Navigation2 size={15} color="white" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#2167D5]">
              Step {stepIndex + 1} of {steps.length}
            </span>
            <span className="text-[13px] font-semibold leading-snug text-[#12202E] break-words">
              {currentStep}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-2 px-3 pb-3">
          {!isLast && (
            <button
              onClick={() => setStepIndex(i => Math.min(i + 1, steps.length - 1))}
              className="flex-1 h-[38px] flex items-center justify-center gap-1 rounded-lg
                         font-bold text-[13px] text-white transition-all active:scale-95"
              style={{ backgroundColor: "#2167D5" }}
            >
              Next Step <ChevronRight size={15} />
            </button>
          )}
          {isLast && (
            <div className="flex-1 h-[38px] flex items-center justify-center rounded-lg
                            font-bold text-[13px] text-[#18794E]"
              style={{ backgroundColor: "#E8F6EF" }}>
              You&apos;ve arrived!
            </div>
          )}
          <button
            onClick={stopNavigation}
            className="w-[38px] h-[38px] flex items-center justify-center rounded-lg transition-all active:scale-95"
            style={{ backgroundColor: "#F2F5F8" }}
            title="End navigation"
          >
            <X size={16} color="#5D6A78" />
          </button>
        </div>
      </div>
    );
  }

  // ── Idle / Loading button ───────────────────────────────────────────────────
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <button
        id={`driver-nav-btn-${stop.id}`}
        onClick={startNavigation}
        disabled={status === "loading"}
        className="flex items-center justify-center gap-2 h-[52px] rounded-xl
                   font-bold text-[15px] text-white transition-all active:scale-95 disabled:opacity-60"
        style={{ backgroundColor: "#092C4C" }}
        aria-label={`Start navigation to ${stop.customer_name}`}
      >
        {status === "loading"
          ? <><Loader2 size={16} className="animate-spin" /> Getting route…</>
          : <><Navigation2 size={18} /> Start Navigation</>}
      </button>
      {error && (
        <span className="text-[11px] text-[#C9363E] font-medium px-1">{error}</span>
      )}
    </div>
  );
}
