"use client";

import * as React from "react";
import Link from "next/link";
import { AlertRow } from "@/components/loader/alert-row";
import { InfoChip } from "@/components/loader/info-chip";
import { LoaderButton } from "@/components/loader/loader-button";
import { LoaderCard } from "@/components/loader/loader-card";
import { LoaderPill, type LoaderPillTone } from "@/components/loader/loader-pill";
import { LoaderScreen } from "@/components/loader/loader-screen";
import { OrderRow } from "@/components/loader/order-row";
import { formatClock, formatKg, formatM3, formatTime, planSource, stopsInLoadOrder } from "@/lib/loader/format";
import { listOutbox } from "@/lib/loader/offline/db";
import type { ChangeKind, Run, RunOrder, RunStop } from "@/lib/loader/types";
import { diffOrder, displayOrder, planChange } from "./plan-diff";

// The takeover's three groups, in the order Figma 2a numbers them.
const GROUPS: { kind: ChangeKind; title: string; card: string; heading: string }[] = [
  { kind: "unload_from_truck", title: "Unload from truck", card: "border-destructive/40", heading: "text-destructive" },
  { kind: "dont_load", title: "Don’t load", card: "border-border", heading: "text-muted-foreground" },
  { kind: "load_new", title: "Load new", card: "border-info/40", heading: "text-info" },
];

interface PlanChangeViewProps {
  run: Run;
  subtitle: string;
  /** The run's status pill, as the checklist shows it. */
  status: { tone: LoaderPillTone; label: string };
  /** Full name and initials of the loader who will be recorded as acknowledging. */
  loaderName: string;
  loaderInitials: string;
  onAcknowledge: () => void;
}

/**
 * The blocking plan-change takeover (Figma 2a / T2a, and 2d / T2d when the
 * change reopened a Ready run). It replaces the checklist rather than sitting
 * over it, so there is nothing to close and nothing to tap outside of: the
 * only way back to the checklist is to acknowledge.
 */
export function PlanChangeView(props: PlanChangeViewProps) {
  const to = props.run.unacknowledged_plan_version ?? props.run.current_plan_version;
  // A new run's first plan has nothing to compare with: no "v0 → v1" diff.
  return to <= 1 ? <NewRunView {...props} /> : <ChangedPlanView {...props} />;
}

/**
 * A new run's plan v1, waiting for the first acknowledgement: what the run is
 * and the driver's stop order, then "Start loading". Still blocking (the API
 * refuses row writes until a plan is acknowledged).
 */
function NewRunView({ run, subtitle, status, loaderName, loaderInitials, onAcknowledge }: PlanChangeViewProps) {
  const orders = run.stops.reduce((n, stop) => n + stop.orders.length, 0);
  const footer = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <AcknowledgingAs runCode={run.code} name={loaderName} initials={loaderInitials}>
        The Dispatcher sees who started loading, with the time.
      </AcknowledgingAs>
      <LoaderButton className="w-full md:w-auto" onClick={onAcknowledge}>
        Start loading
      </LoaderButton>
    </div>
  );

  return (
    <LoaderScreen title="New run" subtitle={subtitle} plan={planSource(run)} footer={footer}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <Link
            href="/loader"
            className="w-fit rounded-sm text-xs leading-[17px] font-medium text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Queue / {run.code}
          </Link>
          <h1 className="text-xl leading-[26px] font-semibold text-primary">New run · plan v1</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <LoaderPill tone="info">Plan v1</LoaderPill>
            <LoaderPill tone={status.tone}>{status.label}</LoaderPill>
          </div>
          <p className="text-xs leading-[17px] text-muted-foreground">
            {run.vehicle.code} · Trip {run.trip_number} · {run.district} · departs {formatTime(run.departs_at)}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <LoaderCard title="What to load" description={`${run.vehicle.code} · ${formatKg(run.vehicle.max_weight_kg)} / ${formatM3(run.vehicle.max_volume_m3)}`}>
            <p className="text-sm text-foreground">
              {orders} {orders === 1 ? "order" : "orders"} for {run.stops.length} {run.stops.length === 1 ? "stop" : "stops"}.
              The checklist opens once you start.
            </p>
          </LoaderCard>
          <LoaderCard title="Delivery order" description="Driver’s stops, first to last">
            <div className="flex flex-wrap gap-1.5">
              {[...run.stops]
                .sort((a, b) => a.stop_sequence - b.stop_sequence)
                .map((stop) => (
                  <InfoChip key={stop.stop_sequence}>
                    {stop.stop_sequence} · {stop.outlet.code}
                  </InfoChip>
                ))}
            </div>
          </LoaderCard>
        </div>
      </div>
    </LoaderScreen>
  );
}

