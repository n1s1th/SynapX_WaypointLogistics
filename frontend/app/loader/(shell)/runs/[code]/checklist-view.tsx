"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Snowflake, Truck } from "lucide-react";
import { CapacityCard } from "@/components/loader/capacity-card";
import { InfoChip } from "@/components/loader/info-chip";
import { LoadMap } from "@/components/loader/load-map";
import { LoaderButton } from "@/components/loader/loader-button";
import { LoaderCard } from "@/components/loader/loader-card";
import { LoaderPill, type LoaderPillTone } from "@/components/loader/loader-pill";
import { LoaderScreen } from "@/components/loader/loader-screen";
import { useLoaderShell } from "@/components/loader/loader-shell";
import { useLoaderSync, useOfflineRun } from "@/components/loader/loader-sync-provider";
import { openFlagSheet } from "@/components/loader/flag-issue-sheet";
import { OrderRow } from "@/components/loader/order-row";
import { AlertRow } from "@/components/loader/alert-row";
import { StopHeader } from "@/components/loader/stop-header";
import {
  formatClock,
  formatKg,
  formatM3,
  formatTime,
  isActiveOrder,
  loadMapSlots,
  planSource,
  runCapacity,
  stopsInLoadOrder,
} from "@/lib/loader/format";
import type { OrderState, QueuedActionType, Run, RunOrder, RunStatus, RunStop } from "@/lib/loader/types";
import { ChangeLogCard } from "./change-log-card";
import { loadRun, ordersLoaded, type LoadResult } from "./checklist-data";
import { PlanChangeView } from "./plan-change-view";
import { blockerSummary, displayOrder, pendingUnloads, releaseBlockers } from "./plan-diff";
import { UnloadCard } from "./unload-card";
import { usePlanPoll } from "./use-plan-poll";
import { reviewHref } from "./routes";

// Same labels and tones as the queue's run card.
const statusPill: Record<RunStatus, { tone: LoaderPillTone; label: string }> = {
  not_started: { tone: "neutral", label: "Not started" },
  loading: { tone: "warning", label: "Loading" },
  issue_flagged: { tone: "error", label: "Issue flagged" },
  loaded: { tone: "primary", label: "Loaded" },
  ready_to_depart: { tone: "success", label: "Ready to depart" },
  gated_out: { tone: "neutral", label: "Gated out" },
};

const BRAND_LABELS = { fresh: "Fresh", style: "Style", tech: "Tech" } as const;

// What tapping a row's check tile sends. A check on a re_check row confirms it
// (the API takes it to loaded, as recheck does). Other states are not toggleable.
const toggleAction: Partial<Record<OrderState, QueuedActionType>> = {
  to_load: "check",
  new: "check",
  re_check: "check",
  loaded: "uncheck",
};

// Once signed off or through the gate the checklist is read-only; reopening
// after Ready is the plan-change flow (L7).
const CLOSED: RunStatus[] = ["ready_to_depart", "gated_out"];

