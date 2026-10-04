"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DeliveryRun } from "@/app/dispatcher/delivery-runs/page";
import type { RouteComparison } from "@/types/allocation";
import { applyRoute, previewRoute } from "@/lib/route-planning-api";
import { ApiError } from "@/lib/api";
import { RoutePlanDetails } from "./RoutePlanDetails";

export function RouteOptimizationDialog({ run, onClose, onApply }: {
  run: DeliveryRun; onClose: () => void; onApply: () => void;
}) {
  const [comparison, setComparison] = useState<RouteComparison | null>(null);
  const [stopOrder, setStopOrder] = useState<string[] | undefined>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    previewRoute(run.id, stopOrder).then((data) => {
      if (active) { setComparison(data); actionId.current = null; }
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : "Could not calculate route.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [run.id, stopOrder, refresh]);

  const moveStop = (index: number, direction: -1 | 1) => {
    if (!comparison) return;
    const next = [...comparison.proposed.ordered_outlet_codes];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setLoading(true);
    setError(null);
    setStopOrder(next);
  };

  const recalculate = () => {
    setLoading(true);
    setError(null);
    setStopOrder(undefined);
    setRefresh((value) => value + 1);
  };

  const handleApply = async () => {
    if (!comparison?.proposed.route_feasible || loading || applying || error) return;
    setApplying(true);
    actionId.current ??= crypto.randomUUID();
    try {
      await applyRoute(run.id, comparison, actionId.current);
      toast.success("Route applied. Loader plan updated.");
      onApply();
      onClose();
    } catch (err) {
      const violations = err instanceof ApiError && Array.isArray(err.details.violations)
        ? (err.details.violations as { message: string }[]).map((item) => item.message).join(" ") : "";
      setError(violations || (err instanceof Error ? err.message : "Could not apply route."));
    } finally { setApplying(false); }
  };

  const changed = comparison && comparison.proposed.ordered_outlet_codes.join("|") !== comparison.current.ordered_outlet_codes.join("|");
  const distanceSaving = comparison && comparison.current.estimated_distance_km != null && comparison.proposed.estimated_distance_km != null
    ? comparison.current.estimated_distance_km - comparison.proposed.estimated_distance_km : null;
  const minutesSaving = comparison && comparison.current.scheduled_elapsed_minutes != null && comparison.proposed.scheduled_elapsed_minutes != null
    ? comparison.current.scheduled_elapsed_minutes - comparison.proposed.scheduled_elapsed_minutes : null;

  return <Dialog open onOpenChange={(open) => !open && !applying && onClose()}>
    <DialogContent showCloseButton={false} className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Route optimization review</DialogTitle>
        <DialogDescription>Review estimated arrival windows before publishing a new Loader plan. All times are Colombo time.</DialogDescription>
      </DialogHeader>
      {loading && <p role="status" className="text-sm text-muted-foreground">Calculating route and delivery windows…</p>}
      {error && <div role="alert" className="rounded-md bg-destructive-muted p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" disabled={loading || applying} onClick={recalculate}>Refresh preview</Button></div>}
      {comparison && <>
        <div className="grid gap-4 md:grid-cols-2" aria-busy={loading}>
          <section className="space-y-3 rounded-lg border border-border p-3"><h3 className="font-semibold">Current route</h3><RoutePlanDetails route={comparison.current} /></section>
          <section className="space-y-3 rounded-lg border border-primary p-3"><h3 className="font-semibold">Proposed route</h3>
            {!loading && <RoutePlanDetails route={comparison.proposed} onMove={moveStop} disabled={applying} />}
          </section>
        </div>
        {!loading && <div className="text-sm">
          <p>Savings: {distanceSaving == null ? "distance unavailable" : `${Number(distanceSaving.toFixed(2))} km`} · {minutesSaving == null ? "duration unavailable" : `${Number(minutesSaving.toFixed(1))} min`}</p>
          {!changed && <p className="text-muted-foreground">The current sequence already matches this proposal.</p>}
          {!comparison.proposed.route_feasible && <p className="text-destructive">Cannot apply: failed or unknown constraints must be resolved. There is no override for an invalid route.</p>}
          {comparison.proposed.violations.map((item, index) => <p key={index} className="text-xs text-destructive">{item.outlet_code}: {item.message}</p>)}
          {comparison.proposed.warnings.map((warning) => <p key={warning} className="text-xs text-muted-foreground mt-1">{warning}</p>)}
        </div>}
        <p className="text-xs text-muted-foreground">Uses delivery windows, service allowances and district travel estimates. Manual movements are recalculated before they can be applied.</p>
      </>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" disabled={applying} onClick={onClose}>Keep Current</Button>
        <Button onClick={handleApply} disabled={loading || applying || !!error || !changed || !comparison?.proposed.route_feasible}>{applying ? "Applying…" : "Apply Optimized Route"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
