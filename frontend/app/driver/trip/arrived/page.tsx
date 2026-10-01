"use client";

// Arrival: recorded when the driver taps "I've arrived" on the route (not on page
// load). Shows the arrival against the outlet's window (brief p15: early waits
// for it to open; after it closes is late) and how to unload here.

import * as React from "react";
import Link from "next/link";
import { Clock, MapPinCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { TimingBadge } from "@/components/driver/badges";
import { RouteMap } from "@/components/driver/route-map-lazy";
import { AccessFacts, OrderList } from "@/components/driver/stop-details";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { formatTime, minutesLabel } from "@/lib/driver/format";
import { useTripStop } from "@/lib/driver/hooks";
import type { DockType } from "@/lib/driver/types";

const UNLOADING: Record<DockType, string> = {
  rear_dock: "Back up to the rear dock and unload with the outlet's staff.",
  street: "Curbside unloading: park safely, hazard lights on, keep the footpath clear.",
  mall_bay: "Shared mall loading bay: unload inside the mall's access window and check in with mall security.",
};

function ArrivedContent() {
  const { trip, stop } = useTripStop();
  const { perform } = useDriver();
  const [busy, setBusy] = React.useState(false);
  const data = trip.data;
  const mapStops = React.useMemo(
    () =>
      (data?.stops ?? [])
        .filter((item) => item.latitude != null && item.longitude != null)
        .map((item) => ({
          sequence: item.sequence,
          latitude: item.latitude as number,
          longitude: item.longitude as number,
          name: item.name,
          status: item.status,
        })),
    [data?.stops],
  );

  if (!data || !stop) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref={data ? `/driver/trip?id=${data.id}` : "/driver/trip"} />;
  }

  const outcomeHref = `/driver/trip/outcome?trip=${data.id}&stop=${stop.id}`;

  async function arrive() {
    if (!data || !stop) return;
    setBusy(true);
    await perform({ action_type: "arrive", trip_id: data.id, stop_id: stop.id, label: `Arrival · ${stop.name}` });
    setBusy(false);
  }

  return (
    <DriverShell
      title={stop.name}
      subtitle={stop.outlet ? `Stop ${stop.sequence} · ${stop.outlet.code} · ${stop.outlet.district}` : `Stop ${stop.sequence}`}
      backHref={`/driver/trip?id=${data.id}`}
      footer={
        stop.status === "pending" ? (
          <Button size="lg" className="h-13 text-base font-bold" onClick={arrive} disabled={busy}>
            <MapPinCheck aria-hidden />
            I&apos;ve arrived
          </Button>
        ) : (
          <>
            <Button asChild size="lg" className="h-13 text-base font-bold">
              <Link href={outcomeHref}>Record what happened</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11">
              <Link href={`/driver/report?trip=${data.id}&stop=${stop.id}`}>Report a problem here</Link>
            </Button>
          </>
        )
      }
    >
      {stop.latitude != null && stop.longitude != null && (
        <RouteMap
          variant="strip"
          depot={null}
          stops={mapStops}
          activeSequence={stop.sequence}
          focusSequence={stop.sequence}
        />
      )}

      {stop.arrived_at ? (
        <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success-muted text-success">
            <MapPinCheck className="size-5.5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xl font-bold">You&apos;ve arrived · {formatTime(stop.arrived_at)}</span>
            <span className="text-xs text-muted-foreground">
              Planned {formatTime(stop.eta)} · recorded on this phone at the tap
            </span>
            <div>
              <TimingBadge timing={stop.timing} />
            </div>
          </div>
        </section>
      ) : (
        <Notice tone="info" icon={MapPinCheck} title="Not marked as arrived yet">
          Tap &ldquo;I&apos;ve arrived&rdquo; when you&apos;re stopped at the outlet.
        </Notice>
      )}

      {stop.timing?.status === "early" && (
        <Notice tone="info" icon={Clock} title={`Window opens at ${stop.outlet?.window_start}`}>
          You&apos;re {minutesLabel(stop.timing.minutes)} early. The outlet receives goods only inside its window, so wait before unloading.
        </Notice>
      )}
      {stop.timing?.status === "late" && (
        <Notice tone="destructive" icon={TriangleAlert} title="Arrived after the window closed">
          Still deliver. Receiving staff may have moved on{stop.outlet?.brand === "fresh" ? " and the store may miss morning sales" : ""}: note anything that goes wrong.
        </Notice>
      )}

      <section aria-labelledby="unload" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <h2 id="unload" className="text-base font-bold">
          Unloading here
        </h2>
        <AccessFacts stop={stop} />
        {stop.outlet && <p className="text-sm text-muted-foreground">{UNLOADING[stop.outlet.dock_type]}</p>}
        {stop.handling_minutes ? (
          <p className="text-xs text-muted-foreground">Planned: {stop.handling_minutes} min to unload.</p>
        ) : null}
      </section>

      <section aria-labelledby="drop" className="flex flex-col gap-2">
        <h2 id="drop" className="text-base font-bold">
          What to drop
        </h2>
        <OrderList orders={stop.orders} />
      </section>
    </DriverShell>
  );
}

export default function ArrivedPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ArrivedContent />
    </React.Suspense>
  );
}