export function ChecklistView({ code }: { code: string }) {
  const { transport } = useLoaderSync();
  const [result, setResult] = React.useState<LoadResult>();
  const onNewPlan = React.useCallback((run: Run) => setResult({ kind: "ok", run }), []);

  React.useEffect(() => {
    let cancelled = false;
    void loadRun(code, transport).then((loaded) => {
      if (!cancelled) setResult(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [code, transport]);

  if (!result) {
    return (
      <LoaderScreen title="Loading checklist">
        <p role="status" className="text-sm text-muted-foreground">
          Loading {code}…
        </p>
      </LoaderScreen>
    );
  }
  if (result.kind !== "ok") {
    return (
      <LoaderScreen title="Loading checklist">
        <div className="mx-auto flex max-w-md flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-base font-semibold text-primary">
            {result.kind === "not_found" ? `${code} is not on this dock's queue.` : `${code} is not available offline.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {result.kind === "not_found"
              ? "Check the run code, or pick the run from the queue."
              : "This tablet has not opened the run before. Reconnect to load it."}
          </p>
          <Link href="/loader" className="text-sm font-medium text-info underline-offset-4 hover:underline">
            Back to the queue
          </Link>
        </div>
      </LoaderScreen>
    );
  }
  return <Checklist initial={result.run} onNewPlan={onNewPlan} />;
}

function Checklist({ initial, onNewPlan }: { initial: Run; onNewPlan: (run: Run) => void }) {
  const router = useRouter();
  const { user } = useLoaderShell();
  // A fresh server run replaces `initial`; useOfflineRun then resolves it
  // against this tablet's queued actions, so local taps are never lost.
  const { run, act } = useOfflineRun(initial, user.shortName);
  usePlanPoll(run, onNewPlan);

  const capacity = runCapacity(run);
  const stops = stopsInLoadOrder(run.stops);
  const slots = loadMapSlots(run);
  const status = statusPill[run.status];
  const closed = CLOSED.includes(run.status);
  const loaded = ordersLoaded(run);
  const { orders_checked: checked, orders_total: total } = run;
  const unloads = pendingUnloads(run.stops);
  const blockers = releaseBlockers(run);
  // take_off rows are outside orders_total, so "all checked" is not enough
  // while one is still on the truck.
  const reviewUnlocked = total > 0 && checked === total && !closed && unloads.length === 0;
  const vehicleLabel = run.vehicle.vehicle_type === "van" ? "Van" : "Truck";
  const reefer = run.vehicle.temp_capability === "reefer";
  const href = reviewHref(run.code);

  React.useEffect(() => {
    if (reviewUnlocked) router.prefetch(href);
  }, [reviewUnlocked, router, href]);

  const subtitle = `${run.code} · ${run.dock} · ${user.shortName}`;

  // A plan nobody has acknowledged blocks the checklist (the API refuses row
  // writes until then, 409 PLAN_NOT_ACKNOWLEDGED).
  if (run.unacknowledged_plan_version != null) {
    return (
      <PlanChangeView
        run={run}
        subtitle={subtitle}
        status={status}
        loaderName={user.name}
        loaderInitials={user.initials}
        onAcknowledge={() => void act("acknowledge", {})}
      />
    );
  }

  const onToggle = (order: RunOrder) => {
    const action = toggleAction[order.state];
    if (action) void act(action, { order_number: order.order_number });
  };

  const alsoWaiting = blockerSummary(blockers);
  const footer = (
    <div className="flex flex-col gap-2 md:flex-row-reverse md:items-center md:justify-between md:gap-4">
      {unloads.length > 0 && !closed ? (
        <LoaderButton className="w-full md:w-auto" locked>
          Release locked · unload first
        </LoaderButton>
      ) : (
        <LoaderButton
          className="w-full md:w-auto"
          disabled={!reviewUnlocked}
          onClick={() => router.push(href)}
        >
          Review &amp; confirm · {checked} of {total}
        </LoaderButton>
      )}
      <p className="text-xs leading-[17px] text-muted-foreground">
        {unloads.length > 0 && !closed
          ? alsoWaiting
            ? `Also waiting: ${alsoWaiting}.`
            : "Unload first, then review."
          : footerHint(run)}
      </p>
    </div>
  );

  const unloadCards = closed
    ? []
    : unloads.map(({ stop, order }) => (
        <UnloadCard
          key={order.order_number}
          stop={stop}
          order={order}
          stops={run.stops}
          onUnloaded={() => void act("unload", { order_number: order.order_number })}
        />
      ));

  return (
    <LoaderScreen
      title="Loading checklist"
      subtitle={subtitle}
      plan={planSource(run)}
      footer={footer}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 md:grid md:grid-cols-[248px_1fr] md:items-start md:gap-6">
        <aside aria-label="Vehicle" className="hidden flex-col gap-4 md:sticky md:top-28 md:flex">
          {unloadCards}
          <CapacityCard {...capacity} />
          <LoaderCard title="Load map" description="Cab to door, as seen from the dock">
            <LoadMap slots={slots} spareM3={capacity.spareM3} />
          </LoaderCard>
          <ChangeLogCard code={run.code} />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-col gap-1.5">
            <Link
              href="/loader"
              className="w-fit rounded-sm text-xs leading-[17px] font-medium text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Queue / {run.code}
            </Link>
            <h1 className="text-xl leading-[26px] font-semibold text-primary">
              {run.vehicle.code} · Trip {run.trip_number}
              <span className="hidden md:inline"> · Loading checklist</span>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <LoaderPill tone={status.tone}>{status.label}</LoaderPill>
              <InfoChip icon={<Truck />}>{vehicleLabel}</InfoChip>
              {reefer && (
                <InfoChip tone="info" icon={<Snowflake />}>
                  Reefer
                </InfoChip>
              )}
              <InfoChip className="hidden md:inline-flex">
                {formatKg(run.vehicle.max_weight_kg)} · {formatM3(run.vehicle.max_volume_m3)}
              </InfoChip>
            </div>
            <p className="text-xs leading-[17px] text-muted-foreground">
              {BRAND_LABELS[run.brand]} · {run.district} · {run.stops.length} stops · departs{" "}
              {formatTime(run.departs_at)}
              <span className="hidden md:inline">
                {" "}· {loaded} of {total} orders in
              </span>
            </p>
          </header>

          <WindowWarning stops={run.stops} />

          <div className="flex flex-col gap-4 md:hidden">
            {unloadCards}
            <CapacityCard {...capacity} />
            <LoaderCard
              title={`${vehicleLabel}, cab to door`}
              description={`${loaded} of ${total} orders in · ${loadMapHint(run, loaded)}`}
            >
              <LoadMap slots={slots} spareM3={capacity.spareM3} orientation="horizontal" />
            </LoaderCard>
          </div>

          {stops.map((stop) => (
            <section
              key={stop.stop_sequence}
              aria-label={`Stop ${stop.stop_sequence}, ${stop.outlet.code}`}
              className="flex flex-col gap-2"
            >
              <StopHeader stop={stop} stopCount={stops.length} />
              <WindowChip stop={stop} />
              {stop.orders.map((order) => (
                <OrderRow
                  key={order.order_number}
                  order={displayOrder(order)}
                  onToggle={closed || !toggleAction[order.state] ? undefined : onToggle}
                  onFlag={closed ? undefined : (o) => openFlagSheet(run, o, act)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
    </LoaderScreen>
  );
}

/** Active orders that still need the loader (not loaded, not flagged). */
function openOrders(run: Run): RunOrder[] {
  return run.stops
    .flatMap((s) => s.orders)
    .filter((o) => isActiveOrder(o) && o.state !== "loaded" && o.state !== "flagged");
}

function onlyNewOrdersLeft(run: Run): boolean {
  const open = openOrders(run);
  return open.length > 0 && open.every((o) => o.state === "new");
}

/** Second line of the cab-to-door card (Figma 1c, 1c.1, 9, 10). */
function loadMapHint(run: Run, loaded: number): string {
  if (run.orders_total > 0 && run.orders_checked === run.orders_total) return "close the door";
  if (onlyNewOrdersLeft(run)) return "new order goes by the door";
  const next = stopsInLoadOrder(run.stops).find((stop) =>
    stop.orders.some((o) => isActiveOrder(o) && o.state !== "loaded" && o.state !== "flagged"),
  );
  if (!next) return "nothing to load";
  return loaded === 0 ? `start at the cab with Stop ${next.stop_sequence}` : `next: Stop ${next.stop_sequence}`;
}

/** Line under the review button (Figma 1c, 1c.1, 9, 10, 16). */
function footerHint(run: Run): string {
  if (CLOSED.includes(run.status)) return `${statusPill[run.status].label}. The checklist is closed.`;
  const { orders_checked: checked, orders_total: total } = run;
  if (total > 0 && checked === total) {
    const done = checked > ordersLoaded(run) ? "checked or flagged" : "checked";
    return `All ${total} orders ${done}. Review once, then release.`;
  }
  if (onlyNewOrdersLeft(run)) return "Load the new order by the door to unlock.";
  return `Unlocks when all ${total} orders are checked or flagged.`;
}

/** The outlet's delivery window, "05:00–07:30". */
function windowLabel(stop: RunStop): string {
  return `${formatClock(stop.outlet.window_start)}–${formatClock(stop.outlet.window_end)}`;
}

/** Under a stop's header: the truck reaches it after (or near the end of) the outlet's window. */
function WindowChip({ stop }: { stop: RunStop }) {
  if (stop.window_status === "closed") {
    return (
      <LoaderPill tone="error" className="w-fit">
        Window closed · {windowLabel(stop)}
      </LoaderPill>
    );
  }
  if (stop.window_status === "closing") {
    return (
      <LoaderPill tone="warning" className="w-fit">
        Window closing · {windowLabel(stop)}
      </LoaderPill>
    );
  }
  return null;
}

/** On the run: stops the truck will reach after their window. Loading is not blocked. */
function WindowWarning({ stops }: { stops: RunStop[] }) {
  const closed = [...stops]
    .filter((stop) => stop.window_status === "closed")
    .sort((a, b) => a.stop_sequence - b.stop_sequence);
  if (closed.length === 0) return null;
  const list = closed.map((stop) => `${stop.outlet.code} (${windowLabel(stop)})`).join(", ");
  return (
    <AlertRow
      tone="error"
      message={`Delivery window closed for ${closed.length === 1 ? "1 stop" : `${closed.length} stops`}: ${list}. Keep loading and tell the Dispatcher.`}
    />
  );
}
