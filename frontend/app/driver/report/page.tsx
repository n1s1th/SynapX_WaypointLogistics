"use client";

// Report a problem to dispatch (brief p4: today drivers phone it in, and dispatch
// learns about problems late). Queued offline like every other record.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Clock,
  DoorClosed,
  PackageSearch,
  PackageX,
  Store,
  Thermometer,
  TrafficCone,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { PhotoCapture } from "@/components/driver/photo-capture";
import { cn } from "@/lib/utils";
import { isStopDone, nextStop } from "@/lib/driver/format";
import { useActiveTripId, useTrip } from "@/lib/driver/hooks";
import type { IssuePayload, IssueType } from "@/lib/driver/types";

const CATEGORIES: { label: string; type: IssueType; icon: typeof Store }[] = [
  { label: "Outlet closed", type: "customer_unavailable", icon: Store },
  { label: "Mall window missed", type: "customer_unavailable", icon: Clock },
  { label: "Access blocked or van only", type: "other", icon: DoorClosed },
  { label: "Damaged goods", type: "damaged_goods", icon: PackageX },
  { label: "Temperature problem", type: "other", icon: Thermometer },
  { label: "Short or wrong items", type: "other", icon: PackageSearch },
  { label: "Vehicle breakdown", type: "vehicle_breakdown", icon: Truck },
  { label: "Traffic or road closed", type: "traffic_delay", icon: TrafficCone },
];

function ReportContent() {
  const router = useRouter();
  const params = useSearchParams();
  const active = useActiveTripId();
  const tripId = Number(params.get("trip")) || active.tripId;
  const trip = useTrip(tripId);
  const { perform, online } = useDriver();
  const data = trip.data;
  const stopParam = Number(params.get("stop")) || null;
  const defaultStop = stopParam ?? (data ? nextStop(data.stops)?.id ?? null : null);

  const [category, setCategory] = React.useState<string | null>(null);
  const [stopChoice, setStopChoice] = React.useState<number | "none" | null>(null);
  const [note, setNote] = React.useState("");
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const stopId = stopChoice === "none" ? null : stopChoice ?? defaultStop;

  async function submit() {
    if (!data) return;
    const picked = CATEGORIES.find((item) => item.label === category);
    if (!picked) return setError("Pick what the problem is.");
    const stop = data.stops.find((item) => item.id === stopId);
    const payload: IssuePayload = {
      issue_type: picked.type,
      category: picked.label,
      description: note.trim() || picked.label,
      stop_id: stop?.id ?? null,
    };
    if (photo) payload.photo_url = photo;
    setBusy(true);
    await perform({
      action_type: "issue",
      trip_id: data.id,
      stop_id: null,
      payload,
      label: `${picked.label}${stop ? ` · ${stop.name}` : ""}`,
    });
    toast.success(online ? "Sent to dispatch." : "Saved on this phone: dispatch gets it when you're back online.");
    router.push(`/driver/trip?id=${data.id}`);
  }

  if (!data) {
    return (
      <DriverShell title="Report a problem" tab="report">
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-8 text-center">
          <span className="font-bold">{trip.loading || active.loading ? "Loading your trip…" : "No trip on the road"}</span>
          <span className="text-sm text-muted-foreground">Problems are reported against the trip you&apos;re driving.</span>
          <Button asChild variant="outline" size="lg" className="h-11">
            <Link href="/driver">Go to today&apos;s trips</Link>
          </Button>
        </section>
      </DriverShell>
    );
  }

  const openStops = data.stops.filter((stop) => !isStopDone(stop) || stop.id === stopId);

  return (
    <DriverShell
      title="Report a problem"
      subtitle={`${data.run?.code ?? `Trip ${data.id}`} · goes to dispatch`}
      tab="report"
      footer={
        <>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button size="lg" className="h-13 text-base font-bold" onClick={submit} disabled={busy}>
            Send to dispatch
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-bold">What&apos;s wrong?</legend>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((item) => {
            const Icon = item.icon;
            const selected = category === item.label;
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setCategory(item.label);
                  setError(null);
                }}
                className={cn(
                  "flex min-h-14 items-center gap-2 rounded-xl border-2 bg-card px-3 py-2 text-left text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected ? "border-primary bg-accent" : "border-border",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {selected && <Check className="size-4 text-primary" aria-hidden />}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-bold">Which stop?</legend>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {openStops.map((stop) => (
            <label key={stop.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <input
                type="radio"
                name="report-stop"
                className="size-5 accent-primary"
                checked={stopId === stop.id}
                onChange={() => setStopChoice(stop.id)}
              />
              <span className="text-sm">
                <span className="font-semibold">Stop {stop.sequence}</span> · {stop.name}
              </span>
            </label>
          ))}
          <label className="flex min-h-12 items-center gap-3 px-3 py-2">
            <input
              type="radio"
              name="report-stop"
              className="size-5 accent-primary"
              checked={stopId === null}
              onChange={() => setStopChoice("none")}
            />
            <span className="text-sm">Not about a stop (on the road)</span>
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-note">Details for dispatch</Label>
        <Textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={1500}
          className="text-base"
          placeholder="What happened, and what you need from dispatch"
        />
      </div>

      <PhotoCapture value={photo} onChange={setPhoto} label="Add a photo (optional)" />
    </DriverShell>
  );
}

export default function ReportPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ReportContent />
    </React.Suspense>
  );
}
