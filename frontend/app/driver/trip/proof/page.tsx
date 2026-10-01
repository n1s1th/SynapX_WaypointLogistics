"use client";

// Proof of delivery (brief p6: "so disputes do not depend on memory"): who took
// the goods, their signature, and a photo. Saved on the phone at once and synced
// when there's signal; the store sees the delivery before confirming receipt.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { Notice } from "@/components/driver/notice";
import { StopStatusBadge } from "@/components/driver/badges";
import { PhotoCapture } from "@/components/driver/photo-capture";
import { SignaturePad } from "@/components/driver/signature-pad";
import { StopUnavailable } from "@/components/driver/stop-unavailable";
import { useTripStop } from "@/lib/driver/hooks";
import type { DockType, DriverStop, DriverTrip, PodPayload } from "@/lib/driver/types";

const PHOTO_HINT: Record<DockType, string> = {
  rear_dock: "The delivered goods at the rear dock.",
  street: "The delivered goods at the curb.",
  mall_bay: "The delivered goods in the mall bay.",
};

function ProofForm({ trip, stop }: { trip: DriverTrip; stop: DriverStop }) {
  const router = useRouter();
  const { perform, online } = useDriver();
  const [recipient, setRecipient] = React.useState("");
  const [signature, setSignature] = React.useState<string | null>(null);
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const completeHref = `/driver/trip/complete?trip=${trip.id}&stop=${stop.id}`;

  if (stop.pod) {
    return (
      <DriverShell title="Proof of delivery" subtitle={stop.name} backHref={`/driver/trip?id=${trip.id}`}>
        <Notice tone="success" icon={CheckCircle2} title={`Signed for by ${stop.pod.recipient_name}`}>
          {stop.pod.has_signature ? "Signature" : ""}
          {stop.pod.has_signature && stop.pod.has_photo ? " and photo" : stop.pod.has_photo ? "Photo" : ""} saved.
        </Notice>
        <Button asChild size="lg" className="h-12">
          <Link href={completeHref}>Continue</Link>
        </Button>
      </DriverShell>
    );
  }

  if (stop.status !== "delivered" && stop.status !== "partial") {
    return (
      <DriverShell title="Proof of delivery" subtitle={stop.name} backHref={`/driver/trip?id=${trip.id}`}>
        <Notice tone="info" icon={CheckCircle2} title="Record what happened first">
          Proof of delivery follows a full or partial delivery.
        </Notice>
        <Button asChild size="lg" className="h-12">
          <Link href={`/driver/trip/outcome?trip=${trip.id}&stop=${stop.id}`}>Record the outcome</Link>
        </Button>
      </DriverShell>
    );
  }

  async function submit() {
    setError(null);
    if (!recipient.trim()) return setError("Enter the name of the person who took the goods.");
    if (!signature && !photo) return setError("Get their signature, or add a photo of the delivered goods.");
    const payload: PodPayload = { recipient_name: recipient.trim() };
    if (signature) payload.signature_data = signature;
    if (photo) payload.photo_url = photo;
    if (notes.trim()) payload.notes = notes.trim();
    setBusy(true);
    await perform({ action_type: "pod", trip_id: trip.id, stop_id: stop.id, payload, label: `Proof of delivery · ${stop.name}` });
    router.push(completeHref);
  }

  return (
    <DriverShell
      title="Proof of delivery"
      subtitle={`Stop ${stop.sequence} · ${stop.name}`}
      backHref={`/driver/trip/outcome?trip=${trip.id}&stop=${stop.id}`}
      footer={
        <>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button size="lg" className="h-13 text-base font-bold" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save and close the stop"}
          </Button>
        </>
      }
    >
      <section className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold">{stop.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {stop.note ?? `${stop.orders.filter((order) => order.on_truck).length} orders handed over`}
          </span>
        </div>
        <StopStatusBadge status={stop.status} />
      </section>

      {!online && (
        <Notice tone="warning" icon={CloudOff} title="No signal: that's fine">
          The proof is kept on this phone and sent when the connection returns.
        </Notice>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pod-recipient">Received by</Label>
        <Input
          id="pod-recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          autoComplete="off"
          placeholder="Name of the person taking the goods"
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pod-signature">Their signature</Label>
        <SignaturePad id="pod-signature" onChange={setSignature} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Photo evidence</span>
        <PhotoCapture
          value={photo}
          onChange={setPhoto}
          label="Take a photo"
          hint={stop.outlet ? PHOTO_HINT[stop.outlet.dock_type] : "The delivered goods."}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pod-notes">Notes (optional)</Label>
        <Textarea id="pod-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="text-base" />
      </div>
    </DriverShell>
  );
}

function ProofContent() {
  const { trip, stop } = useTripStop();
  if (!trip.data || !stop) {
    return <StopUnavailable loading={trip.loading} error={trip.error} backHref={trip.data ? `/driver/trip?id=${trip.data.id}` : "/driver/trip"} />;
  }
  return <ProofForm key={stop.id} trip={trip.data} stop={stop} />;
}

export default function ProofPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ProofContent />
    </React.Suspense>
  );
}
