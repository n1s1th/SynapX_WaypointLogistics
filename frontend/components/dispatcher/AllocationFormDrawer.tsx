"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Truck, Calendar, Hash, MapPin, Lightbulb } from "lucide-react";
import { toast } from "sonner";

interface AllocationFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface VehicleOption {
  id: number;
  code: string;
  vehicle_type: string;
  capacity_kg: number;
  temperature_mode: string;
  depot_name: string;
}

import { fetchWithFallback } from "@/lib/api";

export function AllocationFormDrawer({ open, onOpenChange, onSuccess }: AllocationFormDrawerProps) {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);

  const [selectedVehicleId, setSelectedVehicleId] = useState("");

  const [runId, setRunId] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id.toString() === selectedVehicleId) ?? null;

  const fetchFormData = async () => {
    setIsLoadingData(true);
    try {
      const vehRes = await fetchWithFallback("/api/v1/fleet/vehicles?status=AVAILABLE");
      if (vehRes.ok) setVehicles(await vehRes.json());
    } catch (error) {
      console.error("Error fetching form data", error);
      toast.error("Failed to load vehicles");
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFormData();
      setSelectedVehicleId("");

      setRunId("");
      setDepartureTime("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleId) return;

    setIsSubmitting(true);
    try {
      const payload = {
        vehicle_id: parseInt(selectedVehicleId),

        run_id: runId.trim() || null,
        departure_time: departureTime ? new Date(departureTime).toISOString() : null,
        load_percentage: 0,
        volume_percentage: 0,
        status: "DRAFT",
      };

      const res = await fetchWithFallback("/api/v1/allocations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success("Allocation created — review it in the table to confirm.");
        onSuccess();
        onOpenChange(false);
      } else {
        const err = await res.json();
        const errorMessage = typeof err.detail === "string" ? err.detail :
                             Array.isArray(err.detail) ? err.detail[0]?.msg :
                             err.detail?.message || "Failed to create allocation";
        toast.error(errorMessage || "Failed to create allocation");
      }
    } catch (error) {
      toast.error("Network error — check your connection");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] p-0 overflow-hidden bg-white" showCloseButton={false}>

        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="w-[3px] self-stretch rounded-full bg-[#1c355e] shrink-0" />
          <div>
            <DialogTitle className="text-sm font-bold text-slate-900">
              New Allocation
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-0.5 text-xs leading-snug">
              Select an available vehicle. Starts as a{" "}
              <span className="font-semibold text-slate-700">Draft</span> for your review.
            </DialogDescription>
          </div>
        </div>

        {isLoadingData ? (
          <div className="flex h-44 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="px-6 py-5 space-y-4">

              {/* Vehicle */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-slate-400" />
                  Vehicle <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="Choose an available vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles.length === 0 ? (
                      <SelectItem value="__none__" disabled>No vehicles available</SelectItem>
                    ) : (
                      vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id.toString()}>
                          <span className="font-medium">{v.code}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            {v.vehicle_type} · {v.capacity_kg.toLocaleString()} kg · {v.temperature_mode}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedVehicle && (
                  <p className="text-xs text-slate-400 flex items-center gap-1 pt-0.5">
                    <MapPin className="h-3 w-3" />
                    {selectedVehicle.depot_name} depot · {selectedVehicle.temperature_mode} · {selectedVehicle.capacity_kg.toLocaleString()} kg
                  </p>
                )}
              </div>

              {/* Run ID + Departure — flex-1 ensures identical widths */}
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 text-slate-400" />
                    Run ID <span className="text-slate-400 font-normal">(opt.)</span>
                  </Label>
                  <Input
                    placeholder="e.g. RUN-042"
                    value={runId}
                    onChange={(e) => setRunId(e.target.value)}
                    className="h-9 w-full"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    Departure <span className="text-slate-400 font-normal">(opt.)</span>
                  </Label>
                  <Input
                    type="datetime-local"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="h-9 w-full text-slate-700 [&::-webkit-calendar-picker-indicator]:opacity-40 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>

              {/* Info callout — slate only, no extra colours */}
              <div className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5">
                <Lightbulb className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-500 leading-relaxed">
                  <span className="font-semibold text-slate-600">Draft → Review → Ready → Dispatch.</span>{" "}
                  Driver is automatically assigned from the vehicle. Run ID and departure can be set now or later.
                </p>
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-9 px-5 text-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !selectedVehicleId}
                className="h-9 px-5 bg-[#1c355e] hover:bg-[#16294a] text-white font-semibold disabled:opacity-40"
              >
                {isSubmitting ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Creating…</>
                ) : (
                  "Create Draft"
                )}
              </Button>
            </div>
          </form>
        )}

      </DialogContent>
    </Dialog>
  );
}
