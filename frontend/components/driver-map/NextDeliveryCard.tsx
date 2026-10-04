"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, MapPin, Package } from "lucide-react";
import Link from "next/link";
import NavigationButton from "./NavigationButton";
import type { DeliveryStop, GPSPosition } from "@/types/driver-map";
import type { Map as MapLibreMap } from "maplibre-gl";

interface NextDeliveryCardProps {
  stop: DeliveryStop;
  tripId: number;
  totalStops: number;
  mapRef: React.MutableRefObject<MapLibreMap | null>;
  gpsPosition: GPSPosition | null;
}

export default function NextDeliveryCard({
  stop,
  tripId,
  totalStops,
  mapRef,
  gpsPosition,
}: NextDeliveryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusLabel =
    stop.status === "arrived" ? "ARRIVED" : "NEXT DELIVERY";
  const statusColor =
    stop.status === "arrived" ? "#18794E" : "#2167D5";

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden bg-white"
      style={{
        border: "1px solid #D9E1E8",
        boxShadow: "0px -4px 20px rgba(11, 39, 67, 0.12)",
      }}
    >
      {/* Collapsed header — always visible */}
      <button
        id="driver-next-delivery-toggle"
        className="flex items-center justify-between px-4 pt-3 pb-3 w-full text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[10px] font-bold tracking-wider uppercase"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </span>
          <span
            className="text-[16px] font-bold leading-tight"
            style={{ color: "#12202E" }}
          >
            {stop.customer_name}
          </span>
          <span
            className="text-[12px] font-normal mt-0.5 truncate max-w-[220px]"
            style={{ color: "#5D6A78" }}
          >
            Stop {stop.sequence} of {totalStops} · {stop.address}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Location pill */}
          {stop.latitude && stop.longitude && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
              style={{ backgroundColor: "#EAF2FF", color: "#2167D5" }}
            >
              <MapPin size={10} />
              Mapped
            </span>
          )}
          {/* The details open below: ▼ to open them, ▲ to close */}
          {expanded ? (
            <ChevronUp size={20} color="#5D6A78" />
          ) : (
            <ChevronDown size={20} color="#5D6A78" />
          )}
        </div>
      </button>

      {/* Divider */}
      <div style={{ height: "1px", backgroundColor: "#EDF0F3" }} />

      {/* Expanded detail */}
      {expanded && (
        <div className="flex flex-col gap-3 px-4 py-3">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-2">
            <InfoRow label="Address" value={stop.address} />
            {stop.customer_phone && (
              <InfoRow label="Phone" value={stop.customer_phone} />
            )}
            {stop.notes && (
              <InfoRow label="Notes" value={stop.notes} span />
            )}
            {stop.arrived_at && (
              <InfoRow
                label="Arrived at"
                value={new Date(stop.arrived_at).toLocaleTimeString("en-LK", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            )}
            {stop.completed_at && (
              <InfoRow
                label="Completed"
                value={new Date(stop.completed_at).toLocaleTimeString("en-LK", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 mt-1">
            <NavigationButton stop={stop} mapRef={mapRef} gpsPosition={gpsPosition} className="w-full" />

            <Link href={`/driver/trip/arrived?stop_id=${stop.id}`} className="w-full">
              <button
                id={`driver-arrived-btn-${stop.id}`}
                className="w-full h-[48px] flex items-center justify-center gap-2 rounded-xl text-[#092C4C] font-bold text-[14px] transition-all active:scale-95"
                style={{
                  backgroundColor: "#EAF2FF",
                  border: "1px solid rgba(33,103,213,0.25)",
                }}
              >
                <Package size={16} />
                I&apos;m Here — Start Delivery
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* When collapsed: quick navigate button always visible */}
      {!expanded && (
        <div className="px-4 pb-3 pt-1">
          <NavigationButton stop={stop} mapRef={mapRef} gpsPosition={gpsPosition} className="w-full" />
        </div>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  span,
}: {
  label: string;
  value: string;
  span?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${span ? "col-span-2" : ""}`}>
      <span className="text-[10px] font-bold text-[#8793A0] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[13px] font-medium text-[#12202E] leading-tight">
        {value}
      </span>
    </div>
  );
}
