"use client";

// What happened at the stop (brief p6: "record delivery outcomes"). Full or
// partial goes on to proof of delivery; not delivered needs a reason, skips the
// proof, and dispatch hears about it.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Minus, PackageCheck, PackageMinus, PackageX, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { cn } from "@/lib/utils";
import { stopStatusLabel } from "@/lib/driver/format";
import { useTripStop } from "@/lib/driver/hooks";
import type { DriverStop, DriverTrip, OutcomePayload, StopOutcome } from "@/lib/driver/types";

const OPTIONS: { value: StopOutcome; title: string; detail: string; icon: typeof PackageCheck }[] = [
  { value: "delivered", title: "Full delivery", detail: "Every order on the truck was handed over.", icon: PackageCheck },
  { value: "partial", title: "Partial delivery", detail: "Some units weren't handed over.", icon: PackageMinus },
  { value: "failed", title: "Not delivered", detail: "Nothing could be handed over.", icon: PackageX },
];

const PARTIAL_REASONS = ["Short on the truck", "Damaged in transit", "Store refused some items", "No space to receive"];
const FAILURE_REASONS = ["Outlet closed", "No one to receive", "Mall window missed", "Access blocked", "Goods refused", "Goods damaged"];

function ChoiceChips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "min-h-11 rounded-full border px-3.5 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              value === option ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function OutcomeForm({ trip, stop }: { trip: DriverTrip; stop: DriverStop }) {
  const router = useRouter();
  const { perform } = useDriver();
  const onTruck = stop.orders.filter((order) => order.on_truck);
  const recorded = ["delivered", "partial", "failed"].includes(stop.status) ? (stop.status as StopOutcome) : null;
  const [outcome, setOutcome] = React.useState<StopOutcome>(recorded ?? "delivered");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [units, setUnits] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(onTruck.map((order) => [order.order_number, order.units ?? 0])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const proofHref = `/driver/trip/proof?trip=${trip.id}&stop=${stop.id}`;
  const completeHref = `/driver/trip/complete?trip=${trip.id}&stop=${stop.id}`;

  if (stop.completed_at) {
    return (
      <DriverShell title={stop.name} subtitle={`Stop ${stop.sequence}`} backHref={`/driver/trip?id=${trip.id}`}>
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <span className="text-lg font-bold">Recorded: {stopStatusLabel(stop.status)}</span>
          {stop.note && <p className="text-sm text-muted-foreground">{stop.note}</p>}
          <Button asChild size="lg" className="h-12">
            <Link href={completeHref}>Continue</Link>
          </Button>
        </section>
      </DriverShell>
    );
  }

  const shortened = Object.fromEntries(
    onTruck
      .filter((order) => order.units != null && units[order.order_number] < (order.units ?? 0))
      .map((order) => [order.order_number, units[order.order_number]]),
  );

  async function submit() {
    setError(null);
    if (outcome === "failed" && !reason) return setError("Pick why the delivery couldn't be made.");
    if (outcome === "partial" && Object.keys(shortened).length === 0) {
      return setError("Lower the units for the orders that weren't fully handed over.");
    }
    const payload: OutcomePayload = { outcome };
    if (reason) payload.reason = reason;
    if (note.trim()) payload.note = note.trim();
    if (outcome === "partial") payload.delivered_units = shortened;
    setBusy(true);
    const title = OPTIONS.find((option) => option.value === outcome)?.title ?? outcome;
    await perform({ action_type: "outcome", trip_id: trip.id, stop_id: stop.id, payload, label: `${title} · ${stop.name}` });
    router.push(outcome === "failed" ? completeHref : proofHref);
  }

  return (
    <DriverShell
      title={stop.name}
      subtitle={`Stop ${stop.sequence} · what happened here?`}
      backHref={`/driver/trip/arrived?trip=${trip.id}&stop=${stop.id}`}
      footer={
        <>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button size="lg" className="h-13 text-base font-bold" onClick={submit} disabled={busy}>
            {outcome === "failed" ? "Save · not delivered" : "Continue to proof of delivery"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Outcome" className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const selected = outcome === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setOutcome(option.value);
                setReason("");
                setError(null);
              }}
              className={cn(
                "flex min-h-16 items-center gap-3 rounded-xl border-2 bg-card p-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected ? "border-success bg-success-muted" : "border-border",
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", selected ? "bg-success text-white" : "bg-muted")}>
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-bold">{option.title}</span>
                <span className="text-xs text-muted-foreground">{option.detail}</span>
              </span>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                  selected ? "border-success bg-success text-white" : "border-border",
                )}
              >
                {selected && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>

      {outcome === "partial" && (
        <section aria-labelledby="units" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 id="units" className="text-sm font-bold">
            Units handed over
          </h2>
          {onTruck.map((order) => {
            const planned = order.units ?? 0;
            const value = units[order.order_number] ?? planned;
            const set = (next: number) => setUnits((current) => ({ ...current, [order.order_number]: Math.max(0, Math.min(planned, next)) }));
            return (
              <div key={order.order_number} className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">{order.order_number}</span>
                  <span className="text-xs text-muted-foreground">
                    of {planned} units · {order.temperature}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon-lg" className="size-11" onClick={() => set(value - 1)} aria-label={`One fewer for ${order.order_number}`}>
                    <Minus aria-hidden />
                  </Button>
                  <span className="w-10 text-center text-base font-bold tabular-nums" aria-live="polite">
                    {value}
                  </span>
                  <Button type="button" variant="outline" size="icon-lg" className="size-11" onClick={() => set(value + 1)} aria-label={`One more for ${order.order_number}`}>
                    <Plus aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
          <ChoiceChips label="Why?" options={PARTIAL_REASONS} value={reason} onChange={setReason} />
        </section>
      )}

      {outcome === "failed" && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <ChoiceChips label="Why couldn't it be delivered?" options={FAILURE_REASONS} value={reason} onChange={setReason} />
          <p className="text-xs text-muted-foreground">
            Dispatch gets your reason as a problem report and decides when the orders go out again.
          </p>
        </section>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="outcome-note">Note for dispatch (optional)</Label>
        <Textarea id="outcome-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="text-base" />
      </div>
    </DriverShell>
  );
}

function OutcomeContent() {
  const { trip, stop } = useTripStop();
  if (!trip.data || !stop) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref={trip.data ? `/driver/trip?id=${trip.data.id}` : "/driver/trip"} />;
  }
  return <OutcomeForm key={stop.id} trip={trip.data} stop={stop} />;
}

export default function OutcomePage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <OutcomeContent />
    </React.Suspense>
  );
}
