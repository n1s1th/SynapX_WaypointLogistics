"use client";
import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { LiveRun } from "@/app/dispatcher/live-tracking/page";

interface SyncDegradedDialogProps {
  open: boolean;
  run: LiveRun;
  onClose: () => void;
  onReviewConflict: () => void;
}

export function SyncDegradedDialog({ open, run, onClose, onReviewConflict }: SyncDegradedDialogProps) {
  const handleContactDriver = () => {
    toast.info("Contacting driver...");
  };

  const handleReviewSyncQueue = () => {
    if (run.sync_status === "conflict") {
      onClose();
      onReviewConflict();
    } else {
      toast.info("No conflicts in sync queue.");
    }
  };

  const queuedCount = Math.ceil((run.last_update_mins || 0) / 3);
  const stops = run.stop_sequence || [];
  const lastKnownStop = run.stops_completed > 0 ? (typeof stops[run.stops_completed - 1] === 'string' ? stops[run.stops_completed - 1] : (stops[run.stops_completed - 1] as any).name || `Stop ${run.stops_completed}`) : "—";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100">
          <div className="mb-1">
            <DialogTitle className="text-xl font-bold text-slate-900">Field Sync Degraded</DialogTitle>
          </div>
          <DialogDescription className="text-slate-500 text-sm mb-4">
            The driver can keep working, but the dispatcher is viewing stale field data.
          </DialogDescription>
          
          <div className="flex gap-2 items-center">
             <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-[4px] uppercase tracking-wide">Offline</span>
             <span className="text-sm font-bold text-slate-900">{run.vehicle_number} · {run.trip_code}</span>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Data Table */}
          <div className="space-y-3">
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Last sync</span>
                <span className="font-bold text-slate-900">{run.updated_at ? new Date(run.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Offline for</span>
                <span className="font-bold text-amber-600">{run.last_update_mins} min</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Queued updates</span>
                <span className="font-bold text-slate-900">{queuedCount}</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Last known stop</span>
                <span className="font-bold text-slate-900">{lastKnownStop as string}</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Location age</span>
                <span className="font-bold text-amber-600">{run.last_update_mins} min</span>
             </div>
          </div>

          <hr className="border-slate-100" />

          {/* Degraded mode visibility */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-wide">Degraded-mode visibility</h4>
            <div className="space-y-2">
              <div className="bg-amber-50 border border-amber-100 rounded-[8px] p-3">
                <p className="text-sm font-bold text-amber-800 mb-0.5">Map position is stale</p>
                <p className="text-xs text-amber-700/80">Last confirmed GPS point shows with stale-data warning</p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-[8px] p-3">
                <p className="text-sm font-bold text-amber-800 mb-0.5">Delivery updates queued</p>
                <p className="text-xs text-amber-700/80">Field outcomes will reconcile when connectivity returns</p>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-[8px] p-3">
                <p className="text-sm font-bold text-amber-800 mb-0.5">Dispatcher plan remains active</p>
                <p className="text-xs text-amber-700/80">New plan changes may conflict with offline driver actions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-white">
          <Button variant="ghost" className="text-slate-500 hover:text-slate-700" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="bg-white border-slate-200" onClick={handleContactDriver}>
              Contact Driver
            </Button>
            <Button 
              className="bg-[#18385F] hover:bg-[#1a3f6b] text-white font-semibold"
              onClick={handleReviewSyncQueue}
            >
              Review Sync Queue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
