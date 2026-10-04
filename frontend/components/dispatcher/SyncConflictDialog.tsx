"use client";
import React, { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LiveRun } from "@/app/dispatcher/live-tracking/page";

interface SyncConflictDialogProps {
  open: boolean;
  run: LiveRun;
  onClose: () => void;
  onBack: () => void;
  onResolve: (choice: "field" | "dispatcher") => Promise<void>;
}

export function SyncConflictDialog({ open, run, onClose, onBack, onResolve }: SyncConflictDialogProps) {
  const [choice, setChoice] = useState<"field" | "dispatcher" | null>(null);

  const stops = run.stop_sequence || [];
  const currentStop = stops[run.stops_completed] ? (typeof stops[run.stops_completed] === 'string' ? stops[run.stops_completed] : (stops[run.stops_completed] as any).name || `Stop ${run.stops_completed + 1}`) : "—";
  const updatedTime = run.updated_at ? new Date(run.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";
  const departTime = run.departure_time ? new Date(run.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { setChoice(null); onClose(); } }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100">
          <div className="mb-1">
            <DialogTitle className="text-xl font-bold text-slate-900">Sync Conflict</DialogTitle>
          </div>
          <DialogDescription className="text-slate-500 text-sm mb-4">
            A field update was recorded offline against a run that changed while the driver had no connection.
          </DialogDescription>
          
          <div className="flex gap-2 items-center">
             <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 text-red-800 rounded-[4px] uppercase tracking-wide">Conflict</span>
             <span className="text-sm font-bold text-slate-900">{run.trip_code} · {currentStop as string}</span>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Conflicting records */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-[8px] p-3">
             <p className="text-sm font-bold text-emerald-800 mb-0.5">Driver record</p>
             <p className="text-xs text-emerald-700/80">Delivered at {updatedTime} while offline · POD captured locally</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-[8px] p-3">
             <p className="text-sm font-bold text-amber-800 mb-0.5">Dispatcher change</p>
             <p className="text-xs text-amber-700/80">Stop removed from run at {departTime} after outlet contact</p>
          </div>

          <p className="text-sm font-bold text-slate-900 pt-2">Choose the record that should become authoritative.</p>
          
          {/* Selection */}
          <div className="space-y-3">
             <button 
               onClick={() => setChoice("field")}
               className={`w-full text-left p-3 rounded-[8px] border transition-all ${
                 choice === "field" ? "border-[#18385F] bg-blue-50/20 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
               }`}
             >
                <p className="text-sm font-bold text-slate-900 mb-0.5">Keep field outcome</p>
                <p className="text-xs text-slate-500">Accept delivery as completed and reconcile the run history</p>
             </button>
             <button 
               onClick={() => setChoice("dispatcher")}
               className={`w-full text-left p-3 rounded-[8px] border transition-all ${
                 choice === "dispatcher" ? "border-[#18385F] bg-blue-50/20 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
               }`}
             >
                <p className="text-sm font-bold text-slate-900 mb-0.5">Apply dispatcher plan</p>
                <p className="text-xs text-slate-500">Reject the offline delivery outcome and keep stop removal</p>
             </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-white">
          <Button variant="ghost" className="text-slate-500 hover:text-slate-700" onClick={onBack}>
            Back to Sync Queue
          </Button>
          <Button 
            className="bg-[#18385F] hover:bg-[#1a3f6b] text-white font-semibold"
            disabled={!choice}
            onClick={() => choice && onResolve(choice)}
          >
            Resolve Conflict
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
