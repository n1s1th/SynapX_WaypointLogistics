"use client";
import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { LiveRun } from "@/app/dispatcher/live-tracking/page";

interface RunOperationsDialogProps {
  open: boolean;
  run: LiveRun;
  onClose: () => void;
  onReviewException: () => void;
}

export function RunOperationsDialog({ open, run, onClose, onReviewException }: RunOperationsDialogProps) {
  const handleReviewException = () => {
    onClose();
    onReviewException();
  };

  const handleContactDriver = () => {
    toast.info("Contacting driver — feature requires telephony integration");
  };

  // Connectivity section
  const isDegraded = run.sync_status === "degraded";
  const isConflict = run.sync_status === "conflict";
  const queuedCount = isDegraded ? Math.ceil((run.last_update_mins || 0) / 3) : 0;
  
  // ETA Risk
  const isLate = (run.last_update_mins !== null && run.last_update_mins > 5) || run.open_shortfalls > 0;
  
  // Predict ETA (just adding last_update_mins if it exists)
  let predictedEtaStr = run.estimated_arrival ? new Date(run.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
  if (run.estimated_arrival && run.last_update_mins) {
     const dt = new Date(run.estimated_arrival);
     dt.setMinutes(dt.getMinutes() + run.last_update_mins);
     predictedEtaStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Delivery records
  const stops = run.stop_sequence || [];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100">
          <div className="mb-1">
            <DialogTitle className="text-xl font-bold text-slate-900">Run Operations</DialogTitle>
          </div>
          <DialogDescription className="text-slate-500 text-sm mb-4">
            Operational details for the selected active run.
          </DialogDescription>
          
          <div className="flex gap-2 items-center">
             <span className="text-xs font-bold px-2 py-1 bg-slate-100 text-slate-700 rounded-[4px]">{run.trip_code}</span>
             <span className="text-sm font-medium text-slate-600">{run.vehicle_number} · Active</span>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto max-h-[60vh] space-y-6">
          
          {/* Connectivity */}
          {(isDegraded || isConflict) && (
            <section>
              <h4 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wide">Connectivity</h4>
              {isDegraded && (
                <div className="bg-amber-50 border border-amber-100 rounded-[8px] p-3">
                  <p className="text-sm font-bold text-amber-800 mb-1">Driver device offline</p>
                  <p className="text-xs text-amber-700/80">
                    Last sync: {run.updated_at ? new Date(run.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"} · {queuedCount} updates waiting to reconcile
                  </p>
                </div>
              )}
              {isConflict && (
                <div className="bg-red-50 border border-red-100 rounded-[8px] p-3">
                  <p className="text-sm font-bold text-red-800 mb-1">Sync conflict detected</p>
                  <p className="text-xs text-red-700/80">
                    A field update was recorded offline against a run that changed while the driver had no connection.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Current Run */}
          <section>
             <h4 className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-wide">Current run</h4>
             <div className="space-y-2">
                <div className="flex items-start">
                   <span className="w-1/3 text-sm text-slate-500">Next stop</span>
                   <span className="w-2/3 text-sm font-bold text-slate-900">
                     {stops[run.stops_completed] ? (typeof stops[run.stops_completed] === 'string' ? stops[run.stops_completed] as string : (stops[run.stops_completed] as { name?: string }).name || `Stop ${run.stops_completed + 1}`) : "—"}
                   </span>
                </div>
                <div className="flex items-start">
                   <span className="w-1/3 text-sm text-slate-500">Planned ETA</span>
                   <span className="w-2/3 text-sm font-bold text-slate-900">
                     {run.estimated_arrival ? new Date(run.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                   </span>
                </div>
                <div className="flex items-start">
                   <span className="w-1/3 text-sm text-slate-500">Predicted ETA</span>
                   <span className={`w-2/3 text-sm font-bold ${isLate ? "text-red-600" : "text-slate-900"}`}>
                     {predictedEtaStr}
                   </span>
                </div>
                <div className="flex items-start">
                   <span className="w-1/3 text-sm text-slate-500">ETA risk</span>
                   <span className={`w-2/3 text-sm font-bold ${isLate ? "text-red-600" : "text-emerald-600"}`}>
                     {isLate ? `High · +${run.last_update_mins || 0} min` : "On track"}
                   </span>
                </div>
                <div className="flex items-start">
                   <span className="w-1/3 text-sm text-slate-500">Progress</span>
                   <span className="w-2/3 text-sm font-bold text-slate-900">
                     {run.stops_completed} / {run.stop_count} stops
                   </span>
                </div>
             </div>
          </section>

          {/* Delivery records */}
          <section>
            <h4 className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-wide">Delivery records</h4>
            {stops.length === 0 ? (
              <p className="text-sm text-slate-500">No delivery records available.</p>
            ) : (
              <div className="space-y-4">
                {stops.map((stop, i) => {
                  const name = typeof stop === 'string' ? stop : stop.name || `Stop ${i + 1}`;
                  
                  // Dot color logic
                  let dotColor = "bg-[#18385F]";
                  let statusText = "Pending";
                  let isDone = false;

                  if (i < run.stops_completed) {
                    isDone = true;
                    // Simulate the last completed as pending sync if degraded
                    if (isDegraded && i === run.stops_completed - 1) {
                      dotColor = "bg-amber-500";
                      statusText = "Delivered · POD pending sync";
                    } else {
                      dotColor = "bg-emerald-500";
                      statusText = "Delivered · POD synced";
                    }
                  } else if (i === run.stops_completed) {
                    if (run.open_shortfalls > 0) {
                      dotColor = "bg-red-500";
                      statusText = "Next stop · late-arrival risk";
                    } else {
                      dotColor = "bg-[#18385F]";
                      statusText = "Next stop";
                    }
                  }

                  if (i > run.stops_completed) {
                     return null; // hide future stops to match Figma
                  }

                  return (
                    <div key={i} className="flex gap-3">
                      <div className="pt-1">
                        <div className={`size-2.5 rounded-full ${dotColor}`} />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isDone ? "text-slate-600" : "text-slate-900"}`}>{name}</p>
                        <p className="text-xs text-slate-500">{statusText}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-between gap-3 bg-slate-50">
          <Button variant="outline" className="flex-1 bg-white" onClick={handleContactDriver}>
            Contact Driver
          </Button>
          <Button 
            className="flex-1 bg-[#18385F] hover:bg-[#1a3f6b] text-white font-semibold"
            disabled={!(isDegraded || isConflict)}
            onClick={handleReviewException}
          >
            Review Exception
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