/** "Acknowledging as Saman J. · Switch", with a line about what happens next. */
function AcknowledgingAs({ runCode, name, initials, children }: { runCode: string; name: string; initials: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initials}
        </span>
        <span className="text-sm font-medium text-foreground">Acknowledging as {name}</span>
        {/* Sign-in ends the open session for reason=switch_user, then returns here. */}
        <Link
          href={switchUserHref(runCode)}
          className="ml-2 flex min-h-12 items-center rounded-md px-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Switch
        </Link>
      </div>
      <p className="text-xs leading-[17px] text-muted-foreground">{children}</p>
    </div>
  );
}

/** Plan v2 and later: the blocking diff against the plan before it. */
function ChangedPlanView({
  run,
  subtitle,
  status,
  loaderName,
  loaderInitials,
  onAcknowledge,
}: PlanChangeViewProps) {
  const change = planChange(run);
  const to = run.unacknowledged_plan_version ?? run.current_plan_version;
  const from = change?.from_version ?? to - 1;
  const reopened = Boolean(change?.was_ready_at);
  const stale = useOfflineConflicts(run.code);

  const stops = stopsInLoadOrder(run.stops);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: stops.flatMap((stop) =>
      stop.orders
        .filter((order) => diffOrder(order).change_kind === group.kind)
        .map((order) => ({ stop, order })),
    ),
  })).filter((group) => group.items.length > 0);

  const title = reopened ? "Load reopened" : "Plan changed";
  const footer = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {loaderInitials}
          </span>
          <span className="text-sm font-medium text-foreground">Acknowledging as {loaderName}</span>
          {/* Sign-in ends the open session for reason=switch_user, then returns here. */}
          <Link
            href={switchUserHref(run.code)}
            className="ml-2 flex min-h-12 items-center rounded-md px-1.5 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Switch
          </Link>
        </div>
        <p className="text-xs leading-[17px] text-muted-foreground">
          {reopened
            ? "Status Ready → Loading. Load the change, then release again. Whoever acknowledges owns it."
            : "The Dispatcher sees who acknowledged it, with the time."}
        </p>
      </div>
      <LoaderButton className="w-full md:w-auto" onClick={onAcknowledge}>
        {reopened ? "Acknowledge · reopen load" : "Got it · acknowledge change"}
      </LoaderButton>
    </div>
  );

  return (
    <LoaderScreen title={title} subtitle={subtitle} plan={planSource(run)} footer={footer}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <Link
            href="/loader"
            className="w-fit rounded-sm text-xs leading-[17px] font-medium text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Queue / {run.code}
          </Link>
          <h1 className="text-xl leading-[26px] font-semibold text-primary">{title}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <LoaderPill tone="warning">
              v{from} → v{to}
            </LoaderPill>
            <LoaderPill tone={status.tone}>{status.label}</LoaderPill>
          </div>
          <p className="text-xs leading-[17px] text-muted-foreground">
            {run.vehicle.code} · Trip {run.trip_number} · {run.district} · departs {formatTime(run.departs_at)}
            {change?.was_ready_at && ` · was Ready ${formatTime(change.was_ready_at)}`}
          </p>
        </header>

        {change && to - from > 1 && (
          <AlertRow
            tone="warning"
            message={`Updated again · v${to} at ${formatTime(change.published_at)}. This shows v${from} → v${to}; confirm once.`}
          />
        )}
        {change && change.checks_saved > 0 && (
          <AlertRow
            tone="success"
            message={
              change.checks_saved === 1
                ? "Your 1 checked order is saved"
                : `Your ${change.checks_saved} checked orders are saved`
            }
          />
        )}
        {stale > 0 && (
          <AlertRow
            tone="warning"
            message={`${stale} ${stale === 1 ? "tap" : "taps"} made offline on the old plan did not go through. Check ${stale === 1 ? "it" : "them"} again on the checklist.`}
          />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group, index) => (
            <LoaderCard
              key={group.kind}
              className={group.card}
              title={
                <span className={`flex items-center gap-2 ${group.heading}`}>
                  <span className="flex size-6 items-center justify-center rounded-full border border-current text-xs">
                    {index + 1}
                  </span>
                  {group.title}
                </span>
              }
            >
              {group.items.map(({ stop, order }) => (
                <div key={order.order_number} className="flex flex-col gap-2">
                  <OrderRow order={groupRow(order, stop)} />
                  {diffOrder(order).reason && (
                    <p className="text-sm leading-5 text-muted-foreground">{diffOrder(order).reason}</p>
                  )}
                </div>
              ))}
            </LoaderCard>
          ))}

          {change && (
            <LoaderCard
              title="Capacity after change"
              description={`${run.vehicle.code} · ${formatKg(run.vehicle.max_weight_kg)} / ${formatM3(run.vehicle.max_volume_m3)}`}
            >
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Weight</dt>
                  <dd className="font-semibold text-foreground">
                    {formatKg(change.planned_weight_before_kg)} → {formatKg(change.planned_weight_after_kg)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Volume</dt>
                  <dd className="font-semibold text-foreground">
                    {change.planned_volume_before_m3.toFixed(1)} → {formatM3(change.planned_volume_after_m3)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-[17px] text-muted-foreground">
                {spareLine(run, change.planned_weight_after_kg, change.planned_volume_after_m3)}
              </p>
            </LoaderCard>
          )}

          <LoaderCard title="New delivery order" description={`Driver’s stops after v${to}`}>
            <div className="flex flex-wrap gap-1.5">
              {[...run.stops]
                .sort((a, b) => a.stop_sequence - b.stop_sequence)
                .map((stop) => (
                  <InfoChip key={stop.stop_sequence} tone={stop.is_new ? "info" : "neutral"}>
                    {stop.stop_sequence} · {stop.outlet.code}
                  </InfoChip>
                ))}
            </div>
          </LoaderCard>
        </div>
      </div>
    </LoaderScreen>
  );
}

