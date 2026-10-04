"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Map, Marker, LngLatBounds, setWorkerUrl, AttributionControl, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DeliveryStop, GPSPosition } from "@/types/driver-map";
import { isStopDelivered, isStopOpen } from "@/lib/driverStop";

// Fix: point MapLibre at the pre-built worker served from /public.
// Turbopack cannot bundle the MapLibre Web Worker inline, so we serve it
// as a static asset and tell MapLibre where to find it.
if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre-gl-worker.mjs");
}

// Colour palette matches project design system
const COLORS = {
  completed: "#18794E",   // success green
  current: "#2167D5",     // brand blue
  upcoming: "#5D6A78",    // muted gray
  problem: "#C9363E",     // destructive red
  route: "#2167D5",
  gps: "#2167D5",
};

interface DriverMapProps {
  stops: DeliveryStop[];
  gpsPosition: GPSPosition | null;
  tripId: number;
  onStopClick: (stop: DeliveryStop) => void;
  mapRef: React.MutableRefObject<Map | null>;
}

function getStopVisualState(
  stop: DeliveryStop,
  nextStopId: number | null
): "completed" | "current" | "upcoming" | "problem" {
  // Delivered but the proof isn't saved yet: still the driver's to finish, not ✓
  if (isStopDelivered(stop)) return "completed";
  if (stop.status === "failed" || stop.status === "rescheduled") return "problem";
  if (stop.status === "arrived" || stop.id === nextStopId) return "current";
  return "upcoming";
}

function getStopColor(state: ReturnType<typeof getStopVisualState>): string {
  return COLORS[state];
}

export default function DriverMapCanvas({
  stops,
  gpsPosition,
  tripId,
  onStopClick,
  mapRef,
}: DriverMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Marker[]>([]);
  const gpsMarkerRef = useRef<Marker | null>(null);
  const initializedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // The next stop still open (by sequence), the same one the Next delivery card shows
  const nextStop = [...stops].sort((a, b) => a.sequence - b.sequence).find(isStopOpen);

  // ── Init map once ─────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    // Default centre: Colombo, Sri Lanka — the most likely operational area
    const defaultCenter: [number, number] = [80.2361, 6.9271];

    // Try to centre on first stop with coords
    const firstWithCoords = stops.find((s) => s.latitude && s.longitude);
    const center: [number, number] = firstWithCoords
      ? [firstWithCoords.longitude!, firstWithCoords.latitude!]
      : defaultCenter;

    const map = new Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/bright",
      center,
      zoom: 13,
      attributionControl: false,
    });

    // Minimal attribution
    map.addControl(
      new AttributionControl({ compact: true }),
      "bottom-left"
    );

    map.on("load", () => {
      // Add route line source (populated after markers)
      map.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": COLORS.route,
          "line-width": 4,
          "line-dasharray": [2, 1.5],
          "line-opacity": 0.8,
        },
      });
      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render stop markers whenever stops change ──────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const coords: [number, number][] = [];

    stops.forEach((stop) => {
      if (!stop.latitude || !stop.longitude) return;

      const state = getStopVisualState(stop, nextStop?.id ?? null);
      const color = getStopColor(state);
      const lngLat: [number, number] = [stop.longitude, stop.latitude];
      coords.push(lngLat);

      // Build custom marker element
      const el = document.createElement("div");
      el.style.cssText = `
        width:36px; height:36px;
        border-radius:50%;
        background:${color};
        border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer;
        transition: transform 0.15s ease;
        font-family: Inter, sans-serif;
      `;

      // Icon / label inside marker
      const label = document.createElement("span");
      label.style.cssText = `
        color:white; font-weight:700; font-size:12px; line-height:1;
        pointer-events:none; user-select:none;
      `;

      if (state === "completed") label.textContent = "✓";
      else if (state === "problem") label.textContent = "⚠";
      else label.textContent = String(stop.sequence);

      el.appendChild(label);

      // Pulse animation for current stop
      if (state === "current") {
        el.style.width = "42px";
        el.style.height = "42px";
        el.style.animation = "driverPulse 2s ease-in-out infinite";
      }

      el.addEventListener("mouseenter", () => {
        el.style.transform = "scale(1.15)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "scale(1)";
      });
      el.addEventListener("click", () => onStopClick(stop));

      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat(lngLat)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Update route line with ordered coords
    if (map.getSource("route")) {
      const ordered = [...stops]
        .filter((s) => s.latitude && s.longitude)
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => [s.longitude!, s.latitude!] as [number, number]);

      (map.getSource("route") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features:
          ordered.length >= 2
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: ordered,
                  },
                },
              ]
            : [],
      });
    }

    // Auto-fit to all stops if we have coords
    if (coords.length >= 2) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 800 });
    } else if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: 14, duration: 800 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, nextStop?.id, mapLoaded]);

  // ── GPS marker ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!gpsPosition) {
      gpsMarkerRef.current?.remove();
      gpsMarkerRef.current = null;
      return;
    }

    const { lat, lng, heading } = gpsPosition;

    if (!gpsMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = `
        width:22px; height:22px;
        border-radius:50%;
        background:${COLORS.gps};
        border:4px solid white;
        box-shadow:0 0 0 3px ${COLORS.gps}55, 0 2px 8px rgba(0,0,0,0.3);
        transition: transform 0.3s ease;
      `;

      // Heading arrow (only shown if heading data available)
      if (heading !== null) {
        el.style.borderRadius = "50% 50% 50% 0";
        el.style.transform = `rotate(${heading - 45}deg)`;
      }

      gpsMarkerRef.current = new Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      gpsMarkerRef.current.setLngLat([lng, lat]);
      const el = gpsMarkerRef.current.getElement();
      if (heading !== null) {
        el.style.transform = `rotate(${heading - 45}deg)`;
      }
    }
  }, [gpsPosition, mapLoaded]);

  return (
    <>
      <style>{`
        @keyframes driverPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(33,103,213,0.4), 0 2px 8px rgba(0,0,0,0.25); }
          50%       { box-shadow: 0 0 0 10px rgba(33,103,213,0), 0 2px 8px rgba(0,0,0,0.25); }
        }
        .maplibregl-canvas { border-radius: 0; }
      `}</style>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
      />
    </>
  );
}
