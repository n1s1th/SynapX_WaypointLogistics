"use client";

// Run sheet: what the driver carries and where, before leaving the gate. Replaces
// the paper run sheet (brief p6). Starting the trip is the gate-out: the loader
// has signed the run off and from here it is the driver's.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck, CloudOff, PackageX, Route, Warehouse } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { Pill, RunStateBadge, TemperatureChip, WindowChip } from "@/components/driver/badges";
import { RouteMap } from "@/components/driver/route-map-lazy";
import { driverApi } from "@/lib/driver/api";
import { getValue, putCachedTrip, putValue } from "@/lib/driver/offline/db";
import { dockLabel, formatDay, formatTime, kg, titleCase } from "@/lib/driver/format";
import { useRunSheet } from "@/lib/driver/hooks";
import type { RunCard, SheetStop } from "@/lib/driver/types";

function OverviewContent() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code");
  const tripParam = Number(params.get("trip")) || null;
  const { online, refreshData } = useDriver();
  const sheet = useRunSheet(code);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  const data = sheet.data;
  const tripId = data?.trip_id ?? tripParam;
  const mapStops = React.useMemo(
    () =>
      (data?.stops ?? []).map((stop) => ({
        sequence: stop.sequence,
        latitude: stop.latitude,
        longitude: stop.longitude,
        name: stop.name,
        status: "planned" as const,
      })),
    [data?.stops],
  );

  async function start() {
    if (!code) return;
    setStarting(true);
    setStartError(null);
    try {
      const trip = tripId ? await driverApi.startTrip(tripId) : await driverApi.startRun(code);
      try {
        await putCachedTrip(trip);
        // The saved run list must know the trip is on the road, for screens opened offline.
        const runs = await getValue<RunCard[]>("runs");
        if (runs) {
          await putValue(
            "runs",
            runs.value.map((card) =>
              card.code === code
                ? { ...card, state: "in_progress" as const, trip_id: trip.id, stop_count: trip.stops.length, stops_done: trip.counts.done }
                : card,
            ),
          );
        }
      } catch {
        // Not cached: the route screen fetches it.
      }
      refreshData();
      toast.success(`${code} is yours. Drive safe.`);
      router.push(`/driver/trip?id=${trip.id}`);
    } catch (err) {
      setStartError(
        err instanceof ApiError && !err.isNetworkError
          ? err.message
          : "Starting a trip needs a connection. Try again from the depot.",
      );
      setStarting(false);
    }
  }

  const present = (value: string | null | undefined): value is string => Boolean(value);
  const firstOpens = (data?.stops ?? []).map((stop) => stop.outlet?.window_start).filter(present).sort()[0];
  const lastCloses = (data?.stops ?? []).map((stop) => stop.outlet?.window_end).filter(present).sort().at(-1);
  const onTruckKg = (data?.stops ?? [])
    .flatMap((stop) => stop.orders)
    .filter((order) => order.on_truck)
    .reduce((sum, order) => sum + (order.weight_kg ?? 0), 0);
  const notLoaded = (data?.stops ?? []).flatMap((stop) =>
    stop.orders.filter((order) => !order.on_truck).map((order) => ({ stop, order })),
  );

  let footer: React.ReactNode = null;
  if (data && tripId) {
    footer = (
      <Button size="lg" className="h-13 text-base font-bold" onClick={start} disabled={starting}>
        {starting ? "Opening…" : "Continue route"}
      </Button>
    );
  } else if (data?.state === "ready") {
    footer = (
      <>
        {startError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {startError}
          </p>
        )}
        <Button size="lg" className="h-13 text-base font-bold" onClick={start} disabled={starting || !online}>
          {starting ? "Starting…" : online ? "Start trip · leave the gate" : "Start needs a connection"}
        </Button>
      </>
    );
  } else if (data?.state === "being_loaded") {
    footer = (
      <Button size="lg" variant="outline" className="h-13" disabled>
        Still being loaded at the dock
      </Button>
    );
  }

  return (
    <DriverShell
      title={data ? `${data.code} · Trip ${data.run.trip_number}` : code ?? "Run sheet"}
      subtitle={data ? `${titleCase(data.run.brand)} · ${data.run.district} · ${data.stops.length} stops` : undefined}
      backHref="/driver"
      footer={footer}
    >
      {sheet.loading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}
      {!sheet.loading && !data && (
        <Notice tone={sheet.error ? "destructive" : "warning"} icon={CloudOff} title="Run sheet not available">
          {sheet.error ?? "Open this run once while you have signal, and the phone keeps a copy for the road."}
        </Notice>
      )}

      {data && (
        <>
          {sheet.fromCache && (
            <Notice tone="warning" icon={CloudOff} title="Copy saved on this phone">
              It refreshes when the connection returns.
            </Notice>
          )}
          <div className="flex items-center justify-between">
            <RunStateBadge state={data.state} />
            {data.vehicle && (
              <span className="text-xs font-semibold text-muted-foreground">
                {data.vehicle.code} · {titleCase(data.vehicle.type)} · {data.vehicle.temperature_mode === "reefer" ? "Refrigerated" : "Ambient"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Departs" value={formatTime(data.run.departs_at)} hint={formatDay(data.run.departs_at)} />
            <Metric label="Windows" value={firstOpens && lastCloses ? `${firstOpens}–${lastCloses}` : "--"} hint="first opens · last closes" />
            <Metric label="On truck" value={kg(onTruckKg)} hint={`${data.stops.reduce((n, s) => n + s.orders.filter((o) => o.on_truck).length, 0)} orders`} />
          </div>

          <RouteMap
            variant="preview"
            depot={data.depot}
            stops={mapStops}
          />

          {notLoaded.length > 0 && (
            <Notice tone="warning" icon={PackageX} title={`${notLoaded.length} order${notLoaded.length > 1 ? "s" : ""} not on the truck`}>
              {notLoaded.map(({ stop, order }) => `Stop ${stop.sequence}: ${order.order_number}`).join(" · ")}. The loader flagged
              {notLoaded.length > 1 ? " them" : " it"}; dispatch has been told. Don&apos;t promise {notLoaded.length > 1 ? "them" : "it"} at the stop.
            </Notice>
          )}

          <section aria-labelledby="sequence-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 id="sequence-heading" className="flex items-center gap-2 text-lg font-bold">
                <Route className="size-5 text-muted-foreground" aria-hidden />
                Stop sequence
              </h2>
              <span className="text-xs text-muted-foreground">Loaded last stop first</span>
            </div>
            <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              <li className="flex items-center gap-3 px-3 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-strong text-white">
                  <Warehouse className="size-4" aria-hidden />
                </span>
                <span className="text-sm font-semibold">{data.depot.name}</span>
              </li>
              {data.stops.map((stop) => (
                <SheetRow key={stop.sequence} stop={stop} />
              ))}
            </ol>
          </section>

          <Notice tone="info" icon={ClipboardCheck} title="Before you leave the gate">
            Check the load against this sheet, chilled orders in the refrigerated section, and the doors sealed.
            {data.released_at ? ` Signed off by the loader at ${formatTime(data.released_at)}.` : ""}
          </Notice>
        </>
      )}
    </DriverShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase">{label}</span>
      <span className="text-base leading-tight font-bold tabular-nums">{value}</span>
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SheetRow({ stop }: { stop: SheetStop }) {
  const onTruck = stop.orders.filter((order) => order.on_truck);
  const chilled = onTruck.some((order) => order.temperature === "chilled");
  return (
    <li className="flex gap-3 px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
        {stop.sequence}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-bold">{stop.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">ETA {formatTime(stop.eta)}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {stop.outlet?.code} · {dockLabel(stop.outlet?.dock_type)}
          {stop.handling_minutes ? ` · ${stop.handling_minutes} min to unload` : ""}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <WindowChip outlet={stop.outlet} />
          {stop.outlet?.van_only && <Pill tone="warning">Van only</Pill>}
          {chilled && <TemperatureChip chilled />}
          <Pill>
            {onTruck.length} order{onTruck.length === 1 ? "" : "s"} · {kg(onTruck.reduce((sum, order) => sum + (order.weight_kg ?? 0), 0))}
          </Pill>
        </div>
      </div>
    </li>
  );
}

export default function TripOverviewPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <OverviewContent />
    </React.Suspense>
  );
}
