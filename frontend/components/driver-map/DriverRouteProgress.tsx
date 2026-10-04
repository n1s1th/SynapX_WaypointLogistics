"use client";

import type { DeliveryStop } from "@/types/driver-map";
import { isStopDelivered } from "@/lib/driverStop";

interface DriverRouteProgressProps {
  stops: DeliveryStop[];
}

export default function DriverRouteProgress({ stops }: DriverRouteProgressProps) {
  const total = stops.length;
  // Done once the proof is saved; a delivery waiting for its proof still counts as left
  const completed = stops.filter(isStopDelivered).length;
  const failed = stops.filter(
    (s) => s.status === "failed" || s.status === "rescheduled"
  ).length;
  const remaining = total - completed - failed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-white"
      style={{ border: "1px solid #D9E1E8" }}
    >
      {/* Label row */}
      <div className="flex justify-between items-center">
        <span className="text-[11px] font-bold tracking-wider uppercase text-[#5D6A78]">
          Delivery Progress
        </span>
        <span className="text-[12px] font-bold text-[#12202E]">
          {completed} / {total}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-2 rounded-full"
        style={{ backgroundColor: "#E9EEF3" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct === 100 ? "#18794E" : "#2167D5",
          }}
        />
      </div>

      {/* Stat pills */}
      <div className="flex gap-2 mt-0.5">
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ backgroundColor: "#E8F6EF", color: "#18794E" }}
        >
          ✓ {completed} done
        </span>
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ backgroundColor: "#F2F5F8", color: "#5D6A78" }}
        >
          ○ {remaining} left
        </span>
        {failed > 0 && (
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ backgroundColor: "#FDECEC", color: "#C9363E" }}
          >
            ⚠ {failed} issue
          </span>
        )}
      </div>
    </div>
  );
}
