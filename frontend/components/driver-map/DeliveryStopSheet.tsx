"use client";

import { X, MapPin, Phone } from "lucide-react";
import type { DeliveryStop, GPSPosition } from "@/types/driver-map";
import type { Map as MapLibreMap } from "maplibre-gl";
import NavigationButton from "./NavigationButton";
import Link from "next/link";

interface DeliveryStopSheetProps {
  stop: DeliveryStop;
  tripId: number;
  onClose: () => void;
  mapRef: React.MutableRefObject<MapLibreMap | null>;
  gpsPosition: GPSPosition | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  pending:     { label: "Pending",     bg: "#F2F5F8", color: "#5D6A78" },
  arrived:     { label: "Arrived",     bg: "#EAF2FF", color: "#2167D5" },
  delivered:   { label: "Delivered",   bg: "#E8F6EF", color: "#18794E" },
  partial:     { label: "Partial",     bg: "#FFF4D6", color: "#A85D00" },
  failed:      { label: "Failed",      bg: "#FDECEC", color: "#C9363E" },
  rescheduled: { label: "Rescheduled", bg: "#F3EDFD", color: "#7C3AED" },
};

export default function DeliveryStopSheet({
  stop,
  tripId,
  onClose,
  mapRef,
  gpsPosition,
}: DeliveryStopSheetProps) {
  const statusCfg = STATUS_CONFIG[stop.status] ?? STATUS_CONFIG.pending;
  const isNextOrActive = stop.status === "pending" || stop.status === "arrived";

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden bg-white"
      style={{
        border: "1px solid #D9E1E8",
        boxShadow: "0px -4px 24px rgba(11, 39, 67, 0.18)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}
            >
              {statusCfg.label}
            </span>
            <span className="text-[11px] text-[#8793A0] font-medium">
              Stop {stop.sequence}
            </span>
          </div>
          <h2
            className="text-[18px] font-bold leading-tight"
            style={{ color: "#12202E" }}
          >
            {stop.customer_name}
          </h2>
        </div>
        <button
          id="driver-stop-sheet-close"
          onClick={onClose}
          className="p-2 rounded-full hover:bg-[#F2F5F8] transition-colors"
          aria-label="Close"
        >
          <X size={18} color="#5D6A78" />
        </button>
      </div>

      <div style={{ height: "1px", backgroundColor: "#EDF0F3" }} />

      {/* Details */}
      <div className="flex flex-col gap-3 px-4 py-3">
        {/* Address */}
        <div className="flex items-start gap-2">
          <MapPin size={16} color="#5D6A78" className="shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="text-[12px] text-[#5D6A78]">Address</span>
            <span className="text-[13px] font-medium text-[#12202E] leading-snug">
              {stop.address}
            </span>
          </div>
        </div>

        {/* Phone */}
        {stop.customer_phone && (
          <div className="flex items-center gap-2">
            <Phone size={16} color="#5D6A78" />
            <a
              href={`tel:${stop.customer_phone}`}
              className="text-[13px] font-medium text-[#2167D5]"
            >
              {stop.customer_phone}
            </a>
          </div>
        )}

        {/* GPS status */}
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: stop.latitude ? "#18794E" : "#8793A0",
            }}
          />
          <span className="text-[12px] text-[#5D6A78]">
            {stop.latitude && stop.longitude
              ? `GPS: ${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`
              : "No GPS coordinates recorded"}
          </span>
        </div>

        {/* Timestamps */}
        {stop.arrived_at && (
          <Row label="Arrived" value={formatTime(stop.arrived_at)} />
        )}
        {stop.completed_at && (
          <Row label="Completed" value={formatTime(stop.completed_at)} />
        )}

        {/* Notes */}
        {stop.notes && (
          <div
            className="px-3 py-2 rounded-lg text-[12px] text-[#5D6A78] leading-relaxed"
            style={{ backgroundColor: "#F2F5F8" }}
          >
            📝 {stop.notes}
          </div>
        )}

        {/* Actions */}
        {isNextOrActive && (
          <div className="flex flex-col gap-2 mt-1">
            <NavigationButton stop={stop} mapRef={mapRef} gpsPosition={gpsPosition} className="w-full" />
            <Link
              href={`/driver/trip/arrived?stop_id=${stop.id}`}
              className="w-full"
            >
              <button
                id={`driver-sheet-arrived-${stop.id}`}
                className="w-full h-[48px] flex items-center justify-center rounded-xl font-bold text-[14px] transition-all active:scale-95"
                style={{ backgroundColor: "#EAF2FF", color: "#092C4C" }}
              >
                Mark as Arrived
              </button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[12px] text-[#8793A0] font-medium">{label}</span>
      <span className="text-[13px] font-bold text-[#12202E]">{value}</span>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-LK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
