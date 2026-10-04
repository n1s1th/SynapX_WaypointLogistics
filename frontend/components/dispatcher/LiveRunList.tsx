"use client";
import React from "react";
import type { LiveRun } from "@/app/dispatcher/live-tracking/page";

interface LiveRunListProps {
  runs: LiveRun[];
  selectedRunId: number | null;
  onSelect: (run: LiveRun) => void;
}

function getStatusBadge(run: LiveRun) {
  if (run.sync_status === "conflict") 
    return <span className="text-xs text-red-600 font-semibold px-2 py-0.5 rounded-full bg-red-50">Conflict</span>;
  if (run.sync_status === "degraded")
    return <span className="text-xs text-amber-600 font-semibold px-2 py-0.5 rounded-full bg-amber-50">Degraded</span>;
  if (run.status === "scheduled" || run.status === "ready")
    return <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">Ready</span>;
  if (run.last_update_mins !== null && run.last_update_mins > 5)
    return <span className="text-xs text-red-500 font-semibold">+{run.last_update_mins} min</span>;
  return <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold">On track</span>;
}

export function LiveRunList({ runs, selectedRunId, onSelect }: LiveRunListProps) {
  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const isSelected = run.id === selectedRunId;

        return (
          <button
            key={run.id}
            onClick={() => onSelect(run)}
            className={`w-full text-left rounded-[8px] border bg-white p-4 transition-all duration-150 hover:shadow-sm ${
              isSelected
                ? "border-[#18385F] bg-blue-50/20 shadow-sm"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-900 text-sm">
                {run.vehicle_number} · {run.trip_code}
              </span>
              {/* Badge — right side */}
              {getStatusBadge(run)}
            </div>
            
            {/* Status Text instead of progress bar */}
            {run.status === "scheduled" || run.status === "ready" ? (
              <p className="text-xs text-slate-500 mt-1 capitalize">{run.status}</p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">{run.stops_completed} / {run.stop_count} stops</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
