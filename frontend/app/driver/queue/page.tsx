"use client";

// Sync queue: everything recorded on this phone that hasn't reached the server
// yet, conflicts to resolve, and records the server refused.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudCheck, CloudOff, CloudUpload, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { QueueItem } from "@/components/driver/queue-item";
import { deleteOutboxAction } from "@/lib/driver/offline/db";
import { formatTime } from "@/lib/driver/format";
import type { QueuedAction } from "@/lib/driver/types";

export default function QueuePage() {
  const router = useRouter();
  const { outbox, online, syncing, lastSync, pendingCount, conflictCount, failedCount, syncNow, refreshOutbox } = useDriver();
  const [discarding, setDiscarding] = React.useState<QueuedAction | null>(null);

  const pending = outbox.filter((item) => item.status === "pending");
  const failed = outbox.filter((item) => item.status === "failed");
  // One conflict card per stop: its arrival, outcome and proof conflict together.
  const conflictStops = [...new Map(
    outbox.filter((item) => item.status === "conflict" && item.stop_id != null).map((item) => [item.stop_id, item]),
  ).values()];

  async function discard() {
    if (!discarding) return;
    await deleteOutboxAction(discarding.client_action_id);
    await refreshOutbox();
    setDiscarding(null);
    toast("Record discarded.");
  }

  function syncAll() {
    void syncNow();
    router.push("/driver/queue/sync");
  }

  return (
    <DriverShell
      title="Sync queue"
      subtitle={
        pendingCount + conflictCount + failedCount === 0
          ? "Nothing waiting"
          : `${pendingCount} waiting · ${conflictCount + failedCount} need attention`
      }
      tab="queue"
      footer={
        pendingCount > 0 ? (
          <Button size="lg" className="h-13 text-base font-bold" onClick={syncAll} disabled={!online || syncing}>
            {online ? (syncing ? "Syncing…" : "Sync now") : "Waiting for signal"}
          </Button>
        ) : undefined
      }
    >
      {!online ? (
        <Notice tone="warning" icon={CloudOff} title="No connection">
          Everything below is saved on this phone. Keep driving: it syncs on its own when the signal returns.
        </Notice>
      ) : pendingCount > 0 ? (
        <Notice tone="info" icon={CloudUpload} title="Sending automatically">
          Records go out by themselves while you&apos;re online.
        </Notice>
      ) : (
        <Notice tone="success" icon={CloudCheck} title="Everything is synced">
          {lastSync ? `Last sync ${formatTime(lastSync.at)}.` : "Dispatch has all your records."}
        </Notice>
      )}

      {(conflictStops.length > 0 || failed.length > 0) && (
        <section aria-labelledby="attention" className="flex flex-col gap-2">
          <h2 id="attention" className="flex items-center gap-2 text-base font-bold text-destructive">
            <TriangleAlert className="size-5" aria-hidden />
            Needs your attention
          </h2>
          {conflictStops.map((item) => (
            <Link
              key={item.client_action_id}
              href={`/driver/queue/conflict?stop=${item.stop_id}`}
              className="flex flex-col gap-1 rounded-xl border-2 border-destructive/40 bg-destructive-muted p-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="text-sm font-bold text-destructive">Dispatch changed this stop while you were offline</span>
              <span className="text-sm">{item.label}</span>
              <span className="text-xs font-semibold text-destructive underline">Choose which record to keep</span>
            </Link>
          ))}
          {failed.length > 0 && (
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              {failed.map((item) => (
                <div key={item.client_action_id} className="flex flex-col">
                  <QueueItem item={item} />
                  <div className="flex justify-end px-3 pb-3">
                    <Button variant="outline" size="lg" className="h-10" onClick={() => setDiscarding(item)}>
                      Discard
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="waiting" className="flex flex-col gap-2">
          <h2 id="waiting" className="text-base font-bold">
            Waiting to sync
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {pending.map((item) => (
              <QueueItem key={item.client_action_id} item={item} />
            ))}
          </div>
        </section>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-card px-3 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Records keep the time you made them, not the time they sync, and a record is never applied twice.
      </p>

      <Dialog open={discarding !== null} onOpenChange={(open) => !open && setDiscarding(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard this record?</DialogTitle>
            <DialogDescription>
              {discarding?.label}. The server refused it{discarding?.last_error ? `: ${discarding.last_error}` : ""}. Discarding removes it
              from this phone; it won&apos;t reach dispatch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="lg" className="h-11" onClick={() => setDiscarding(null)}>
              Keep it
            </Button>
            <Button variant="destructive" size="lg" className="h-11" onClick={discard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DriverShell>
  );
}
