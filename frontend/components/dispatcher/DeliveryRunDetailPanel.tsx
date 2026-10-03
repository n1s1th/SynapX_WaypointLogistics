import React, { useState } from "react";
import { X, ChevronRight, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/dispatcher/StatusBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { DeliveryRun, DeliveryRunStop } from "@/app/dispatcher/delivery-runs/page";
import { DriverDeliveriesSection } from "@/components/dispatcher/DriverDeliveriesSection";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

interface DeliveryRunDetailPanelProps {
  run: DeliveryRun;
  onClose: () => void;
  onUpdate: () => void;
  onViewManifest: () => void;
  onOptimizeRoute: () => void;
  onViewLoadingStatus: () => void;
}

export function DeliveryRunDetailPanel({ run, onClose, onUpdate, onViewManifest, onOptimizeRoute, onViewLoadingStatus }: DeliveryRunDetailPanelProps) {
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'en_route' })
      });
      if (res.ok) {
        toast.success("Run published successfully");
        onUpdate();
      } else {
        toast.error("Failed to publish run");
      }
    } catch {
      toast.error("Error connecting to server");
    } finally {
      setIsPublishing(false);
    }
  };

  const stops = run.stop_sequence || [];
  const loadPercentage = run.total_volume_m3 ? Math.round((run.total_volume_m3 / 24.0) * 100) : 0; // Using 24m3 max as proxy

  const currentStatus = run.displayStatus || run.status || "unknown";

  return (
    <div className="bg-white border rounded-[8px] flex flex-col h-full shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-slate-900">{run.trip_code}</h2>
            <StatusBadge
              status={currentStatus === "en_route" ? "On Route" : currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}
              variant={
                currentStatus === "scheduled" ? "primary" :
                currentStatus === "ready" ? "success" :
                currentStatus === "en_route" ? "info" :
                currentStatus === "delayed" ? "destructive" :
                "neutral"
              }
            />
          </div>
          <p className="text-sm text-slate-500 font-medium">{run.vehicle_number} · {run.driver_name}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-5 flex-1 overflow-y-auto space-y-6">
        
        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-y-4 gap-x-2">
          <div>
            <p className="text-xs text-slate-500 mb-1 font-medium">Stops</p>
            <p className="text-sm font-semibold text-slate-900">{run.stop_count} outlets</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1 font-medium">Departure</p>
            <p className="text-sm font-semibold text-slate-900">
              {run.departure_time ? format(new Date(run.departure_time), "HH:mm") : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1 font-medium">ETA</p>
            <p className="text-sm font-semibold text-slate-900">
              {run.estimated_arrival ? format(new Date(run.estimated_arrival), "HH:mm") : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1 font-medium">Load</p>
            <p className="text-sm font-semibold text-slate-900">
              {run.total_weight_kg.toLocaleString()} kg · {loadPercentage}%
            </p>
          </div>
        </div>

        {/* Shortfalls Alert */}
        {run.open_shortfalls > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-900">Loading issues reported</p>
              <p className="text-xs text-red-700 mt-0.5">Please check loading status before departure.</p>
            </div>
          </div>
        )}

        {/* Stop Sequence */}
        <div>
          <h3 className="text-sm font-bold text-slate-900 mb-3">Stop sequence</h3>
          <div className="space-y-2">
            {stops.map((stop: DeliveryRunStop | string, idx: number) => {
              const stopName = typeof stop === 'string' ? stop : stop.name;
              return (
                <div key={idx} className="bg-slate-50 border border-slate-100 rounded-md p-2.5 flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-slate-600">{idx + 1}</span>
                  </div>
                  <span className="text-sm font-medium text-slate-700">{stopName}</span>
                </div>
              );
            })}
            {stops.length === 0 && (
              <p className="text-sm text-slate-500 italic">No stops planned</p>
            )}
          </div>
        </div>

        {/* What the driver has delivered (server-confirmed) */}
        <DriverDeliveriesSection runId={run.id} />
      </div>

      {/* Actions */}
      <div className="p-5 border-t border-slate-100 space-y-2.5 bg-slate-50/50 mt-auto">
        <Button variant="outline" className="w-full justify-between h-9 text-slate-700" onClick={onViewManifest}>
          View Manifest <ChevronRight className="h-4 w-4 text-slate-400" />
        </Button>
        <Button variant="outline" className="w-full justify-between h-9 text-slate-700" onClick={onOptimizeRoute}>
          Optimize Route <ChevronRight className="h-4 w-4 text-slate-400" />
        </Button>
        <Button 
          variant="outline" 
          className="w-full justify-between h-9 border-[#18385F] text-[#18385F] hover:bg-slate-50" 
          onClick={onViewLoadingStatus}
        >
          View Loading Status <ChevronRight className="h-4 w-4 opacity-50" />
        </Button>
        {(currentStatus === 'scheduled' || currentStatus === 'ready') ? (
          <Button 
            className="w-full h-9 bg-[#18385F] hover:bg-[#12294a] text-white" 
            onClick={handlePublish}
            disabled={isPublishing}
          >
            {isPublishing ? "Publishing..." : "Publish Run"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
