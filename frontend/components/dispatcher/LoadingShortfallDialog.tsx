import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { DeliveryRun } from "@/app/dispatcher/delivery-runs/page";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

interface LoadingShortfallDialogProps {
  run: DeliveryRun;
  onClose: () => void;
  onAction: () => void;
}

interface DockIssue {
  id: number;
  status: string;
  outlet_code?: string | null;
  order_number: string;
  issue_type: string;
  units_affected?: number | null;
  units_total?: number | null;
  decide_by?: string | null;
  note?: string | null;
  options: { id: number; label: string; detail?: string | null; is_default: boolean }[];
}

export function LoadingShortfallDialog({ run, onClose, onAction }: LoadingShortfallDialogProps) {
  const [issues, setIssues] = useState<DockIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const dockCode = run.loader?.dock;
  
  useEffect(() => {
    const fetchIssues = async () => {
      if (!dockCode) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/v1/loader/issues?dock=${encodeURIComponent(dockCode)}&run=${encodeURIComponent(run.trip_code)}`);
        if (!res.ok) throw new Error(`Dock flags request failed (${res.status})`);
        const data: DockIssue[] = await res.json();
        setIssues(data.filter(i => i.status === "sent" || i.status === "seen"));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load dock flags");
      } finally {
        setLoading(false);
      }
    };
    fetchIssues();
  }, [dockCode, run.trip_code]);

  const handleDecision = async (issueId: number, optionId: number, optionLabel: string) => {
    setResolving(`${issueId}-${optionId}`);
    try {
      const res = await fetch(`${API_BASE}/api/v1/loader/issues/${issueId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option: optionId,
          note: "Dispatcher applied decision",
          client_action_id: crypto.randomUUID(),
          decided_by: "Dispatcher"
        })
      });
      if (res.ok) {
        toast.success("Decision sent to dock");

        if (optionLabel.toLowerCase().includes("hold") && run.departure_time) {
            const newDepTime = new Date(new Date(run.departure_time).getTime() + 30 * 60000);
            
            const planRes = await fetch(`${API_BASE}/api/v1/delivery-runs/${run.id}/plan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: {
                    client_action_id: crypto.randomUUID(),
                    base_version: run.loader?.plan_version ?? 1,
                    departs_at: newDepTime.toISOString(),
                    dispatcher: "Dispatcher"
                  } })
            });
            if (!planRes.ok) {
              toast.error("Decision saved, but departure was not changed. Refresh the run and try again.");
              onAction();
              onClose();
              return;
            }
            toast.success("Departure held by 30 minutes");
        }

        onAction();
        onClose();
      } else if (res.status === 409) {
        const data = await res.json();
        if (data.detail && data.detail.code === "INVALID_STATE_TRANSITION") {
          toast.error("Run has already gated out");
        } else {
          toast.error("Issue already decided or locked");
        }
      } else {
        toast.error("Failed to submit decision");
      }
    } catch {
      toast.error("Error connecting to server");
    } finally {
      setResolving(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl bg-white border-0 p-0 rounded-[10px] overflow-hidden">
        
        <div className="p-6">
          <DialogHeader className="mb-5 flex flex-row items-start justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 mb-1 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Loading Exceptions
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Unresolved dock flags for {run.trip_code}
              </DialogDescription>
            </div>
            <div className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider shrink-0 ml-4">
              ACTION REQUIRED
            </div>
          </DialogHeader>

          {loading ? (
            <div className="py-8 text-center text-slate-500">Loading dock flags...</div>
          ) : loadError ? (
            <div role="alert" className="py-8 text-center text-destructive">{loadError}</div>
          ) : !run.loader ? (
            <div className="py-8 text-center text-muted-foreground">This run has not been sent to a dock.</div>
          ) : issues.length === 0 ? (
            <div className="py-8 text-center text-slate-500">No open dock flags found.</div>
          ) : (
            <div className="space-y-6 max-h-[60vh] overflow-y-auto">
              {issues.map(issue => (
                <div key={issue.id} className="border border-slate-200 rounded-[8px] overflow-hidden">
                  <div className="bg-slate-50 p-4 border-b border-slate-200">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-bold text-slate-900">{issue.outlet_code || 'Store'} · Order {issue.order_number}</h4>
                        <p className="text-sm text-red-600 font-semibold mt-1 capitalize">
                          {issue.issue_type}: {issue.units_affected} of {issue.units_total} units
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 font-medium">Decide by</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {issue.decide_by ? format(new Date(issue.decide_by), "HH:mm") : "-"}
                        </p>
                      </div>
                    </div>
                    {issue.note && (
                      <div className="bg-white border border-slate-200 rounded p-2 text-sm text-slate-600 mt-2">
                        <span className="font-medium text-slate-700">Dock note:</span> {issue.note}
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-3 bg-white">
                    <h5 className="text-sm font-bold text-slate-700 mb-2">Resolution Options:</h5>
                    <div className="flex flex-col gap-2">
                      {issue.options.map(opt => (
                        <div key={opt.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-[6px] hover:border-slate-300 transition-colors">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                              {opt.label}
                              {opt.is_default && <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Default</span>}
                            </p>
                            {opt.detail && <p className="text-xs text-slate-500 mt-0.5">{opt.detail}</p>}
                          </div>
                          <Button 
                            size="sm"
                            disabled={resolving !== null}
                            onClick={() => handleDecision(issue.id, opt.id, opt.label)}
                            className={opt.is_default ? "bg-[#18385F] hover:bg-[#12294a] text-white" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}
                          >
                            {resolving === `${issue.id}-${opt.id}` ? "Applying..." : "Select"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 flex justify-end">
            <Button onClick={onClose} variant="outline" className="h-10 px-6 border-slate-200 text-slate-700">
              Close
            </Button>
          </div>
          
        </div>
      </DialogContent>
    </Dialog>
  );
}
