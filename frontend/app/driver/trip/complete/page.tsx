"use client";

// Stop closed: where its records stand (on the phone or synced), and the next stop.

import * as React from "react";
import Link from "next/link";
import { Check, CloudCheck, CloudOff, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { WindowChip } from "@/components/driver/badges";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { cn } from "@/lib/utils";
import { formatTime, nextStop } from "@/lib/driver/format";
import { useNow, useTripStop } from "@/lib/driver/hooks";

function CompleteContent() {
  const { trip, stop } = useTripStop();
  const { outbox } = useDriver();
  const now = useNow();
  const data = trip.data;

  if (!data || !stop) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref={data ? `/driver/trip?id=${data.id}` : "/driver/trip"} />;
  }

  const failed = stop.status === "failed";
  const waiting = outbox.filter((item) => item.stop_id === stop.id && item.status === "pending").length;
  const following = nextStop(data.stops);
  const routeHref = `/driver/trip?id=${data.id}`;

  return (
    <DriverShell
      title={failed ? "Stop recorded" : "Delivery complete"}
      subtitle={`${data.counts.done} of ${data.counts.total} stops done`}
      tab="route"
      footer={
        <Button asChild size="lg" className="h-13 text-base font-bold">
          <Link href={routeHref}>{following ? `Continue to stop ${following.sequence}` : "Finish the trip"}</Link>
        </Button>
      }
    >
      <section className="flex flex-col items-center gap-3 py-2 text-center">
        <span
          className={cn(
            "flex size-18 items-center justify-center rounded-full text-white",
            failed ? "bg-destructive" : "bg-success",
          )}
        >
          {failed ? <PackageX className="size-9" aria-hidden /> : <Check className="size-9" strokeWidth={3} aria-hidden />}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold">
            Stop {stop.sequence} of {data.stops.length} {failed ? "not delivered" : "done"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {stop.name}
            {stop.pod ? ` · signed by ${stop.pod.recipient_name}` : ""}
            {stop.completed_at ? ` · ${formatTime(stop.completed_at)}` : ""}
          </p>
          {stop.note && <p className="text-sm text-muted-foreground">{stop.note}</p>}
        </div>
      </section>

      {waiting > 0 ? (
        <Notice tone="warning" icon={CloudOff} title="Saved on this phone">
          {waiting} record{waiting > 1 ? "s" : ""} for this stop will sync automatically when the connection returns.
        </Notice>
      ) : (
        <Notice tone="success" icon={CloudCheck} title="Synced">
          Dispatch {failed ? "has your reason" : "and the store can see this delivery"}.
        </Notice>
      )}

      {following && (
        <section aria-label="Next stop" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <span className="text-[11px] font-bold tracking-wide text-info uppercase">
            Next · stop {following.sequence} of {data.stops.length}
          </span>
          <span className="text-lg leading-tight font-bold">{following.name}</span>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>ETA {formatTime(following.eta)}</span>
            <WindowChip outlet={following.outlet} now={now} />
          </div>
        </section>
      )}
    </DriverShell>
  );
}

export default function StopCompletePage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <CompleteContent />
    </React.Suspense>
  );
}
