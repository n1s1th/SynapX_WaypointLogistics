import type { RouteSummary } from "@/types/allocation";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp } from "lucide-react";

export function routeTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" }) : "Unknown";
}

export function RoutePlanSummary({ route }: { route: RouteSummary }) {
  const duration = route.scheduled_elapsed_minutes;
  const late = route.arrivals.filter((stop) => stop.window_status === "FAIL").length;
  const risk = route.arrivals.filter((stop) => stop.window_status === "AT_RISK").length;
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p>{route.estimated_distance_km == null ? "Distance unavailable" : `${route.estimated_distance_km} km estimated`} · {duration == null ? "Duration unavailable" : `${Math.floor(Math.round(duration) / 60)}h ${Math.round(duration) % 60}m including waiting`}</p>
    <p>{late} failed stops · {risk} at risk · {route.estimated_fuel_liters == null ? "Fuel unavailable" : `${route.estimated_fuel_liters} L estimated fuel`}</p>
  </div>;
}

export function RoutePlanDetails({ route, onMove, disabled }: {
  route: RouteSummary;
  onMove?: (index: number, direction: -1 | 1) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-2">
    <RoutePlanSummary route={route} />
    <ol className="space-y-2 text-xs">
      {route.arrivals.map((stop, index) => <li key={stop.outlet_code} className="rounded-md border border-border p-2">
        <div className="flex flex-wrap justify-between gap-2 font-semibold">
          <span>{index + 1}. {stop.outlet_code} · ETA {routeTime(stop.arrival_at)}</span>
          <span className={stop.window_status === "PASS" ? "text-success" : stop.window_status === "AT_RISK" ? "text-warning" : "text-destructive"}>{stop.window_status.replace("_", " ")}</span>
        </div>
        <p className="text-muted-foreground">Window {routeTime(stop.window_start)}–{routeTime(stop.window_end)} · {stop.service_minutes == null ? "Service unknown" : `${stop.service_minutes + stop.handling_minutes} min service/handling`} · Depart {routeTime(stop.depart_at)}</p>
        {stop.window_status !== "PASS" && <p>{stop.reason}</p>}
        {onMove && <div className="mt-2 flex justify-end gap-1">
          <Button size="icon" variant="outline" aria-label={`Move ${stop.outlet_code} earlier`} disabled={index === 0 || disabled} onClick={() => onMove(index, -1)}><ArrowUp className="size-4" /></Button>
          <Button size="icon" variant="outline" aria-label={`Move ${stop.outlet_code} later`} disabled={index === route.arrivals.length - 1 || disabled} onClick={() => onMove(index, 1)}><ArrowDown className="size-4" /></Button>
        </div>}
      </li>)}
    </ol>
    <p className="text-xs text-muted-foreground">Calculation source: {route.source}</p>
  </div>;
}
