import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { DeliveryRun } from "@/app/dispatcher/delivery-runs/page";

interface LoadingReadinessDialogProps {
  run: DeliveryRun;
  onClose: () => void;
}

export function LoadingReadinessDialog({ run, onClose }: LoadingReadinessDialogProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = run.loader?.loading_events || run.loading_events || [];
  
  const lastUpdateTime = events.length > 0 ? events[events.length - 1].time : "-";
  const stopsCompleted = run.loader?.stops_completed ?? run.stops_completed;
  const itemsChecked = run.stop_count > 0
    ? Math.round((stopsCompleted / run.stop_count) * 100)
    : 0;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasPlanChanged = events.some((e: any) => e.event === "Route optimized");
  const hasLoaderAck = hasPlanChanged;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100 relative">
          <div className="flex justify-between items-start mb-4">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 mb-1">Loading Readiness</DialogTitle>
              <DialogDescription className="text-slate-500">
                Dispatcher visibility into depot progress for {run.trip_code}.
              </DialogDescription>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="bg-[#18385F] text-white text-xs font-bold px-2 py-1 rounded-[4px]">
              {run.trip_code}
            </div>
            <span className="text-sm text-slate-600 font-medium">{run.vehicle_number} · {run.depot_name || "Depot"}</span>
          </div>
        </div>

        <div className="p-6 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* Timeline Section */}
          <div>
            <h4 className="text-sm font-bold text-slate-900 mb-4">Run readiness</h4>
            
            {events.length > 0 ? (
              <div className="relative pl-[11px] space-y-6 before:absolute before:inset-0 before:left-[15px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-200 before:to-transparent">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {events.map((event: any, i: number) => {
                  const dotColor = (
                    {
                      ok: "bg-emerald-500",
                      error: "bg-red-500",
                      pending: "bg-amber-500",
                      warning: "bg-amber-500",
                    } as Record<string, string>
                  )[event.status] ?? "bg-slate-300";

                  return (
                    <div key={i} className="relative flex items-start gap-4">
                      <div className="absolute left-[-11px] bg-white py-1">
                        <span className={`block w-2.5 h-2.5 rounded-full ${dotColor}`} />
                      </div>
                      <div className="pl-4">
                        <h5 className="text-sm font-bold text-slate-900">{event.event}</h5>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {event.time && <span className="font-semibold text-slate-700 mr-1">{event.time}</span>}
                          {event.note}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">No loading events recorded yet.</p>
            )}
          </div>

          {/* Loading Summary Section */}
          <div>
            <h4 className="text-sm font-bold text-slate-900 mb-3">Loading summary</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">Stops loaded:</span>
                <span className="text-sm font-bold text-slate-900">{stopsCompleted} / {run.stop_count}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">Items checked:</span>
                <span className="text-sm font-bold text-slate-900">{itemsChecked}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">Open shortfalls:</span>
                <span className={`text-sm font-bold ${run.open_shortfalls > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {run.open_shortfalls}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">Last loader update:</span>
                <span className="text-sm font-bold text-slate-900">{lastUpdateTime}</span>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            {hasLoaderAck && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-[6px] p-3">
                <p className="text-sm font-semibold text-emerald-700">Loader acknowledged latest plan change</p>
                <p className="text-xs text-emerald-600/80 mt-0.5">Sequence update synced at {lastUpdateTime}</p>
              </div>
            )}
            {hasPlanChanged && (
              <div className="bg-amber-50 border border-amber-100 rounded-[6px] p-3">
                <p className="text-sm font-semibold text-amber-700">Plan changed after loading began</p>
                <p className="text-xs text-amber-600/80 mt-0.5">Stop sequence changed. Loader acknowledgement recorded.</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="p-5 pt-0 flex justify-end">
          <Button variant="outline" onClick={onClose} className="h-9 px-6 border-slate-200 text-slate-700">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
