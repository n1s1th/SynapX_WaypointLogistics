"use client";

import { Crosshair, Route, MapPin } from "lucide-react";
import { type Map as MapLibreMap, LngLatBounds } from "maplibre-gl";
import type { DeliveryStop } from "@/types/driver-map";

interface DriverMapControlsProps {
  mapRef: React.MutableRefObject<MapLibreMap | null>;
  stops: DeliveryStop[];
  nextStop: DeliveryStop | null;
  onLocateMe: () => void;
}

export default function DriverMapControls({
  mapRef,
  stops,
  nextStop,
  onLocateMe,
}: DriverMapControlsProps) {
  function fitRoute() {
    const map = mapRef.current;
    if (!map) return;
    const withCoords = stops.filter((s) => s.latitude && s.longitude);
    if (withCoords.length === 0) return;
    const bounds = withCoords.reduce(
      (b, s) =>
        b.extend([s.longitude!, s.latitude!]),
      new LngLatBounds(
        [withCoords[0].longitude!, withCoords[0].latitude!],
        [withCoords[0].longitude!, withCoords[0].latitude!]
      )
    );
    map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 700 });
  }

  function flyToNextStop() {
    const map = mapRef.current;
    if (!map || !nextStop?.latitude || !nextStop?.longitude) return;
    map.flyTo({
      center: [nextStop.longitude, nextStop.latitude],
      zoom: 15,
      duration: 700,
    });
  }

  const btnBase = `
    flex items-center justify-center
    w-11 h-11 rounded-xl bg-white shadow-md
    border border-[#D9E1E8]
    active:scale-95 transition-transform
    text-[#12202E]
  `;

  return (
    <div className="flex flex-col gap-2 pointer-events-auto">
      {/* Locate me */}
      <button
        id="driver-map-locate-btn"
        className={btnBase}
        aria-label="My location"
        onClick={onLocateMe}
        title="My Location"
      >
        <Crosshair size={20} />
      </button>

      {/* Fit whole route */}
      <button
        id="driver-map-fit-route-btn"
        className={btnBase}
        aria-label="Fit route"
        onClick={fitRoute}
        title="Fit Route"
      >
        <Route size={20} />
      </button>

      {/* Jump to next stop */}
      {nextStop && (
        <button
          id="driver-map-next-stop-btn"
          className={`${btnBase} bg-[#2167D5]`}
          style={{ color: "white", border: "none" }}
          aria-label="Next stop"
          onClick={flyToNextStop}
          title="Next Stop"
        >
          <MapPin size={20} />
        </button>
      )}
    </div>
  );
}
