"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge, StatusVariant } from "./StatusBadge";
import { toast } from "sonner";
import { type Allocation } from "./AllocationTable";
import { fetchWithFallback } from "@/lib/api";

interface AllocationDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allocation: Allocation | null;
  onSuccess: () => void;
}

export function AllocationDetailDrawer({
  open,
  onOpenChange,
  allocation,
  onSuccess,
}: AllocationDetailDrawerProps) {
  // Hooks must be declared before any conditional returns (Rules of Hooks)
  const router = useRouter();
  const [docks, setDocks] = React.useState<{id: number, code: string, name: string}[]>([]);
  const [selectedDock, setSelectedDock] = React.useState<string>("");

  React.useEffect(() => {
    if (open) {
      fetchWithFallback("/api/v1/delivery-runs/docks")
        .then(res => res.ok ? res.json() : [])
        .then(data => {
          setDocks(data);
          if (data.length > 0) setSelectedDock(data[0].code);
        })
        .catch(console.error);
    }
  }, [open]);

  if (!allocation) return null;

  const getStatusVariant = (status: string): StatusVariant => {
    switch (status.toLowerCase()) {
      case "allocated":
      case "available":
        return "primary";
      case "ready":
      case "completed":
        return "success";
      case "loading":
      case "review":
      case "draft":
        return "warning";
      case "cancelled":
      case "unavailable":
        return "destructive";
      default:
        return "neutral";
    }
  };

  const updateStatus = async (newStatus: string, successMessage: string) => {
    try {
      const res = await fetchWithFallback(`/api/v1/allocations/${allocation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        toast.success(successMessage);
        onSuccess();
        onOpenChange(false);
      } else {
        const err = await res.json();
        const errorMessage = typeof err.detail === "string" ? err.detail :
                             Array.isArray(err.detail) ? err.detail[0]?.msg :
                             err.detail?.message || "Failed to update allocation";
        toast.error(errorMessage || "Failed to update allocation");
      }
    } catch {
      toast.error("Network error occurred");
    }
  };

  const sendToDock = async () => {
    if (!selectedDock) {
      toast.error("Please select a dock first");
      return;
    }
    try {
      const res = await fetchWithFallback(
        `/api/v1/delivery-runs/from-allocation/${allocation.id}?dock_code=${selectedDock}`,
        { method: "POST" }
      );
      if (res.ok) {
        const run = await res.json();
        if (run.loader_warning) {
          toast.warning(`Trip ${run.trip_code} created, but it was not sent to the dock: ${run.loader_warning}`);
        } else {
          toast.success(`Vehicle successfully sent to dock!`);
        }
        onSuccess();
        onOpenChange(false);
      } else {
        const err = await res.json();
        let errorMessage = "Failed to send vehicle to dock";
        if (typeof err.detail === "string") {
          errorMessage = err.detail;
        } else if (Array.isArray(err.detail)) {
          errorMessage = err.detail[0]?.msg || errorMessage;
        } else if (err.detail?.message) {
          errorMessage = err.detail.message;
          if (Array.isArray(err.detail.violations) && err.detail.violations.length > 0) {
            errorMessage += ": " + err.detail.violations.map((v: any) => v.message).join(", ");
          }
        }
        toast.error(errorMessage);
      }
    } catch {
      toast.error("Network error occurred");
    }
  };

  const driverName = allocation.driver?.user?.full_name || "Unassigned";
  const vehicleCode = allocation.vehicle?.code || "—";
  const runId = allocation.run_id && allocation.run_id !== "—" ? allocation.run_id : "NO-RUN";
  const ordersCount = allocation.orders?.length || 0;
  let departure = "—";
  if (allocation.departure_time) {
    departure = new Date(allocation.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const weightUtil = allocation.load_percentage ? `${allocation.load_percentage}%` : "0%";
  
  const volumeUtil = allocation.volume_percentage ? `${allocation.volume_percentage}%` : "0%";
  const temperature = allocation.vehicle?.temperature_mode || "Ambient";
  const weeklyFuel = allocation.vehicle?.weekly_fuel_status || "Unknown";
  
  // Format trips today (e.g., "1 of 2")
  const tripsCompleted = allocation.vehicle?.trips_today || 0;
  const tripsTotal = allocation.vehicle?.trips_planned || 0;
  const tripsToday = tripsTotal > 0 ? `${tripsCompleted} of ${tripsTotal}` : `${tripsCompleted}`;
  
  const depotName = allocation.vehicle?.depot_name || "Unknown Depot";

  // Status flags — normalise to lowercase to handle both "READY" and "ready" from DB
  const s = allocation.status.toLowerCase();
  const isReviewMode    = s === "draft" || s === "review";
  const isAllocatedMode = s === "allocated";
  const isReadyMode     = s === "ready";
  const isLoadingMode   = s === "loading";
  const isDispatchedMode = s === "dispatched";
  const isUnavailableMode = s === "unavailable";
  const isTerminalMode  = s === "completed" || s === "cancelled" || s === "available";

  // Use the new maintenance_state field, fallback to generic "Unavailable"
  const unavailableState = allocation.vehicle?.maintenance_state || "Unavailable";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* showCloseButton={false} — we have our own Close button in the footer */}
      <DialogContent className="max-w-[400px] p-0 overflow-hidden bg-white" showCloseButton={false}>
        
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <DialogHeader>
            <DialogTitle className="text-base font-bold tracking-tight text-slate-900">
              {isUnavailableMode ? vehicleCode : `${vehicleCode} · ${runId}`}
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-1 text-[13px]">
              {isUnavailableMode
                ? "Vehicle availability and operational status."
                : isReviewMode 
                  ? "Review an allocation that needs dispatcher attention."
                  : isLoadingMode
                    ? "Vehicle is currently at the dock being loaded."
                    : "Current allocation and readiness details."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            <StatusBadge
              status={
                isUnavailableMode ? "Unavailable" :
                isReviewMode ? "Needs review" :
                isLoadingMode ? "Loading in progress" :
                (allocation.status.charAt(0).toUpperCase() + allocation.status.slice(1).toLowerCase())
              }
              variant={getStatusVariant(allocation.status)}
            />
          </div>
        </div>

        <div className="border-b border-slate-100 mx-5" />

        {/* Body */}
        <div className="px-5 py-3">
          <h3 className="font-bold text-slate-900 text-[13px] mb-2">Assignment details</h3>
          
          <div className="space-y-1">
            {isUnavailableMode ? (
              <>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Vehicle type</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{allocation.vehicle?.vehicle_type || "Truck"}</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Temperature</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{temperature}</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Depot</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{depotName}</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Current state</span>
                  <span className="font-semibold text-destructive text-sm col-span-2">{unavailableState}</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Assigned orders</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">0</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Active run</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">None</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Trips today</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">0</span>
                </div>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Availability</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">Blocked</span>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Driver</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{driverName}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Assigned orders</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{ordersCount}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Departure</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{departure}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Weight util.</span>
                  <span className={`font-semibold text-sm col-span-2 ${isReviewMode ? "text-[#c08535]" : "text-slate-900"}`}>
                    {weightUtil}
                  </span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Volume util.</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{volumeUtil}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Temperature</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{temperature}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Weekly fuel</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{weeklyFuel}</span>
                </div>
                
                <div className="grid grid-cols-3 items-center gap-2">
                  <span className="text-slate-500 text-sm col-span-1">Trips today</span>
                  <span className="font-semibold text-slate-900 text-sm col-span-2">{tripsToday}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="border-b border-slate-100 mx-5" />

        {isUnavailableMode && (
          <div className="px-5 pt-3 pb-0">
            <div className="bg-[#fef2f2] p-3 rounded-md">
              <h4 className="text-destructive font-semibold text-[13px] mb-1">Vehicle unavailable</h4>
              <p className="text-slate-500 text-[13px] leading-snug">
                This vehicle cannot be assigned until its {unavailableState.toLowerCase()} state is cleared. Existing allocation actions remain disabled.
              </p>
            </div>
          </div>
        )}

        {isReviewMode && (
          <div className="px-5 pt-3 pb-0">
            <div className="bg-[#fdf8ec] p-3 rounded-md">
              <h4 className="text-[#c08535] font-semibold text-[13px] mb-1">Capacity approaching limit</h4>
              <p className="text-slate-500 text-[13px] leading-snug">
                This allocation is still valid, but utilization is high. Review the load before keeping the assignment.
              </p>
            </div>
          </div>
        )}

        {isLoadingMode && (
          <div className="px-5 pt-3 pb-0">
            <div className="bg-[#f0f9ff] p-3 rounded-md">
              <h4 className="text-[#0284c7] font-semibold text-[13px] mb-1">Dock operations active</h4>
              <p className="text-slate-500 text-[13px] leading-snug">
                Warehouse staff are currently loading goods onto this vehicle. Dispatch actions will be unlocked once loading completes.
              </p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-5 pb-5 pt-4">
          {/* Only show section header when there's a meaningful action */}
          {!isUnavailableMode && !isTerminalMode && (
            <h3 className="font-bold text-slate-900 text-[13px] mb-2">Operational actions</h3>
          )}

          <div className="flex items-center gap-2">

            {/* UNAVAILABLE or TERMINAL — just close */}
            {(isUnavailableMode || isTerminalMode) && (
              <Button
                variant="outline"
                className="px-5 shadow-none border-slate-200 text-slate-900 font-semibold w-full"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            )}

            {/* DRAFT/REVIEW — Keep Allocation | Adjust Orders (pending) */}
            {isReviewMode && (
              <>
                <Button
                  variant="outline"
                  className="px-4 shadow-none border-slate-200 text-slate-900 font-semibold flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  style={{ backgroundColor: "#1c355e", color: "#ffffff" }}
                  className="px-4 hover:opacity-90 shadow-none font-semibold flex-1"
                  onClick={() => updateStatus("ALLOCATED", "Allocation confirmed and kept")}
                >
                  Keep Allocation
                </Button>
              </>
            )}

            {/* ALLOCATED — Assign Dock & Send */}
            {isAllocatedMode && (
              <div className="flex flex-col gap-3 w-full">
                <div className="flex flex-col gap-1.5 w-full">
                  <label className="text-xs font-semibold text-slate-700">Assign Dock</label>
                  <select 
                    value={selectedDock} 
                    onChange={(e) => setSelectedDock(e.target.value)}
                    className="w-full text-sm border-slate-200 rounded-md bg-white p-2 border focus:ring-1 focus:ring-[#1c355e] outline-none"
                  >
                    {docks.map(d => (
                      <option key={d.id} value={d.code}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="px-4 shadow-none border-slate-200 text-slate-700 font-medium flex-1"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button
                    style={{ backgroundColor: "#1c355e", color: "#ffffff" }}
                    className="px-4 hover:opacity-90 shadow-none font-medium flex-1"
                    onClick={sendToDock}
                  >
                    Send to Dock
                  </Button>
                </div>
              </div>
            )}

            {/* READY or LOADING — Loader handles dispatch, dispatcher just views */}
            {(isReadyMode || isLoadingMode) && (
              <Button
                variant="outline"
                className="px-4 shadow-none border-slate-200 text-slate-700 font-medium flex-1"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            )}

            {/* DISPATCHED — navigate to Delivery Runs */}
            {isDispatchedMode && (
              <>
                <Button
                  variant="outline"
                  className="px-4 shadow-none border-slate-200 text-slate-700 font-medium flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  style={{ backgroundColor: "#1c355e", color: "#ffffff" }}
                  className="px-4 hover:opacity-90 shadow-none font-medium flex-1"
                  onClick={() => {
                    onOpenChange(false);
                    router.push("/dispatcher/delivery-runs");
                  }}
                >
                  View Delivery Run
                </Button>
              </>
            )}

          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
