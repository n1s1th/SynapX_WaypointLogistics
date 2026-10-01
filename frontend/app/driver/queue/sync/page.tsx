"use client";

// Sync in progress, then its result: how many records went through, conflicts to
// resolve, records refused, or still no connection. Started from the queue screen.

import Link from "next/link";
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { QueueItem } from "@/components/driver/queue-item";
import { formatTime } from "@/lib/driver/format";

export default function SyncingPage() {
  const { syncing, lastSync, outbox, online, pendingCount, conflictCount, syncNow } = useDriver();
  const result = lastSync?.result;
  const remaining = outbox.filter((item) => item.status !== "failed");

  return (
    <DriverShell
      title={syncing ? "Syncing…" : "Sync"}
      subtitle={lastSync && !syncing ? `Finished ${formatTime(lastSync.at)}` : undefined}
      backHref="/driver/queue"
      tab="queue"
      footer={
        conflictCount > 0 ? (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href="/driver/queue">Resolve {conflictCount === 1 ? "the conflict" : "conflicts"}</Link>
          </Button>
        ) : pendingCount > 0 ? (
          <Button size="lg" className="h-13 text-base font-bold" onClick={() => void syncNow()} disabled={syncing || !online}>
            {online ? "Try again" : "Waiting for signal"}
          </Button>
        ) : (
          <Button asChild size="lg" className="h-13 text-base font-bold">
            <Link href="/driver">Back to today&apos;s trips</Link>
          </Button>
        )
      }
    >
      {syncing ? (
        <section className="flex flex-col gap-3 rounded-xl border-2 border-info bg-info-muted p-4" aria-live="polite">
          <div className="flex items-center gap-2 text-info">
            <RefreshCw className="size-5 animate-spin" aria-hidden />
            <span className="text-lg font-bold">Sending {pendingCount} record{pendingCount === 1 ? "" : "s"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-info/20">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-info" />
          </div>
          <span className="text-xs text-info">You can keep driving: it carries on in the background.</span>
        </section>
      ) : !result ? (
        <Notice tone="info" icon={RefreshCw} title="Nothing sent yet">
          Start a sync from the queue.
        </Notice>
      ) : result.offline ? (
        <Notice tone="warning" icon={CloudOff} title="Still no connection">
          Your records are safe on this phone. They go out on their own when the signal returns.
        </Notice>
      ) : (
        <div className="flex flex-col gap-2" aria-live="polite">
          {result.sent > 0 && (
            <Notice tone="success" icon={CheckCircle2} title={`${result.sent} record${result.sent === 1 ? "" : "s"} synced`}>
              Dispatch and the stores can see them now.
            </Notice>
          )}
          {result.conflicts > 0 && (
            <Notice tone="destructive" icon={TriangleAlert} title={`${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"} to resolve`}>
              The plan changed while you were offline. Nothing is lost: choose which record to keep.
            </Notice>
          )}
          {result.failed > 0 && (
            <Notice tone="destructive" icon={TriangleAlert} title={`${result.failed} record${result.failed === 1 ? "" : "s"} refused`}>
              See the reason on the queue screen.
            </Notice>
          )}
          {result.sent + result.conflicts + result.failed === 0 && (
            <Notice tone="success" icon={CheckCircle2} title="Everything is synced">
              Nothing was waiting.
            </Notice>
          )}
        </div>
      )}

      {remaining.length > 0 && (
        <section aria-labelledby="still-on-phone" className="flex flex-col gap-2">
          <h2 id="still-on-phone" className="text-base font-bold">
            Still on this phone
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {remaining.map((item) => (
              <QueueItem key={item.client_action_id} item={item} />
            ))}
          </div>
        </section>
      )}
    </DriverShell>
  );
}
