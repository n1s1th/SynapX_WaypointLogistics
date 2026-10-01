"use client";

// Route: the trip on a map, the next stop, and the stops after it. Works offline
// from the phone's copy; every record is queued and synced later.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, CloudOff, Crosshair, ListChecks, MapPinCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { Pill, StopStatusBadge, TemperatureChip } from "@/components/driver/badges";
import { RouteMap, type MapStop } from "@/components/driver/route-map-lazy";
import { AccessFacts, StopDetailsSheet } from "@/components/driver/stop-details";
import { formatTime, isStopDone, nextStop } from "@/lib/driver/format";
import { distanceKm, useActiveTripId, useGeolocation, useNow, useTrip } from "@/lib/driver/hooks";
import type { DriverStop, DriverTrip } from "@/lib/driver/types";

function toMapStops(stops: DriverStop[]): MapStop[] {
  return stops
    .filter((stop) => stop.latitude != null && stop.longitude != null)
    .map((stop) => ({
      sequence: stop.sequence,
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
      name: stop.name,
      status: stop.status,
    }));
}

function stopHref(page: string, trip: DriverTrip, stop: DriverStop) {
  return `/driver/trip/${page}?trip=${trip.id}&stop=${stop.id}`;
}

function RouteContent() {
  const router = useRouter();
  const params = useSearchParams();
  const fromQuery = Number(params.get("id")) || null;
  const active = useActiveTripId();
  const tripId = fromQuery ?? active.tripId;
  const trip = useTrip(tripId);
  const { perform } = useDriver();
  const now = useNow();
  const [locate, setLocate] = React.useState(false);
  const geo = useGeolocation(locate);
  const [details, setDetails] = React.useState<DriverStop | null>(null);
  const [busy, setBusy] = React.useState(false);

  const data = trip.data;
  const stops = data?.stops ?? [];
  const next = nextStop(stops);
  const removed = stops.filter((stop) => stop.status === "rescheduled");

  // Stable while the trip doesn't change, so the map keeps the driver's pan and zoom.
  const mapStops = React.useMemo(() => toMapStops(data?.stops ?? []), [data?.stops]);

  const distance =
    geo.fix && next?.latitude != null && next.longitude != null
      ? distanceKm(geo.fix, { latitude: next.latitude, longitude: next.longitude })
      : null;

  async function arrive(stop: DriverStop) {
    if (!data) return;
    setBusy(true);
    await perform({ action_type: "arrive", trip_id: data.id, stop_id: stop.id, label: `Arrival · ${stop.name}` });
    router.push(stopHref("arrived", data, stop));
  }

  async function finishTrip() {
    if (!data) return;
    setBusy(true);
    await perform({ action_type: "complete_trip", trip_id: data.id, label: `Trip complete · ${data.run?.code ?? data.id}` });
    router.push(`/driver/trip/summary?trip=${data.id}`);
  }

  if (!tripId && !active.loading) {
    return (
      <DriverShell title="Route" tab="route">
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-8 text-center">
          <Truck className="size-8 text-muted-foreground" aria-hidden />
          <span className="font-bold">No trip on the road</span>
          <span className="text-sm text-muted-foreground">Start a trip from its run sheet on the home screen.</span>
          <Button asChild variant="outline" size="lg" className="h-11">
            <Link href="/driver">Go to today&apos;s trips</Link>
          </Button>
        </section>
      </DriverShell>
    );
  }

  const title = !data ? "Route" : next ? `Route · stop ${next.sequence} of ${stops.length}` : "Route · all stops done";
  const subtitle = data ? `${data.counts.done} of ${data.counts.total} done${data.run ? ` · ${data.run.code}` : ""}` : undefined;

  return (
    <DriverShell title={title} subtitle={subtitle} tab="route">
      {trip.loading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}
      {!trip.loading && !data && (
        <Notice tone={trip.error ? "destructive" : "warning"} icon={CloudOff} title="This trip isn't on the phone yet">
          {trip.error ?? "Open it once with signal and it stays available offline."}
        </Notice>
      )}

      {data && (
        <>
          <div className="relative">
            <RouteMap
              variant="full"
              depot={data.depot}
              stops={mapStops}
              activeSequence={next?.sequence ?? null}
              user={geo.fix}
            />
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              className={cn(
                "absolute top-2 right-2 z-10 size-11 rounded-full shadow-md",
                locate ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card",
              )}
              onClick={() => setLocate((on) => !on)}
              aria-pressed={locate}
              aria-label={locate ? "Hide my location" : "Show my location"}
            >
              <Crosshair aria-hidden />
            </Button>
          </div>
          {locate && (geo.status === "denied" || geo.status === "unavailable") && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {geo.status === "denied" ? "Location is blocked for this site in the phone settings." : "Location isn't available on this phone."}
            </p>
          )}

          {removed.length > 0 && (
            <Notice tone="destructive" icon={Ban} title={`${removed.length} stop${removed.length > 1 ? "s" : ""} removed by dispatch`}>
              {removed.map((stop) => `Stop ${stop.sequence} ${stop.name}: ${stop.removed_reason ?? "removed"}`).join(" · ")}
            </Notice>
          )}

          {next ? (
            <NextStopCard
              stop={next}
              trip={data}
              now={now}
              distance={distance}
              busy={busy}
              onArrive={() => arrive(next)}
              onDetails={() => setDetails(next)}
            />
          ) : (
            <section className="flex flex-col gap-3 rounded-xl border-2 border-success bg-success-muted p-4">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-6" aria-hidden />
                <span className="text-lg font-bold">All stops done</span>
              </div>
              <span className="text-sm text-success/90">
                {data.counts.delivered} delivered · {data.counts.partial} partial · {data.counts.failed} not delivered
                {data.counts.removed ? ` · ${data.counts.removed} removed` : ""}
              </span>
              {data.status === "completed" ? (
                <Button asChild size="lg" className="h-12 font-bold">
                  <Link href={`/driver/trip/summary?trip=${data.id}`}>Trip summary</Link>
                </Button>
              ) : (
                <Button size="lg" className="h-12 font-bold" onClick={finishTrip} disabled={busy}>
                  Finish trip
                </Button>
              )}
            </section>
          )}

          <section aria-labelledby="all-stops" className="flex flex-col gap-2">
            <h2 id="all-stops" className="flex items-center gap-2 text-base font-bold">
              <ListChecks className="size-5 text-muted-foreground" aria-hidden />
              All stops
            </h2>
            <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              {stops.map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => setDetails(stop)}
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      className={
                        isStopDone(stop)
                          ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
                          : "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
                      }
                    >
                      {stop.sequence}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold">{stop.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {stop.outlet ? `${stop.outlet.code} · ` : ""}ETA {formatTime(stop.eta)}
                      </span>
                    </span>
                    <StopStatusBadge status={stop.status} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <StopDetailsSheet stop={details} open={details !== null} onOpenChange={(open) => !open && setDetails(null)} />
    </DriverShell>
  );
}

function NextStopCard({
  stop,
  trip,
  now,
  distance,
  busy,
  onArrive,
  onDetails,
}: {
  stop: DriverStop;
  trip: DriverTrip;
  now: Date | null;
  distance: number | null;
  busy: boolean;
  onArrive: () => void;
  onDetails: () => void;
}) {
  const onTruck = stop.orders.filter((order) => order.on_truck);
  const chilled = onTruck.some((order) => order.temperature === "chilled");

  let primary: React.ReactNode;
  if (stop.status === "pending") {
    primary = (
      <Button size="lg" className="h-13 flex-[1.4] text-base font-bold" onClick={onArrive} disabled={busy}>
        <MapPinCheck aria-hidden />
        I&apos;ve arrived
      </Button>
    );
  } else if (stop.status === "arrived") {
    primary = (
      <Button asChild size="lg" className="h-13 flex-[1.4] text-base font-bold">
        <Link href={stopHref("outcome", trip, stop)}>Record what happened</Link>
      </Button>
    );
  } else {
    primary = (
      <Button asChild size="lg" className="h-13 flex-[1.4] text-base font-bold">
        <Link href={stopHref("proof", trip, stop)}>Add proof of delivery</Link>
      </Button>
    );
  }

  return (
    <section aria-label="Next stop" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold tracking-wide text-info uppercase">Next · stop {stop.sequence}</span>
          <span className="truncate text-lg leading-tight font-bold">{stop.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {stop.outlet ? `${stop.outlet.code} · ${stop.outlet.district}` : stop.address}
          </span>
        </div>
        <StopStatusBadge status={stop.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Fact label="ETA" value={formatTime(stop.eta)} />
        <Fact label="Distance" value={distance != null ? `≈ ${distance.toFixed(1)} km` : "--"} />
        <Fact label="Unload" value={stop.handling_minutes ? `${stop.handling_minutes} min` : "--"} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <AccessFacts stop={stop} />
        {chilled && <TemperatureChip chilled />}
        <Pill>
          {onTruck.length} order{onTruck.length === 1 ? "" : "s"}
        </Pill>
      </div>
      {now && stop.outlet && <WindowHint stop={stop} now={now} />}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="lg" className="h-13 flex-1" onClick={onDetails}>
          Stop details
        </Button>
        {primary}
      </div>
    </section>
  );
}

function WindowHint({ stop, now }: { stop: DriverStop; now: Date }) {
  // Re-rendered each minute by useNow, so the countdown stays current.
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  if (!stop.outlet?.window_start || !stop.outlet.window_end) return null;
  if (hhmm < stop.outlet.window_start) {
    return <p className="text-xs text-muted-foreground">Window opens at {stop.outlet.window_start}: if you arrive early, wait for it to open.</p>;
  }
  if (hhmm > stop.outlet.window_end) {
    return (
      <p className="text-xs font-medium text-destructive">
        The window closed at {stop.outlet.window_end}. Still deliver: receiving staff may have moved on, so record what happens.
      </p>
    );
  }
  return null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-lg bg-muted px-2 py-2">
      <span className="text-base font-bold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default function RoutePage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <RouteContent />
    </React.Suspense>
  );
}
