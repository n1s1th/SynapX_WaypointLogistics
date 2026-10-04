import { dispatcherDepotHeaders } from "@/lib/dispatcher-depot";

export interface FleetVehicle {
  id: number;
  code: string;
  vehicle_type: string;
  temperature_mode: string;
  depot_name: string;
  capacity_kg: number;
  capacity_vol_m3: number;
  status: string;
  weekly_fuel_status: string;
  trips_today: number;
  trips_planned: number;
  maintenance_state: string | null;
  updated_at: string;
}
export const normalize = (value: string) => value.trim().toLowerCase();

export function formatCapacity(value: number, unit: string) {
  return `${value.toLocaleString("en-GB", {
    minimumFractionDigits: unit === "m³" ? 1 : 0,
    maximumFractionDigits: 1,
  })} ${unit}`;
}

export async function fetchFleet(signal: AbortSignal): Promise<FleetVehicle[]> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  const vehicles: FleetVehicle[] = [];
  const limit = 100;
  // The API is paginated. Load every page so totals and filters cover the fleet.
  for (let skip = 0; ; skip += limit) {
    const response = await fetch(`${base}/api/v1/fleet/vehicles?skip=${skip}&limit=${limit}`, {
      signal,
      cache: "no-store",
      headers: dispatcherDepotHeaders(),
    });
    if (!response.ok) throw new Error(`Fleet request failed (${response.status}).`);
    const page: FleetVehicle[] = await response.json();
    if (!Array.isArray(page)) throw new Error("The fleet response could not be read.");
    vehicles.push(...page);
    if (page.length < limit) break;
  }
  return vehicles.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}