/** Sign in as someone else, then come back to this run's takeover. */
function switchUserHref(runCode: string): string {
  const next = `/loader/runs/${encodeURIComponent(runCode)}`;
  return `/loader/sign-in?reason=switch_user&next=${encodeURIComponent(next)}`;
}

/** A row in a diff group. A new order says where it goes instead of a status. */
function groupRow(order: RunOrder, stop: RunStop): RunOrder {
  const row = displayOrder(order);
  if (diffOrder(order).change_kind !== "load_new") return row;
  const where = stop.is_new
    ? `New Stop ${stop.stop_sequence} · ${stop.outlet.dock_type} · ${formatClock(stop.outlet.window_start)}–${formatClock(stop.outlet.window_end)}`
    : `Adds to Stop ${stop.stop_sequence} · ${stop.outlet.code} · ${stop.outlet.dock_type}`;
  return { ...row, note: where };
}

function spareLine(run: Run, kg: number, m3: number): string {
  const spareKg = Math.round(run.vehicle.max_weight_kg - kg);
  const spareM3 = Math.round((run.vehicle.max_volume_m3 - m3) * 10) / 10;
  if (spareKg < 0 || spareM3 < 0) return "Over the vehicle limit — tell the Dispatcher before loading.";
  return `Still fits: ${formatKg(spareKg)} and ${formatM3(spareM3)} spare.`;
}

/**
 * Taps this tablet queued offline that the server refused because the plan
 * had moved on (the outbox marks them "conflict"). They are not replayed
 * against a plan the loader had not read; the loader is told to redo them.
 */
function useOfflineConflicts(runCode: string): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    listOutbox()
      .then((actions) => {
        if (cancelled) return;
        setCount(
          actions.filter(
            (a) =>
              a.run_code === runCode &&
              a.status === "conflict" &&
              (a.action_type === "check" || a.action_type === "uncheck" || a.action_type === "unload"),
          ).length,
        );
      })
      .catch(() => {
        // No IndexedDB: nothing was queued.
      });
    return () => {
      cancelled = true;
    };
  }, [runCode]);
  return count;
}
