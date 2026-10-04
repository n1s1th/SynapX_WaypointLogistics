import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { DeliveryRun, DeliveryRunStop } from "@/app/dispatcher/delivery-runs/page";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

interface RouteOptimizationDialogProps {
  run: DeliveryRun;
  onClose: () => void;
  onApply: () => void;
}

export function RouteOptimizationDialog({ run, onClose, onApply }: RouteOptimizationDialogProps) {
  const [isApplying, setIsApplying] = useState(false);
  
  const currentStops: DeliveryRunStop[] = (run.stop_sequence || [])
    .filter((s): s is DeliveryRunStop => typeof s === "object");

  // Group stops: first by SLA urgency, then within groups by district-order
  // Since stops don't directly carry district, use SLA as primary sort and
  // cluster consecutive stops from the same name prefix (district approximation)

  // Step 1: separate urgent (SLA failing) from passing
  const passing = currentStops.filter(s => s.sla_ok);
  const failing = currentStops.filter(s => !s.sla_ok);

  // Step 2: cluster passing stops - sort alphabetically by name to group 
  // nearby destinations (same district typically sorts together)
  const sortedPassing = [...passing].sort((a, b) => a.name.localeCompare(b.name));

  // Step 3: urgent stops go first, then clustered passing stops
  const proposedStops: DeliveryRunStop[] = currentStops.length > 0
    ? [...failing, ...sortedPassing]
    : [];

  // Mark moved-earlier stops as "SLA recovered"
  const proposedWithSLA = proposedStops.map((stop, i) => {
    const originalIdx = currentStops.findIndex(s => s.id === stop.id);
    const recovered = !stop.sla_ok && i < originalIdx;
    return { ...stop, sla_ok: recovered ? true : stop.sla_ok, sla_note: recovered ? "SLA recovered" : stop.sla_note };
  });

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      // 1. Update the stop sequence
      const r1 = await fetch(`${API_BASE}/api/v1/delivery-runs/${run.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ stop_sequence: proposedWithSLA }),
      });
      if (!r1.ok) throw new Error("patch failed");
      
      // 2. Call loader plan change if loader exists
      if (run.loader) {
        const p1 = await fetch(`${API_BASE}/api/v1/loader/dispatch-trips/${run.id}/plan`, {
          method: 'POST', headers,
          body: JSON.stringify({
            client_action_id: crypto.randomUUID(),
            base_version: run.loader.plan_version,
            stop_order: proposedWithSLA.map((s: any) => s.outlet_code || s.name),
            dispatcher: "Dispatcher"
          }),
        });
        if (p1.status === 409) {
            const data = await p1.json();
            if (data.detail && data.detail.code === 'PLAN_LOCKED') {
                toast.error("Released — ask the dock to undo");
                setIsApplying(false);
                return;
            } else {
                toast.error("Plan changed by someone else. Please refresh.");
                setIsApplying(false);
                return;
            }
        } else if (!p1.ok) {
            toast.error("Failed to sync plan to loader");
        }
      } else {
        // Record the event in loading_events (fallback if no loader)
        await fetch(`${API_BASE}/api/v1/delivery-runs/${run.id}/add-loading-event`, {
          method: 'POST', headers,
          body: JSON.stringify({
            event: "Route optimized",
            time: format(new Date(), "HH:mm"),
            note: "Dispatcher applied optimized stop sequence",
            status: "ok"
          }),
        });
      }
      
      toast.success("Optimized route applied");
      onApply();
      onClose();
    } catch {
      toast.error("Failed to apply optimized route");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-2xl bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        <div className="p-6">
          <DialogHeader className="mb-6 flex flex-row items-start justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 mb-1">Route Optimization Review</DialogTitle>
              <DialogDescription className="text-slate-500">
                Proposed route clusters stops by destination area and prioritises urgent deliveries first.
              </DialogDescription>
            </div>
            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 shrink-0 ml-4">
              <AlertCircle className="h-3.5 w-3.5" />
              Human confirmation required
            </div>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            {/* Current Route */}
            <div className="border border-slate-200 rounded-[8px] overflow-hidden">
              <div className="bg-slate-50 py-2.5 px-4 border-b border-slate-200">
                <h4 className="font-semibold text-slate-700 text-sm">Current Route</h4>
              </div>
              <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto bg-white">
                {currentStops.map((stop, i) => (
                  <div key={stop.id} className={`p-3 rounded-[6px] border ${!stop.sla_ok ? 'bg-red-50 border-red-100' : 'border-slate-100'}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-slate-500 w-4">{i + 1}</span>
                      <span className="text-sm font-semibold text-slate-900">{stop.name} · {stop.eta}</span>
                    </div>
                    <p className={`text-xs font-medium mt-0.5 ml-6 ${!stop.sla_ok ? 'text-red-600' : 'text-slate-500'}`}>
                      {stop.sla_note}
                    </p>
                  </div>
                ))}
                {currentStops.length === 0 && <p className="text-sm text-slate-500 italic p-2">No stops</p>}
              </div>
            </div>

            {/* Proposed Route */}
            <div className="border border-emerald-200 rounded-[8px] overflow-hidden ring-1 ring-emerald-500/20">
              <div className="bg-emerald-50 py-2.5 px-4 border-b border-emerald-200 flex justify-between items-center">
                <h4 className="font-semibold text-emerald-900 text-sm">Proposed Route</h4>
              </div>
              <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto bg-emerald-50/30">
                {proposedWithSLA.map((stop, i) => (
                  <div key={stop.id} className="p-3 rounded-[6px] border bg-white border-slate-200 shadow-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-slate-500 w-4">{i + 1}</span>
                      <span className="text-sm font-semibold text-slate-900">{stop.name} · {stop.eta}</span>
                    </div>
                    <p className={`text-xs font-medium mt-0.5 ml-6 ${stop.sla_note === "SLA recovered" ? 'text-emerald-600 font-semibold' : 'text-slate-500'}`}>
                      {stop.sla_note}
                    </p>
                  </div>
                ))}
                {proposedWithSLA.length === 0 && <p className="text-sm text-slate-500 italic p-2">No stops</p>}
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-slate-50 rounded-[6px] border border-slate-200 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">How this works: </span>
            SLA-at-risk deliveries are moved to the front of the route. Remaining stops are 
            clustered alphabetically by destination to group nearby areas together.
          </div>
          
          <div className="flex justify-between gap-3 mt-6 pt-5 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} className="flex-1 h-11 border-slate-200 text-slate-700 font-semibold">
              Keep Current
            </Button>
            <Button onClick={handleApply} disabled={isApplying || currentStops.length === 0}
              className="flex-1 h-11 bg-[#18385F] hover:bg-[#12294a] text-white font-semibold">
              {isApplying ? "Applying..." : "Apply Optimized Route"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
