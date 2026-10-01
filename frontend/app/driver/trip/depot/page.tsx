"use client";

// Back at the depot. Tells dispatch the vehicle is home, so it can be reloaded
// for a second trip (brief p5: up to two routes per vehicle per day).

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { formatTime } from "@/lib/driver/format";
import { useNow, useTrip } from "@/lib/driver/hooks";

function DepotContent() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = Number(params.get("trip")) || null;
  const trip = useTrip(tripId);
  const { perform, online } = useDriver();
  const now = useNow();
  const [busy, setBusy] = React.useState(false);
  const data = trip.data;

  if (!data) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref="/driver" />;
  }

  async function checkIn() {
    if (!data) return;
    setBusy(true);
    await perform({ action_type: "checkin", trip_id: data.id, label: `Back at ${data.depot?.name ?? "the depot"}` });
    toast.success(online ? "Dispatch knows you're back." : "Saved on this phone: dispatch hears when you're online.");
    router.replace("/driver");
  }

  return (
    <DriverShell
      title="Back at the depot?"
      subtitle={data.run?.code ?? `Trip ${data.id}`}
      backHref={`/driver/trip/summary?trip=${data.id}`}
      sos={false}
      footer={
        data.checked_in_at ? (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href="/driver">Back to today&apos;s trips</Link>
          </Button>
        ) : (
          <>
            <Button size="lg" className="h-13 text-base font-bold" onClick={checkIn} disabled={busy}>
              Confirm I&apos;m back
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-11">
              <Link href={`/driver/trip/summary?trip=${data.id}`}>Not yet</Link>
            </Button>
          </>
        )
      }
    >
      <section className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-info-muted text-info">
          <Warehouse className="size-8" aria-hidden />
        </span>
        <p className="max-w-xs text-sm text-muted-foreground">
          This tells dispatch the vehicle is home and ready to be reloaded for its next trip.
        </p>
      </section>

      <section className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 p-3">
          <Warehouse className="size-5 text-muted-foreground" aria-hidden />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Depot</span>
            <span className="text-sm font-bold">{data.depot?.name ?? "Your depot"}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3">
          <Clock className="size-5 text-muted-foreground" aria-hidden />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Arrival time</span>
            <span className="text-sm font-bold tabular-nums">
              {data.checked_in_at ? formatTime(data.checked_in_at) : now ? formatTime(now.toISOString()) : "--:--"}
            </span>
          </div>
        </div>
      </section>

      {data.checked_in_at && (
        <Notice tone="success" icon={CheckCircle2} title={`Checked in at ${formatTime(data.checked_in_at)}`}>
          If your vehicle has a second trip today, it shows on the home screen once the loader has it ready.
        </Notice>
      )}
    </DriverShell>
  );
}

export default function DepotPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <DepotContent />
    </React.Suspense>
  );
}
