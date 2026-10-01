"use client";

// After an SOS: sent (and whether dispatch has seen it), or saved and waiting for
// signal. Emergency numbers stay on screen either way.

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, CloudOff, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { EmergencyCalls } from "@/components/driver/emergency-calls";
import { Notice } from "@/components/driver/notice";
import { driverApi } from "@/lib/driver/api";
import { formatTime } from "@/lib/driver/format";
import type { SosAlert } from "@/lib/driver/types";

const POLL_MS = 15_000;

function SuccessContent() {
  const params = useSearchParams();
  const alertId = Number(params.get("id")) || null;
  const queued = params.get("queued") === "1";
  const { outbox } = useDriver();
  const [alert, setAlert] = React.useState<SosAlert | null>(null);
  const stillQueued = queued && outbox.some((item) => item.action_type === "sos" && item.status === "pending");

  React.useEffect(() => {
    if (!alertId) return;
    let cancelled = false;
    const load = () =>
      driverApi
        .sosStatus(alertId)
        .then((latest) => {
          if (!cancelled) setAlert(latest);
        })
        .catch(() => {
          // Keep the last answer; try again on the next tick.
        });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [alertId]);

  const acknowledged = alert && alert.status !== "triggered";

  return (
    <DriverShell title="Emergency alert" backHref="/driver" sos={false}>
      <section className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="flex size-18 items-center justify-center rounded-full bg-destructive text-white">
          <Siren className="size-9" aria-hidden />
        </span>
        <h2 className="text-2xl font-bold">
          {stillQueued ? "Alert saved: waiting for signal" : "Alert sent to dispatch"}
        </h2>
        {alert && <p className="text-sm text-muted-foreground">Sent at {formatTime(alert.triggered_at)}</p>}
      </section>

      {stillQueued ? (
        <Notice tone="warning" icon={CloudOff} title="No signal right now">
          The alert goes out the moment coverage returns. If you&apos;re in danger, call now: these numbers work without mobile data.
        </Notice>
      ) : acknowledged ? (
        <Notice tone="success" icon={CheckCircle2} title="Dispatch has seen your alert">
          Stay safe and keep your phone on so dispatch can reach you.
        </Notice>
      ) : (
        <Notice tone="info" icon={Siren} title="Dispatch has your alert and location">
          Waiting for them to respond. Stay where it&apos;s safe and keep your phone on.
        </Notice>
      )}

      <EmergencyCalls />

      <Button asChild variant="outline" size="lg" className="h-12">
        <Link href="/driver">Back to today&apos;s trips</Link>
      </Button>
    </DriverShell>
  );
}

export default function SosSuccessPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <SuccessContent />
    </React.Suspense>
  );
}
