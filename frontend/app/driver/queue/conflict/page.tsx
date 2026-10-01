"use client";

// Degradation screen: dispatch changed a stop (removed it) while the driver was
// offline and recorded a delivery there. The sync refused the record with
// STOP_REMOVED; the driver chooses which record stands. Nothing is dropped
// without that choice.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Cloud, Smartphone, TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { driverApi, type ConflictRecord } from "@/lib/driver/api";
import { deleteOutboxAction } from "@/lib/driver/offline/db";
import { formatTime, stopStatusLabel } from "@/lib/driver/format";
import { useTrip } from "@/lib/driver/hooks";
import type { OutcomePayload, PodPayload, QueuedAction, StopStatus } from "@/lib/driver/types";

/** Everything the phone holds for one stop, as one record. */
function recordFrom(actions: QueuedAction[]): ConflictRecord {
  const record: ConflictRecord = {};
  for (const action of actions) {
    if (action.action_type === "arrive") record.arrived_at ??= action.created_at;
    if (action.action_type === "outcome") {
      const payload = action.payload as OutcomePayload;
      record.outcome = payload.outcome;
      if (payload.reason) record.reason = payload.reason;
      record.arrived_at ??= action.created_at;
      if (payload.outcome === "failed") record.completed_at = action.created_at;
    }
    if (action.action_type === "pod") {
      record.pod = { ...(action.payload as PodPayload), client_timestamp: action.created_at };
      record.completed_at = action.created_at;
    }
    if (action.action_type === "complete_stop") record.completed_at ??= action.created_at;
  }
  return record;
}

function ConflictContent() {
  const router = useRouter();
  const params = useSearchParams();
  const stopId = Number(params.get("stop")) || null;
  const { outbox, online, refreshOutbox, refreshData } = useDriver();
  const forStop = outbox.filter((item) => item.stop_id === stopId);
  const conflict = forStop.find((item) => item.status === "conflict");
  const trip = useTrip(conflict?.trip_id ?? null);
  const stop = trip.data?.stops.find((item) => item.id === stopId);
  const [busy, setBusy] = React.useState<"keep_record" | "flag_review" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!conflict) {
    return (
      <DriverShell title="Sync conflict" backHref="/driver/queue" tab="queue">
        <Notice tone="success" icon={CheckCircle2} title="Nothing to resolve here">
          This conflict was already resolved.
        </Notice>
        <Button asChild variant="outline" size="lg" className="h-12">
          <Link href="/driver/queue">Back to the queue</Link>
        </Button>
      </DriverShell>
    );
  }

  const record = recordFrom(forStop);
  const server = conflict.server_state ?? {};
  const stopName = stop?.name ?? (typeof server.name === "string" ? server.name : conflict.label);
  const removedBecause = typeof server.note === "string" ? server.note : conflict.last_error;

  async function resolve(resolution: "keep_record" | "flag_review") {
    if (stopId == null) return;
    setBusy(resolution);
    setError(null);
    try {
      await driverApi.resolve(stopId, resolution, record);
      for (const item of forStop) await deleteOutboxAction(item.client_action_id);
      await refreshOutbox();
      refreshData();
      toast.success(resolution === "keep_record" ? "Your delivery record stands. Dispatch has been told." : "Sent to dispatch to decide.");
      router.push("/driver/queue");
    } catch (err) {
      setError(err instanceof ApiError && !err.isNetworkError ? err.message : "No connection. Try again when you have signal.");
      setBusy(null);
    }
  }

  return (
    <DriverShell
      title="Sync conflict"
      subtitle="1 record needs your choice"
      backHref="/driver/queue"
      tab="queue"
      footer={
        <>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button size="lg" className="h-13 text-base font-bold" onClick={() => resolve("keep_record")} disabled={busy !== null || !online || !record.outcome}>
            {busy === "keep_record" ? "Saving…" : "Keep my delivery record"}
          </Button>
          <Button variant="outline" size="lg" className="h-11" onClick={() => resolve("flag_review")} disabled={busy !== null || !online}>
            {busy === "flag_review" ? "Sending…" : "Flag for dispatcher review"}
          </Button>
        </>
      }
    >
      <Notice tone="destructive" icon={TriangleAlert} title={`Sync conflict · ${stopName}`}>
        The plan changed while you were offline.
      </Notice>

      <div className="flex flex-col gap-1">
        <h2 className="text-2xl leading-tight font-bold">Choose which record to keep</h2>
        <p className="text-sm text-muted-foreground">
          Your offline delivery record and the dispatch plan disagree. Nothing is removed without your choice.
        </p>
      </div>

      <section aria-label="Your offline record" className="flex flex-col gap-2 rounded-xl border-2 border-info bg-info-muted p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-info uppercase">
            <Smartphone className="size-4" aria-hidden />
            Your offline record
          </span>
          <span className="text-xs text-muted-foreground">{formatTime(record.arrived_at ?? conflict.created_at)}</span>
        </div>
        <span className="text-lg font-bold">
          {record.outcome ? stopStatusLabel(record.outcome as StopStatus) : "Arrival only"}
          {record.completed_at ? ` at ${formatTime(record.completed_at)}` : ""}
        </span>
        <span className="text-sm text-muted-foreground">
          {record.pod
            ? `Signed for by ${record.pod.recipient_name}${record.pod.photo_url ? ", with a photo" : ""}.`
            : record.reason
              ? record.reason
              : "No proof of delivery recorded."}
        </span>
      </section>

      <div className="flex items-center gap-3" aria-hidden>
        <div className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">VERSUS</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <section aria-label="The current plan" className="flex flex-col gap-2 rounded-xl border-2 border-destructive/40 bg-destructive-muted p-4">
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-destructive uppercase">
          <Cloud className="size-4" aria-hidden />
          Current plan
        </span>
        <span className="text-lg font-bold">Stop removed by dispatch</span>
        <span className="text-sm text-muted-foreground">{removedBecause ?? "Removed before your record synced."}</span>
      </section>

      {!online && (
        <p className="text-sm text-muted-foreground">Resolving needs a connection: your record stays safe on the phone until then.</p>
      )}
      {!record.outcome && (
        <p className="text-sm text-muted-foreground">Only an arrival was recorded here, so it can only go to dispatch for review.</p>
      )}
    </DriverShell>
  );
}

export default function ConflictPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ConflictContent />
    </React.Suspense>
  );
}
