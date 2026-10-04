import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { allocationBlockers, constraintLabels } from "@/lib/allocation-readiness";
import type { VehicleRecommendation } from "@/types/allocation";
import { AlertCircle } from "lucide-react";

export function AllocationBlockers({ vehicles, depot }: {
  vehicles: VehicleRecommendation[];
  depot: string;
}) {
  const blockers = allocationBlockers(vehicles);
  if (vehicles.some((vehicle) => vehicle.eligible)) return null;
  const allHardFailed = vehicles.every((vehicle) => Object.values(vehicle.constraints)
    .some((check) => check.status === "fail" && check.blocking !== false));
  if (vehicles.length === 0) return <Alert>
    <AlertCircle />
    <AlertTitle>No vehicles found for {depot}</AlertTitle>
    <AlertDescription>Check that vehicles are assigned to this depot, then refresh recommendations.</AlertDescription>
  </Alert>;

  return <Alert className="border-warning/30 bg-warning-muted">
    <AlertCircle className="text-warning" />
    <AlertTitle>{allHardFailed ? "No compatible vehicle" : "Complete required planning data"}</AlertTitle>
    <AlertDescription className="space-y-3">
      <p className="text-xs">{vehicles.length} vehicles checked. The blocking checks are shown below. Unverified fuel usage and missing driver assignments are warnings and do not prevent selection.</p>
      <ul className="space-y-2 text-xs">
        {blockers.map((blocker) => <li key={`${blocker.constraint}:${blocker.status}`}>
          <div className="font-semibold text-foreground">
            {constraintLabels[blocker.constraint] ?? blocker.constraint.replaceAll("_", " ")}
            {" · "}{blocker.vehicleCount} / {vehicles.length} vehicles
            <span className={blocker.status === "unknown" ? "ml-2 text-warning" : "ml-2 text-destructive"}>
              {blocker.status === "unknown" ? "WARNING — DATA NEEDED" : "FAIL"}
            </span>
          </div>
          <p>{blocker.messages[0]}</p>
          {blocker.constraint === "access" && blocker.status === "unknown" && <p>The outlet’s access restrictions need review before this route can be confirmed.</p>}
        </li>)}
      </ul>
      <p className="text-xs">See each vehicle’s reasons below. After the data or assignments are updated, refresh recommendations.</p>
    </AlertDescription>
  </Alert>;
}
