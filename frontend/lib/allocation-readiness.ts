import type { VehicleRecommendation } from "@/types/allocation";

export interface AllocationBlocker {
  constraint: string;
  status: "fail" | "unknown";
  vehicleCount: number;
  messages: string[];
}

/** Preserve the API's distinction between failed checks and missing evidence. */
export function allocationBlockers(vehicles: VehicleRecommendation[]): AllocationBlocker[] {
  const blockers = new Map<string, AllocationBlocker>();
  for (const vehicle of vehicles) {
    if (vehicle.eligible) continue;
    for (const [constraint, check] of Object.entries(vehicle.constraints)) {
      if (check.status === "pass" || check.blocking === false) continue;
      const key = `${constraint}:${check.status}`;
      const entry = blockers.get(key) ?? {
        constraint, status: check.status, vehicleCount: 0, messages: [],
      };
      entry.vehicleCount += 1;
      if (check.message && !entry.messages.includes(check.message)) entry.messages.push(check.message);
      blockers.set(key, entry);
    }
  }
  return [...blockers.values()].sort((a, b) =>
    b.vehicleCount - a.vehicleCount ||
    Number(b.status === "unknown") - Number(a.status === "unknown") ||
    a.constraint.localeCompare(b.constraint)
  );
}

export const constraintLabels: Record<string, string> = {
  order_group: "Order group", depot: "Depot", availability: "Availability",
  temperature: "Temperature", access: "Outlet access", weight: "Weight",
  volume: "Volume", fuel: "Fuel quota", trips_today: "Trips today",
  delivery_windows: "Delivery windows", operating_date: "Operating date",
  driver: "Driver", dock: "Loading dock", route_feasibility: "Route feasibility",
  trip_time_budget: "Official trip-time budget",
};
