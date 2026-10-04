"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ConstraintCheck, VehicleRecommendation } from "@/types/allocation";
import { RoutePlanDetails } from "@/components/dispatcher/RoutePlanDetails";
import { constraintLabels } from "@/lib/allocation-readiness";

function ConstraintResultRow({ name, check }: { name: string; check: ConstraintCheck }) {
  const value = (input: unknown) => input == null ? "?" : String(input);
  const detail = name === "weight" || name === "volume"
    ? `${value(check.required)} / ${value(check.capacity)} ${value(check.unit)}`
    : name === "trips_today" && check.trips_on_date !== undefined
      ? `${check.trips_on_date} / ${check.maximum}`
      : check.message;
  const status = check.status === "unknown" ? "WARNING" : check.status.toUpperCase();
  const tone = check.status === "pass" ? "text-success bg-success-muted" : check.status === "fail" ? "text-destructive bg-destructive-muted" : "text-warning bg-warning-muted";
  return <div className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5 text-xs">
    <div><div className="font-semibold">{constraintLabels[name] ?? name.replaceAll("_", " ")}</div><div className="text-muted-foreground">{detail}</div>
      {name === "fuel" && typeof check.projected_liters === "number" && <div className="text-muted-foreground">Estimated route use: {check.projected_liters} L · Weekly quota: {value(check.quota_l)} L</div>}
      {check.status === "unknown" && check.blocking === false && <div className="text-muted-foreground">Does not block allocation.</div>}
    </div>
    <span className={`shrink-0 rounded px-2 py-0.5 font-bold ${tone}`}>{status}</span>
  </div>;
}

export function RoutePreview({ vehicle, depot }: { vehicle: VehicleRecommendation; depot: string }) {
  const route = vehicle.route_summary;
  return <section className="space-y-1 text-xs" aria-label="Route preview">
    <h3 className="font-semibold text-sm">Route preview</h3>
    <p className="font-medium">{[`${depot} DC`, ...route.ordered_outlet_codes].join(" → ")}</p>
    <RoutePlanDetails route={route} />
  </section>;
}

export function ConstraintReviewModal({ isOpen, onClose, onConfirm, onAdjustOrders, vehicle, depot, isSubmitting, error }: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onAdjustOrders: () => void;
  vehicle: VehicleRecommendation | null;
  depot: string;
  isSubmitting: boolean;
  error: string | null;
}) {
  if (!vehicle) return null;
  return <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="sm:max-w-[540px] max-h-[88vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Review allocation constraints</DialogTitle></DialogHeader>
      <p className="text-sm font-semibold">{vehicle.vehicle_code}</p>
      <RoutePreview vehicle={vehicle} depot={depot} />
      <section className="space-y-2"><h3 className="font-semibold text-sm">Constraint checks</h3>
        {Object.entries(vehicle.constraints).map(([name, check]) => <ConstraintResultRow key={name} name={name} check={check} />)}
      </section>
      <div className="text-sm font-semibold">Overall: {vehicle.eligible ? "COMPATIBLE" : "INCOMPATIBLE"}</div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onAdjustOrders}>Adjust orders</Button>
        <Button variant="outline" onClick={onClose}>Choose another vehicle</Button>
        <Button onClick={onConfirm} disabled={!vehicle.eligible || isSubmitting}>{isSubmitting ? "Allocating…" : "Confirm allocation"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
