"use client";

import React, { useState, useEffect, useMemo } from "react";
import { type Order } from "@/types/order";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { fetchWithFallback } from "@/lib/api";
import { ConstraintReviewModal } from "./ConstraintReviewModal";

interface Vehicle {
  id: number;
  code: string;
  vehicle_type: string;
  capacity_kg: number;
  capacity_vol_m3: number;
  status: string;
  temperature_mode: string;
  depot_name: string;
}

interface QuickAllocationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedOrders: Order[];
  onAllocationSuccess: (vehicleCode: string, count: number) => void;
}

export function QuickAllocationDrawer({
  isOpen,
  onClose,
  selectedOrders,
  onAllocationSuccess,
}: QuickAllocationDrawerProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConstraintReviewOpen, setIsConstraintReviewOpen] = useState(false);

  // Total weight and temperature check
  const totalWeight = useMemo(() => {
    return selectedOrders.reduce((sum, o) => sum + (o.weight_kg || 0), 0);
  }, [selectedOrders]);

  const requiresChilled = useMemo(() => {
    return selectedOrders.some(
      (o) => o.temperature_zone?.toLowerCase() === "chilled" || o.temperature_zone?.toLowerCase() === "reefer"
    );
  }, [selectedOrders]);

  // Fetch available vehicles
  useEffect(() => {
    if (!isOpen) return;

    async function fetchVehicles() {
      try {
        const res = await fetchWithFallback("/api/v1/fleet/vehicles?status=AVAILABLE");
        if (res.ok) {
          const data: Vehicle[] = await res.json();
          setVehicles(data);
          // Auto select first compatible vehicle
          const compatible = data.find((v) => {
            const isTempMatch = !requiresChilled || v.temperature_mode?.toLowerCase() === "reefer";
            const isAvail = v.status === "AVAILABLE";
            return isTempMatch && isAvail;
          });
          if (compatible) {
            setSelectedVehicleId(compatible.id);
          }
        }
      } catch (err) {
        console.error("Failed to load vehicles:", err);
      }
    }

    fetchVehicles();
  }, [isOpen, requiresChilled]);

  const selectedVehicle = useMemo(() => {
    return vehicles.find((v) => v.id === selectedVehicleId) || null;
  }, [vehicles, selectedVehicleId]);

  const handleConfirmAllocation = async () => {
    if (!selectedVehicleId || selectedOrders.length === 0) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    let allocationId: number | null = null;

    try {
      // Step 1: Create the Allocation record for the selected vehicle
      const allocRes = await fetchWithFallback("/api/v1/allocations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          status: "ALLOCATED",
          departure_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        }),
      });

      if (!allocRes.ok) {
        const err = await allocRes.json();
        throw new Error(
          typeof err.detail === "string" ? err.detail : "Failed to create allocation"
        );
      }

      const allocation = await allocRes.json();
      allocationId = allocation.id;

      // Step 2: Link the selected orders to the new allocation
      const res = await fetchWithFallback("/api/v1/orders/bulk-allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: selectedOrders.map((o) => o.id),
          allocation_id: allocation.id
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(
          typeof err.detail === "string" ? err.detail : "Failed to link orders to allocation"
        );
      }

      // Success
      const vehicleCode = selectedVehicle?.code || "VEH014";
      const count = selectedOrders.length;
      allocationId = null; // Mark as committed — no rollback needed
      setIsConstraintReviewOpen(false);
      onAllocationSuccess(vehicleCode, count);
      onClose();
    } catch (err: unknown) {
      // Rollback: If Step 1 succeeded but Step 2 failed, cancel the orphan allocation
      // so the vehicle is freed back to AVAILABLE and no ghost record is left behind.
      if (allocationId !== null) {
        try {
          await fetchWithFallback(`/api/v1/allocations/${allocationId}`, {
            method: "DELETE",
          });
        } catch {
          // Rollback failed silently — the dispatcher can manually cancel from the board
          console.error(`[QuickAllocation] Rollback failed for allocation #${allocationId}`);
        }
      }
      setErrorMessage(err instanceof Error ? err.message : "Allocation error");
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-[480px] w-full p-6 rounded-[18px] bg-white border border-[#E5E5E2] shadow-2xl text-[#171A1F] overflow-hidden"
        >
          {/* Header matching Figma #44:2311 */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[20px] font-bold tracking-tight text-[#171A1F]">
                Allocate Selected Orders
              </h2>
              <p className="text-[12px] text-[#6B7280] mt-1 font-normal">
                {selectedOrders.length} {selectedOrders.length === 1 ? "order" : "orders"} · {Math.round(totalWeight)} kg · {requiresChilled ? "Chilled" : "Ambient"}
              </p>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-[#F6F6F3] text-[#18385F] border border-[#E5E5E2] shrink-0">
              Compatible only
            </span>
          </div>

          <div className="w-full h-px bg-[#E5E5E2] my-1" />

          {/* Section: Selected Orders */}
          <div className="space-y-2.5">
            <div className="text-[12px] font-bold text-[#171A1F]">Selected orders</div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {selectedOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3.5 rounded-[8px] bg-[#F6F6F3] border border-[#E5E5E2] h-[56px] gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-[#171A1F] truncate">
                      {order.order_number} · {order.client_name}
                    </div>
                    <div className="text-[11px] text-[#6B7280] truncate mt-0.5">
                      {order.district || "Colombo"} · {order.delivery_window || "Standard window"}
                    </div>
                  </div>
                  <div className="text-[12px] font-bold text-[#171A1F] whitespace-nowrap shrink-0 pr-1">
                    {Math.round(order.weight_kg)} kg
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section: Compatible Vehicles */}
          <div className="space-y-2.5 mt-1">
            <div className="text-[12px] font-bold text-[#171A1F]">Compatible vehicles</div>
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {vehicles.map((v) => {
                const isTempCompatible = !requiresChilled || v.temperature_mode?.toLowerCase() === "reefer";
                const isOperational = v.status?.toLowerCase() !== "unavailable";
                const isEligible = isTempCompatible && isOperational;

                // Projected capacity calculation
                const baseWeight = v.capacity_kg * 0.45;
                const projectedPct = Math.min(100, Math.round(((baseWeight + totalWeight) / v.capacity_kg) * 100));

                let matchLabel = "";
                let matchBadgeClass = "";
                let subLabel = "";

                if (!isTempCompatible) {
                  subLabel = "Incompatible";
                  matchLabel = "Temp mismatch";
                  matchBadgeClass = "bg-rose-50 text-rose-700 border-rose-200";
                } else if (!isOperational) {
                  subLabel = "Offline";
                  matchLabel = "Under maintenance";
                  matchBadgeClass = "bg-slate-100 text-slate-600 border-slate-200";
                } else if (projectedPct > 90) {
                  subLabel = `${projectedPct}% after allocation`;
                  matchLabel = "Near limit";
                  matchBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";
                } else {
                  subLabel = `${projectedPct}% after allocation`;
                  matchLabel = "Best match";
                  matchBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                }

                const isSelected = selectedVehicleId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      if (isEligible) setSelectedVehicleId(v.id);
                    }}
                    className={`relative flex items-center justify-between p-3.5 rounded-[8px] border transition-all h-[68px] gap-3 ${
                      isSelected
                        ? "bg-[#F0FDF4] border-[#18385F] ring-1 ring-[#18385F]"
                        : isEligible
                        ? "bg-white border-[#E5E5E2] hover:border-slate-400 cursor-pointer"
                        : "bg-[#FAFAFA] border-[#E5E5E2] opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Radio button circle */}
                      <div
                        className={`size-4 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected
                            ? "border-[#18385F] bg-[#18385F]"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                      </div>

                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-[#171A1F]">
                          {v.code}
                        </div>
                        <div className="text-[11px] text-[#6B7280] truncate capitalize mt-0.5">
                          {v.vehicle_type} ({v.temperature_mode}) · {v.depot_name}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <div className="text-[11px] font-medium text-[#171A1F]">
                        {subLabel}
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${matchBadgeClass}`}>
                        {matchLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 text-[11px] rounded-[6px] bg-[#FDF2F2] border border-[#FEE2E2] text-[#DC2626] flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Footer matching Figma #44:2341 & #44:2343 */}
          <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[#E5E5E2]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-[120px] h-10 text-[12px] font-semibold text-[#171A1F] border-[#E5E5E2] hover:bg-slate-50 rounded-[6px]"
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={() => setIsConstraintReviewOpen(true)}
              disabled={!selectedVehicleId || isSubmitting}
              className="flex-1 h-10 text-[12px] font-semibold bg-[#18385F] hover:bg-[#122b49] text-white rounded-[6px] shadow-sm flex items-center justify-center gap-1.5"
            >
              <ShieldCheck className="size-4" />
              Review Constraints
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Constraint Review Modal (Figma Frame 163:2021) */}
      <ConstraintReviewModal
        isOpen={isConstraintReviewOpen}
        onClose={() => setIsConstraintReviewOpen(false)}
        onConfirm={handleConfirmAllocation}
        selectedOrders={selectedOrders}
        selectedVehicle={selectedVehicle}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
