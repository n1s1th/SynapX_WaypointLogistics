"use client";

// Trip summary: what happened at each stop, whether every record reached the
// server, and the way back to the depot (a vehicle can run a second trip).

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, CloudCheck, CloudOff, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { StopStatusBadge } from "@/components/driver/badges";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { formatDay, formatTime } from "@/lib/driver/format";
import { useTrip } from "@/lib/driver/hooks";

function SummaryContent() {
  const params = useSearchParams();
  const tripId = Number(params.get("trip")) || null;
  const trip = useTrip(tripId);
  const { outbox } = useDriver();
  const data = trip.data;

  if (!data) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref="/driver" />;
  }

  const waiting = outbox.filter((item) => item.trip_id === data.id && item.status !== "failed").length;
  const { counts } = data;
  const allDone = counts.done === counts.total;

  return (
    <DriverShell
      title={data.status === "completed" ? "Trip complete" : "Trip summary"}
      subtitle={`${data.run?.code ?? `Trip ${data.id}`}${data.started_at ? ` · ${formatDay(data.started_at)}` : ""}`}
      backHref={`/driver/trip?id=${data.id}`}
      tab="home"
      footer={
        data.checked_in_at ? (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href="/driver">Back to today&apos;s trips</Link>
          </Button>
        ) : allDone ? (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href={`/driver/trip/depot?trip=${data.id}`}>I&apos;m back at the depot</Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href={`/driver/trip?id=${data.id}`}>Back to the route</Link>
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-xl border-2 border-success bg-success-muted p-4">
          <span className="text-3xl font-bold text-success tabular-nums">
            {counts.done}/{counts.total}
          </span>
          <span className="text-xs text-muted-foreground">Stops done</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border-2 border-info bg-info-muted p-4">
          <span className="text-3xl font-bold text-info tabular-nums">
            {counts.pod}/{counts.delivered + counts.partial}
          </span>
          <span className="text-xs text-muted-foreground">Proof of delivery</span>
        </div>
      </div>

      <section className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        <Row label="Full deliveries" value={counts.delivered} />
        <Row label="Partial deliveries" value={counts.partial} />
        <Row label="Not delivered" value={counts.failed} />
        {counts.removed > 0 && <Row label="Removed by dispatch" value={counts.removed} />}
        <Row label="Problems reported" value={data.open_issues} />
      </section>

      {waiting > 0 ? (
        <Notice tone="warning" icon={CloudOff} title={`${waiting} record${waiting > 1 ? "s" : ""} still on this phone`}>
          They sync automatically. Keep the app open near the depot&apos;s Wi-Fi or signal.
        </Notice>
      ) : (
        <Notice tone="success" icon={CloudCheck} title="Every record is synced">
          Dispatch and the stores have your delivery records.
        </Notice>
      )}

      <section aria-labelledby="stops-done" className="flex flex-col gap-2">
        <h2 id="stops-done" className="text-base font-bold">
          Stops
        </h2>
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {data.stops.map((stop) => (
            <li key={stop.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-5 text-sm font-bold text-muted-foreground tabular-nums">{stop.sequence}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{stop.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {stop.arrived_at ? `Arrived ${formatTime(stop.arrived_at)}` : "Not reached"}
                  {stop.pod ? ` · signed by ${stop.pod.recipient_name}` : ""}
                </span>
              </span>
              <StopStatusBadge status={stop.status} />
            </li>
          ))}
        </ol>
      </section>

      {data.depot && (
        <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-muted text-info">
            <MapPin className="size-5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold">Return to {data.depot.name}</span>
            <span className="text-xs text-muted-foreground">
              {data.checked_in_at ? `Checked in at ${formatTime(data.checked_in_at)}` : "Check in when you're back so dispatch can plan your next trip."}
            </span>
          </div>
          {data.checked_in_at && <CheckCircle2 className="size-6 text-success" aria-label="Checked in" />}
        </section>
      )}
    </DriverShell>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}

export default function TripSummaryPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <SummaryContent />
    </React.Suspense>
  );
}
