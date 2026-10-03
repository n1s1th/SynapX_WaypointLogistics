"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { DeliveryStop } from "@/types/driver-map";
import SyncChip from "@/components/driver/SyncChip";

interface StopSequenceListProps {
  stops: DeliveryStop[];
  onStopClick: (stop: DeliveryStop) => void;
}

const STATUS_ICON: Record<string, string> = {
  delivered: "✓",
  partial:   "½",
  failed:    "✗",
  rescheduled: "↻",
  arrived:   "→",
  pending:   "○",
};

const STATUS_COLOR: Record<string, { dot: string; text: string }> = {
  delivered:   { dot: "#18794E", text: "#18794E" },
  partial:     { dot: "#A85D00", text: "#A85D00" },
  failed:      { dot: "#C9363E", text: "#C9363E" },
  rescheduled: { dot: "#7C3AED", text: "#7C3AED" },
  arrived:     { dot: "#2167D5", text: "#2167D5" },
  pending:     { dot: "#D9E1E8", text: "#5D6A78"  },
};

export default function StopSequenceList({ stops, onStopClick }: StopSequenceListProps) {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden bg-white"
      style={{ border: "1px solid #D9E1E8" }}
    >
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid #EDF0F3" }}>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5D6A78]">
          Stop Sequence
        </span>
        <span className="text-[11px] text-[#8793A0]">
          {stops.length} stops
        </span>
      </div>

      {sorted.map((stop, index) => {
        const cfg = STATUS_COLOR[stop.status] ?? STATUS_COLOR.pending;
        const icon = STATUS_ICON[stop.status] ?? "○";
        const isLast = index === sorted.length - 1;

        return (
          <button
            key={stop.id}
            id={`driver-stop-seq-${stop.id}`}
            onClick={() => onStopClick(stop)}
            className="flex items-center gap-3 px-4 py-3 text-left w-full transition-colors hover:bg-[#F8FAFC] active:bg-[#EAF2FF]"
            style={{
              borderBottom: isLast ? "none" : "1px solid #EDF0F3",
            }}
          >
            {/* Sequence dot */}
            <div
              className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-[11px] font-bold"
              style={{
                backgroundColor: cfg.dot,
                color: stop.status === "pending" ? "#8793A0" : "white",
              }}
            >
              {icon}
            </div>

            {/* Info */}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[13px] font-bold text-[#12202E] truncate">
                {stop.customer_name}
              </span>
              <span className="text-[11px] text-[#8793A0] truncate">
                {stop.address}
              </span>
            </div>

            {/* Delivery status, and separately whether the server has it yet */}
            <span className="flex flex-col items-end gap-1 shrink-0 ml-1">
              <span className="text-[10px] font-bold" style={{ color: cfg.text }}>
                {stop.status.toUpperCase()}
              </span>
              <SyncChip status={stop.local_sync} short />
            </span>
          </button>
        );
      })}
    </div>
  );
}
