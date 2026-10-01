"use client";

// Rehearsal tools for the demo video and judging on a real phone: switch the
// signal off, and make dispatch remove a stop while the phone can't hear it, to
// show the sync conflict. Hidden unless NEXT_PUBLIC_DRIVER_DEMO_TOOLS=1.

import * as React from "react";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { driverApi } from "@/lib/driver/api";
import { isSimulatedOffline, setSimulatedOffline, subscribeSimulatedOffline } from "@/lib/driver/demo";
import { isStopDone } from "@/lib/driver/format";
import { useActiveTripId, useTrip } from "@/lib/driver/hooks";

export function DemoTools() {
  const simulated = React.useSyncExternalStore(subscribeSimulatedOffline, isSimulatedOffline, () => false);
  const active = useActiveTripId();
  const trip = useTrip(active.tripId);
  const open = (trip.data?.stops ?? []).filter((stop) => !isStopDone(stop));
  const [sequence, setSequence] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const chosen = sequence ?? open.at(-1)?.sequence ?? null;

  async function deferStop() {
    if (!trip.data?.run || chosen == null) return;
    setBusy(true);
    try {
      await driverApi.demoDeferStop(trip.data.run.code, chosen, "Store asked to move the delivery");
      toast.success(`Dispatch removed stop ${chosen} on the server. This phone hasn't heard: deliver it, then switch the signal back on.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="demo-tools" className="flex flex-col gap-3 rounded-xl border border-dashed border-warning bg-warning-muted p-4">
      <h2 id="demo-tools" className="flex items-center gap-2 text-sm font-bold text-warning">
        <FlaskConical className="size-4" aria-hidden />
        Demo tools
      </h2>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="simulate-offline" className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-semibold">Simulate no signal</span>
          <span className="text-xs font-normal text-muted-foreground">The app behaves as if coverage dropped.</span>
        </Label>
        <Switch id="simulate-offline" checked={simulated} onCheckedChange={setSimulatedOffline} />
      </div>

      {trip.data?.run && open.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-warning/30 pt-3">
          <span className="text-sm font-semibold">Rehearse a sync conflict</span>
          <ol className="list-decimal pl-5 text-xs text-muted-foreground">
            <li>Switch &ldquo;Simulate no signal&rdquo; on.</li>
            <li>Make dispatch remove a stop (below).</li>
            <li>Deliver that stop as usual.</li>
            <li>Switch the signal back on: the sync raises the conflict.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {open.map((stop) => (
              <Button
                key={stop.id}
                type="button"
                variant={chosen === stop.sequence ? "default" : "outline"}
                size="lg"
                className="h-10"
                aria-pressed={chosen === stop.sequence}
                onClick={() => setSequence(stop.sequence)}
              >
                Stop {stop.sequence}
              </Button>
            ))}
          </div>
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={deferStop} disabled={busy || chosen == null}>
            Dispatch removes stop {chosen}
          </Button>
        </div>
      )}
    </section>
  );
}
