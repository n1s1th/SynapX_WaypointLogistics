"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Choice } from "@/components/dispatcher/operations/shared";
import type { FleetVehicle } from "./fleet-data";

export function VehicleEditor({ vehicle, onSaved, onClose }: { vehicle?: FleetVehicle; onSaved: (vehicle: FleetVehicle) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(vehicle?.status ?? "available");
  const assigned = vehicle?.status === "allocated" || vehicle?.status === "loading";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string | number | null> = {};
    for (const field of ["code", "vehicle_type", "temperature_mode", "depot_name", "weekly_fuel_status", "maintenance_state", "capacity_kg", "capacity_vol_m3"] as const) {
      if (!form.has(field)) continue;
      const text = String(form.get(field)).trim();
      const value = field.startsWith("capacity_") ? Number(text) : field === "maintenance_state" ? text || null : text;
      if (!vehicle || vehicle[field] !== value) payload[field] = value;
    }
    if (!vehicle || status !== vehicle.status) payload.status = status;
    if (!Object.keys(payload).length) { onClose(); return; }
    if (vehicle) {
      if (!vehicle.updated_at) { setError("Refresh the fleet before editing this vehicle."); return; }
      payload.expected_updated_at = vehicle.updated_at;
    }
    setBusy(true); setError(null);
    try {
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
      const response = await fetch(`${base}/api/v1/fleet/vehicles${vehicle ? `/${vehicle.id}` : ""}`, { method: vehicle ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : response.status === 422 ? "Check the field values and try again." : "Unable to save. Check your dispatcher access and try again.");
      onSaved(result); toast.success(vehicle ? "Vehicle updated" : "Vehicle added"); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message} If the connection was interrupted, refresh the fleet before retrying to check whether it saved.` : "Unable to save vehicle.");
    } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{vehicle ? `Edit ${vehicle.code}` : "Add vehicle"}</DialogTitle><DialogDescription>Save specifications, availability, and current maintenance and fuel status.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">{([
          ["code", "Vehicle code", 20], ["vehicle_type", "Vehicle type", 50], ["temperature_mode", "Temperature mode", 50], ["depot_name", "Depot", 100],
        ] as const).map(([key, label, max]) => <div key={key} className="space-y-2"><Label htmlFor={`vehicle-${key}`}>{label}</Label><Input id={`vehicle-${key}`} name={key} required maxLength={max} disabled={assigned} defaultValue={vehicle?.[key] ?? (key === "temperature_mode" ? "ambient" : "")} /></div>)}
        <div className="space-y-2"><Label htmlFor="vehicle-weight">Weight capacity (kg)</Label><Input id="vehicle-weight" name="capacity_kg" type="number" required min="0.01" step="any" disabled={assigned} defaultValue={vehicle?.capacity_kg} /></div>
        <div className="space-y-2"><Label htmlFor="vehicle-volume">Volume capacity (m³)</Label><Input id="vehicle-volume" name="capacity_vol_m3" type="number" required min="0" step="any" disabled={assigned} defaultValue={vehicle?.capacity_vol_m3 ?? 0} /></div>
        <div className="space-y-2"><Label htmlFor="vehicle-fuel">Current fuel status</Label><Input id="vehicle-fuel" name="weekly_fuel_status" required maxLength={50} defaultValue={vehicle?.weekly_fuel_status ?? "Not recorded"} placeholder="e.g. Refuelling required" /></div>
        <div className="space-y-2"><Label htmlFor="vehicle-maintenance">Current maintenance status</Label><Input id="vehicle-maintenance" name="maintenance_state" maxLength={100} defaultValue={vehicle?.maintenance_state ?? ""} placeholder="e.g. Service due; blank clears status" /></div>
        </div>
        {assigned ? <p className="text-sm text-muted-foreground">Availability is {vehicle?.status}. Specifications and availability are managed through the active allocation. Current fuel and maintenance status can still be updated.</p> : <div className="space-y-2"><p className="text-sm font-medium">Availability</p><Choice label="Vehicle availability" value={status} onChange={setStatus} options={[{value:"available",label:"Available"},{value:"unavailable",label:"Unavailable"}]} /></div>}
        <p className="text-xs text-muted-foreground">Maintenance and fuel fields replace the current status. They do not store service history, litres, costs, or odometer readings. Maintenance text does not change availability; mark the vehicle unavailable separately when required.</p>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : vehicle ? "Save changes" : "Add vehicle"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
