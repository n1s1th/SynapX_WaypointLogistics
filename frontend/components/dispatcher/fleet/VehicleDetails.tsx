"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import { type FleetVehicle, formatCapacity } from "./fleet-data";

const statusStyles: Record<string, string> = {
  available: "bg-success-muted text-success",
  allocated: "bg-info-muted text-info",
  loading: "bg-warning-muted text-warning-muted-foreground",
  unavailable: "bg-destructive-muted text-destructive",
};

export function VehicleDetails({ vehicle }: { vehicle: FleetVehicle }) {
  const fields = [
    ["Vehicle type", vehicle.vehicle_type],
    ["Temperature", vehicle.temperature_mode],
    ["Depot", vehicle.depot_name],
    ["Weight capacity", formatCapacity(vehicle.capacity_kg, "kg")],
    ["Volume capacity", formatCapacity(vehicle.capacity_vol_m3, "m³")],
    ["Trips today / planned", `${vehicle.trips_today} / ${vehicle.trips_planned}`],
    ["Weekly fuel status", vehicle.weekly_fuel_status],
    ["Maintenance", vehicle.maintenance_state || "Not recorded"],
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-border px-2.5 text-xs font-medium shadow-none" aria-label={`View ${vehicle.code}`}>
          <Eye className="size-3.5" aria-hidden="true" />
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border border-border p-5 sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{vehicle.code}</DialogTitle>
          <DialogDescription className="text-xs">Vehicle specifications and assignment readiness.</DialogDescription>
        </DialogHeader>
        <Badge className={`w-fit border-0 capitalize ${statusStyles[vehicle.status] ?? "bg-muted text-muted-foreground"}`}>{vehicle.status}</Badge>
        <div className="border-t border-border pt-4">
          <h2 className="mb-4 text-sm font-semibold">Vehicle details</h2>
          <dl className="space-y-4">
            {fields.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4 text-xs">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <DialogFooter className="mt-2 border-t border-border pt-4 sm:justify-between">
          <DialogClose asChild><Button variant="outline" className="h-10">Close</Button></DialogClose>
          <Button asChild className="h-10"><Link href="/dispatcher/allocations">View Allocations</Link></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
