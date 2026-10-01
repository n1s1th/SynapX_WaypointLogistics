"use client";

// Emergency alert to dispatch with the phone's location. Sent at once when there's
// signal; without it, queued and sent the moment it returns, and the screen
// points to numbers that work without data.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Car, Ellipsis, Flame, HeartPulse, MapPin, Route, ShieldAlert, TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { EmergencyCalls } from "@/components/driver/emergency-calls";
import { cn } from "@/lib/utils";
import { driverApi } from "@/lib/driver/api";
import { nextStop } from "@/lib/driver/format";
import { useActiveTripId, useGeolocation, useTrip } from "@/lib/driver/hooks";
import type { SosPayload } from "@/lib/driver/types";

const TYPES = [
  { label: "Accident", icon: TriangleAlert },
  { label: "Medical emergency", icon: HeartPulse },
  { label: "Safety or security", icon: ShieldAlert },
  { label: "Vehicle breakdown", icon: Car },
  { label: "Dangerous road", icon: Route },
  { label: "Vehicle fire", icon: Flame },
  { label: "Other emergency", icon: Ellipsis },
];

export default function SosPage() {
  const router = useRouter();
  const active = useActiveTripId();
  const trip = useTrip(active.tripId);
  const { perform, online } = useDriver();
  const geo = useGeolocation(true);
  const [type, setType] = React.useState("Accident");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const current = trip.data ? nextStop(trip.data.stops) : undefined;

  async function send() {
    setBusy(true);
    setError(null);
    const payload: SosPayload = {
      driver_trip_id: trip.data?.id ?? null,
      latitude: geo.fix?.latitude ?? null,
      longitude: geo.fix?.longitude ?? null,
      message: [type, note.trim(), current ? `near stop ${current.sequence} ${current.name}` : ""].filter(Boolean).join(" · "),
    };
    if (online) {
      try {
        const alert = await driverApi.sos(payload);
        router.push(`/driver/sos/success?id=${alert.id}`);
        return;
      } catch (err) {
        if (err instanceof ApiError && !err.isNetworkError) {
          setError(`The alert was refused: ${err.message}. Call one of the numbers above.`);
          setBusy(false);
          return;
        }
        // No signal after all: queue it below.
      }
    }
    await perform({ action_type: "sos", trip_id: trip.data?.id ?? null, payload, label: `SOS · ${type}` });
    router.push("/driver/sos/success?queued=1");
  }

  return (
    <DriverShell
      title="Emergency"
      subtitle="Dispatch gets your location and trip"
      backHref="/driver"
      sos={false}
      footer={
        <>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button size="lg" className="h-14 bg-destructive text-base font-bold text-white hover:bg-destructive/90" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send emergency alert"}
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-11">
            <Link href="/driver">Cancel</Link>
          </Button>
        </>
      }
    >
      <EmergencyCalls />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base font-bold">What&apos;s happening?</legend>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((item, index) => {
            const Icon = item.icon;
            const selected = type === item.label;
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(item.label)}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-lg border-2 px-3 text-left text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected ? "border-destructive bg-destructive-muted text-destructive" : "border-border bg-card",
                  index === TYPES.length - 1 && TYPES.length % 2 === 1 && "col-span-2",
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-bold">Your location</span>
          {geo.fix ? (
            <span className="text-muted-foreground tabular-nums">
              {geo.fix.latitude.toFixed(5)}, {geo.fix.longitude.toFixed(5)} · ±{Math.round(geo.fix.accuracy)} m
            </span>
          ) : (
            <span className="text-muted-foreground">
              {geo.status === "denied"
                ? "Location is blocked in the phone settings. The alert still goes with your trip."
                : geo.status === "unavailable"
                  ? "Location isn't available. The alert still goes with your trip."
                  : "Finding your location…"}
            </span>
          )}
          {trip.data && (
            <span className="text-xs text-muted-foreground">
              {trip.data.run?.code ?? `Trip ${trip.data.id}`}
              {current ? ` · next stop ${current.sequence}, ${current.name}` : ""}
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sos-note">Tell dispatch what happened (optional)</Label>
        <Textarea id="sos-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} className="text-base" />
      </div>
    </DriverShell>
  );
}
