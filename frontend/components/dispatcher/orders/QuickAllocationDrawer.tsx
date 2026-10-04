"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAllocation, getAllocationRecommendation } from "@/lib/allocation-api";
import type { Order } from "@/types/order";
import type { AllocationRecommendation, VehicleRecommendation } from "@/types/allocation";
import { ConstraintReviewModal } from "./ConstraintReviewModal";
import { AllocationBlockers } from "./AllocationBlockers";

function RecommendationVehicleCard({ vehicle, selected, onSelect }: {
  vehicle: VehicleRecommendation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { weight, volume, trips_today, fuel, driver, access, delivery_windows } = vehicle.constraints;
  const value = (input: unknown) => input == null ? "?" : String(input);
  const fuelLabel = fuel?.status === "fail" ? "FAIL" : fuel?.status === "pass" ? "PASS" : "WARNING";
  const driverLabel = driver?.status === "pass" ? "PASS" : driver?.status === "fail" ? "FAIL" : "WARNING";
  return <button type="button" disabled={!vehicle.eligible} onClick={onSelect}
    aria-pressed={selected}
    className={`w-full text-left rounded-lg border p-3 space-y-1 text-xs focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-accent" : "border-border bg-card"} ${vehicle.eligible ? "hover:border-primary" : "opacity-70 cursor-not-allowed"}`}>
    <div className="flex justify-between gap-2 font-semibold text-sm"><span>{vehicle.vehicle_code}</span>
      <span>{vehicle.eligible ? `${vehicle.recommendation_level.replaceAll("_", " ")} · ${vehicle.recommendation_score}%` : "INELIGIBLE"}</span></div>
    <div className="text-muted-foreground">Weight: {value(weight?.required)} / {value(weight?.capacity)} kg · Volume: {value(volume?.required)} / {value(volume?.capacity)} m³</div>
    <div className="text-muted-foreground">Trips: {value(trips_today?.trips_on_date)} / {value(trips_today?.maximum)}</div>
    <div className={fuel?.status === "fail" ? "text-destructive" : "text-warning"}>Fuel quota: {fuelLabel} · {fuel?.message ?? "Not verified"}</div>
    <div className={driver?.status === "pass" ? "text-muted-foreground" : "text-warning"}>Driver: {driverLabel} · {driver?.message ?? "Not assigned"}</div>
    <div className="text-muted-foreground">Access: {access?.status ?? "unknown"} · Windows: {delivery_windows?.status ?? "unknown"}</div>
    <div>{vehicle.eligible ? `Why recommended: ${vehicle.reasons.join(" ") || "All required constraints pass."}` : vehicle.reasons.join(" · ") || Object.values(vehicle.constraints).filter((check) => check.status !== "pass").map((check) => check.message).join(" · ")}</div>
  </button>;
}

const eligibleOrder = (order: Order) =>
  (order.status === "CONFIRMED" || order.status === "SUBMITTED") && !order.allocation_id && !order.is_late;

export function QuickAllocationDrawer({ isOpen, onClose, initialOrderIds, onAllocationSuccess }: {
  isOpen: boolean;
  onClose: () => void;
  initialOrderIds: number[];
  onAllocationSuccess: (vehicleCode: string, count: number) => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderIds, setOrderIds] = useState<number[]>(initialOrderIds);
  const [departure, setDeparture] = useState("");
  const [recommendation, setRecommendation] = useState<AllocationRecommendation | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    apiFetch<Order[]>("/orders/?is_late=false&limit=1000").then((data) => {
      if (!active) return;
      setOrders(data);
      const day = data.find((order) => initialOrderIds.includes(order.id))?.operating_date;
      setDeparture(day ? `${day}T06:00` : "");
    }).catch((err) => { if (active) { setError(err instanceof Error ? err.message : "Could not load orders."); setLoading(false); } });
    return () => { active = false; };
  }, [isOpen, initialOrderIds]);

  const departureTime = departure ? `${departure}:00+05:30` : "";
  useEffect(() => {
    if (!isOpen || orderIds.length === 0 || !departureTime) {
      return;
    }
    let active = true;
    getAllocationRecommendation(orderIds, departureTime).then((data) => {
      if (!active) return;
      setRecommendation(data);
      setError(null);
      setSelectedVehicleId((id) => data.vehicles.some((v) => v.vehicle_id === id && v.eligible) ? id : null);
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load recommendations."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen, orderIds, departureTime, refresh]);

  const selectedOrders = useMemo(() => orders.filter((order) => orderIds.includes(order.id)), [orders, orderIds]);
  const selectedVehicle = recommendation?.vehicles.find((vehicle) => vehicle.vehicle_id === selectedVehicleId) ?? null;
  const eligibleVehicles = recommendation?.vehicles.filter((vehicle) => vehicle.eligible) ?? [];
  const blockedVehicles = recommendation?.vehicles.filter((vehicle) => !vehicle.eligible) ?? [];
  const firstOrder = selectedOrders[0];
  const addableOrders = orders.filter((order) => eligibleOrder(order) && !orderIds.includes(order.id) && firstOrder &&
    order.brand === firstOrder.brand && order.district === firstOrder.district && order.operating_date === firstOrder.operating_date);
  const groupError = recommendation?.group_violations.map((violation) => violation.message).join(" ");
  const groupContext = selectedOrders.map((order) => `${order.order_number}: ${order.brand ?? "unknown brand"} / ${order.district ?? "unknown district"} / ${order.operating_date ?? "unknown date"}`).join("; ");

  async function handleConfirm() {
    if (!selectedVehicle?.eligible || !departureTime || !recommendation || groupError) return;
    setSubmitting(true);
    setConfirmationError(null);
    try {
      await confirmAllocation(orderIds, selectedVehicle.vehicle_id, departureTime, selectedVehicle.route_summary.route_fingerprint);
      setReviewOpen(false);
      onAllocationSuccess(selectedVehicle.vehicle_code, orderIds.length);
      onClose();
    } catch (err) {
      const violations = err instanceof ApiError && Array.isArray(err.details.violations)
        ? (err.details.violations as { message: string }[]).map((item) => item.message).join(" ") : "";
      setConfirmationError(violations || (err instanceof Error ? err.message : "Allocation failed."));
      setReviewOpen(false);
      setLoading(true);
      setRecommendation(null);
      setRefresh((count) => count + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <Dialog open={isOpen && !reviewOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[540px] max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Allocate selected orders</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Review the order group, departure and ranked vehicles.</p>
        {recommendation?.order_group.required_vehicle_type === "van" && <p className="rounded-md border border-warning/30 bg-warning-muted p-2 text-xs text-warning">
          <strong>{recommendation.order_group.required_temperature === "chilled" ? "Reefer van required" : "Van required"}</strong>
          {" · "}{recommendation.order_group.van_only_outlets?.join(", ")}. Trucks / lorries cannot access these outlets.
        </p>}
        <label className="text-xs font-semibold" htmlFor="allocation-departure">Departure time (Colombo)</label>
        <Input id="allocation-departure" type="datetime-local" value={departure} onChange={(event) => { setDeparture(event.target.value); setRecommendation(null); setError(null); setConfirmationError(null); setLoading(true); }} />
        <section className="space-y-2"><h3 className="text-sm font-semibold">Selected orders ({orderIds.length})</h3>
          {selectedOrders.map((order) => <div key={order.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
            <span>{order.order_number} · {order.client_name}</span>
            <Button size="sm" variant="ghost" onClick={() => { setOrderIds((ids) => ids.filter((id) => id !== order.id)); setRecommendation(null); setError(null); setConfirmationError(null); setLoading(true); }}>Remove</Button>
          </div>)}
          {orders.length > 0 && selectedOrders.length !== orderIds.length && <p role="alert" className="text-xs text-destructive">Some selected orders are no longer available. Refresh the Orders page.</p>}
          {addableOrders.length > 0 && <label className="block text-xs">Add an eligible order
            <select aria-label="Add an eligible order" className="mt-1 w-full rounded-md border border-input bg-card p-2" value="" onChange={(event) => { setOrderIds((ids) => [...ids, Number(event.target.value)]); setRecommendation(null); setError(null); setConfirmationError(null); setLoading(true); }}>
              <option value="">Choose an order</option>{addableOrders.map((order) => <option key={order.id} value={order.id}>{order.order_number} · {order.client_name}</option>)}
            </select></label>}
        </section>
        {groupError && <p role="alert" className="rounded-md bg-destructive-muted p-3 text-xs text-destructive">These orders cannot share one run: {groupContext}. {groupError}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {confirmationError && <p role="alert" className="text-xs text-destructive">Allocation could not be confirmed: {confirmationError} Recommendations are being refreshed.</p>}
        {orderIds.length === 0 && <p className="text-xs text-muted-foreground">Select at least one order to continue.</p>}
        {!departure && <p className="text-xs text-muted-foreground">Choose a departure time to check delivery windows.</p>}
        {loading && orderIds.length > 0 && departure && <p className="text-xs text-muted-foreground">Recalculating recommendations…</p>}
        {!loading && recommendation && <section className="space-y-2">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Compatible vehicles ({eligibleVehicles.length})</h3>
            <Button size="sm" variant="outline" onClick={() => { setLoading(true); setRecommendation(null); setSelectedVehicleId(null); setRefresh((count) => count + 1); }}>Refresh recommendations</Button>
          </div>
          {eligibleVehicles.length === 0 && <AllocationBlockers vehicles={recommendation.vehicles} depot={recommendation.order_group.depot} />}
          {eligibleVehicles.map((vehicle) => <RecommendationVehicleCard key={vehicle.vehicle_id} vehicle={vehicle} selected={selectedVehicleId === vehicle.vehicle_id} onSelect={() => setSelectedVehicleId(vehicle.vehicle_id)} />)}
          {blockedVehicles.length > 0 && <details key={eligibleVehicles.length === 0 ? "blocked" : "ready"} open={eligibleVehicles.length === 0} className="text-xs"><summary className="cursor-pointer font-semibold">Vehicles needing attention ({blockedVehicles.length})</summary>
            <div className="space-y-2 mt-2">{blockedVehicles.map((vehicle) => <RecommendationVehicleCard key={vehicle.vehicle_id} vehicle={vehicle} selected={false} onSelect={() => {}} />)}</div>
          </details>}
        </section>}
        <div className="flex justify-end gap-2 border-t border-border pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!selectedVehicle?.eligible || !!groupError || loading || selectedOrders.length !== orderIds.length} onClick={() => setReviewOpen(true)}>Review constraints</Button></div>
      </DialogContent>
    </Dialog>
    <ConstraintReviewModal isOpen={isOpen && reviewOpen} onClose={() => setReviewOpen(false)} onAdjustOrders={() => setReviewOpen(false)} onConfirm={handleConfirm}
      vehicle={selectedVehicle} depot={recommendation?.order_group.depot ?? "Depot"} isSubmitting={submitting || loading} error={confirmationError} />
  </>;
}
