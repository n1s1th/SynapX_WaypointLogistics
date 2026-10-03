"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudOff, Cloud, Camera, X, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { loadStop, type StopDetail } from "@/lib/driverStop";
import { saveRecord, waitForRecord, LocalSaveError } from "@/lib/syncQueue";
import { isOpenStatus } from "@/lib/driverSync/engine";
import { useSyncContext } from "@/components/SyncProvider";
import SignaturePad from "@/components/driver/SignaturePad";
import StatusStrip from "@/components/driver/StatusStrip";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface PhotoDraft {
  file: File;
  preview: string;
}

function ProofOfDeliveryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stop_id");
  const outcome: "delivered" | "partial" = searchParams.get("outcome") === "partial" ? "partial" : "delivered";
  const { online } = useSyncContext();

  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipientName, setRecipientName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!stopId) return;
    loadStop(stopId)
      .then(({ data }) => {
        // Already recorded here or on the server — never capture a second proof
        if (!isOpenStatus(data.status)) {
          toast.info(`Stop ${data.sequence} is already recorded as ${data.status}.`);
          router.replace("/driver/trip");
          return;
        }
        setStop(data);
        setQuantities(Object.fromEntries((data.order?.items ?? []).map((i) => [i.sku, i.quantity])));
      })
      .catch(() => setStop(null))
      .finally(() => setLoading(false));
  }, [stopId, router]);

  // Release object URLs when photos are removed or the page unmounts
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  function handlePhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const tooBig = files.filter((f) => f.size > MAX_PHOTO_BYTES);
    if (tooBig.length) setError("Each photo must be under 10 MB.");
    const accepted = files
      .filter((f) => f.size <= MAX_PHOTO_BYTES)
      .slice(0, MAX_PHOTOS - photos.length)
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));
    if (accepted.length) {
      setPhotos((prev) => [...prev, ...accepted]);
      if (!tooBig.length) setError(null);
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  const items = stop?.order?.items ?? [];
  const setQty = (sku: string, value: number, max: number) =>
    setQuantities((q) => ({ ...q, [sku]: Math.max(0, Math.min(max, value)) }));
  const short = items.some((i) => (quantities[i.sku] ?? i.quantity) < i.quantity);
  const deliveredTotal = items.reduce((sum, i) => sum + (quantities[i.sku] ?? 0), 0);

  // Same rules the server enforces (POD requirements)
  const missing = [
    !recipientName.trim() && "recipient name",
    !signature && "signature",
    photos.length === 0 && "at least one photo",
  ].filter(Boolean) as string[];

  function validate(): string | null {
    if (missing.length) return `Add the ${missing.join(", ")} before submitting.`;
    if (outcome === "partial" && items.length) {
      if (!short) return "Every item is at its full quantity — go back and choose Full delivery, or reduce the short items.";
      if (deliveredTotal === 0) return "Nothing was delivered — go back and choose Could not deliver.";
    }
    return null;
  }

  async function handleSubmit() {
    if (!stop) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);

    let record;
    try {
      // 1. Durable on the phone first: outcome, quantities, signature and photos together
      record = await saveRecord(
        {
          action_type: "deliver",
          trip_id: stop.driver_trip_id,
          stop_id: stop.id,
          payload: {
            outcome,
            recipient_name: recipientName.trim(),
            signature_data: signature,
            delivered_items: items.length ? quantities : undefined,
            notes: notes.trim() || undefined,
          },
          label: `${outcome === "partial" ? "Partial delivery" : "Delivered"} · ${stop.customer_name}`,
        },
        photos.map((p) => p.file),
      );
    } catch (err) {
      setError(err instanceof LocalSaveError ? err.message : "Couldn't save on this phone. Nothing was saved — try again.");
      setSubmitting(false);
      return;
    }

    // 2. With signal, wait briefly for the server's answer; without, it syncs later
    const settled = online ? await waitForRecord(record.action_id, 12_000) : null;
    const label = outcome === "partial" ? "partially delivered" : "delivered";
    if (settled?.sync_status === "SYNCED") {
      const remaining = stop.total_stops - stop.sequence;
      toast.success(`Stop ${stop.sequence} ${label} · synced`, {
        description: remaining > 0 ? "Head to your next stop." : "All stops done. Return to depot.",
      });
    } else if (settled?.sync_status === "CONFLICT") {
      toast.error("The plan changed for this stop", { description: "Your record and photos are kept for dispatcher review." });
      router.push(`/driver/queue/conflict?id=${record.action_id}`);
      return;
    } else if (settled?.sync_status === "SYNC_FAILED" && !settled.retryable) {
      // Rejected by the server: stay here so the driver can fix and resubmit
      setError(settled.last_error ?? "The server did not accept this proof of delivery.");
      setSubmitting(false);
      return;
    } else {
      toast.success(`Stop ${stop.sequence} saved on this phone`, {
        description: "Not synced yet — it uploads automatically when signal returns.",
      });
    }
    router.push("/driver/trip");
  }

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-hidden" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <StatusStrip />

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Proof of Delivery
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em] truncate max-w-full" style={{ color: "#5D6A78" }}>
              {loading ? "..." : stop?.customer_name || "Unknown Stop"}
            </p>
          </div>
        </div>
      </div>

      {/* Toast Area — only when the proof will be stored on the device */}
      {!online && (
        <div className="w-full px-[15px] py-[10px] z-10" style={{ backgroundColor: "#F2F5F8" }}>
          <div
            className="flex flex-col p-4 w-full bg-white rounded-lg"
            style={{ border: "1px solid #E5E5E2" }}
          >
            <span className="font-semibold text-[13px]" style={{ color: "#18385F" }}>You&apos;re offline</span>
            <span className="font-normal text-[12px] mt-1" style={{ color: "#6B7280" }}>
              Your proof is saved on this phone first and syncs automatically when signal returns.
            </span>
          </div>
        </div>
      )}

      {/* Bottom Sheet */}
      <div
        className="flex flex-col flex-1 bg-white px-5 pb-5 pt-4 gap-[14px] z-20 relative overflow-y-auto"
        style={{ boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >

        {/* Order summary */}
        <div className="flex justify-between items-center w-full shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-bold text-[10px] uppercase" style={{ color: outcome === "partial" ? "#A85D00" : "#18794E" }}>
              {outcome === "partial" ? "Partial delivery" : "Full delivery"}
              {stop?.order && ` · ${stop.order.order_number}`}
            </span>
            <span className="font-bold text-[18px] truncate" style={{ color: "#12202E" }}>{stop?.customer_name || "Unknown"}</span>
            {stop && (
              <span className="text-[12px]" style={{ color: "#5D6A78" }}>
                Stop {stop.sequence} of {stop.total_stops}
                {stop.order?.units != null && ` · ${stop.order.units} units`}
              </span>
            )}
          </div>
          {online ? <Cloud size={22} color="#8793A0" /> : <CloudOff size={22} color="#8793A0" />}
        </div>

        {/* Units actually handed over (partial delivery) */}
        {outcome === "partial" && items.length > 0 && (
          <div className="flex flex-col gap-1.5 w-full shrink-0">
            <label className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Units delivered</label>
            <div className="flex flex-col rounded-xl overflow-hidden" style={{ border: "1px solid #D9E1E8" }}>
              {items.map((item, idx) => {
                const qty = quantities[item.sku] ?? item.quantity;
                return (
                  <div
                    key={item.sku}
                    className="flex items-center gap-3 px-3.5 py-2.5"
                    style={{ borderTop: idx ? "1px solid #F2F5F8" : "none", backgroundColor: qty < item.quantity ? "#FFF4D6" : "#FFFFFF" }}
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-semibold text-[13px] truncate" style={{ color: "#12202E" }}>{item.item_name}</span>
                      <span className="text-[11px]" style={{ color: qty < item.quantity ? "#A85D00" : "#8793A0" }}>
                        {qty < item.quantity ? `${item.quantity - qty} short · ` : ""}of {item.quantity} ordered
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`One less ${item.item_name}`}
                      onClick={() => setQty(item.sku, qty - 1, item.quantity)}
                      className="flex items-center justify-center w-9 h-9 rounded-lg"
                      style={{ backgroundColor: "#F2F5F8", border: "1px solid #D9E1E8" }}
                    >
                      <Minus size={16} color="#12202E" />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={item.quantity}
                      value={qty}
                      onChange={(e) => setQty(item.sku, Number(e.target.value) || 0, item.quantity)}
                      className="w-12 h-9 text-center rounded-lg text-[15px] font-bold outline-none"
                      style={{ border: "1px solid #D9E1E8", color: "#12202E" }}
                      aria-label={`${item.item_name} units delivered`}
                    />
                    <button
                      type="button"
                      aria-label={`One more ${item.item_name}`}
                      onClick={() => setQty(item.sku, qty + 1, item.quantity)}
                      className="flex items-center justify-center w-9 h-9 rounded-lg"
                      style={{ backgroundColor: "#F2F5F8", border: "1px solid #D9E1E8" }}
                    >
                      <Plus size={16} color="#12202E" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Form field (Recipient name) */}
        <div className="flex flex-col gap-1.5 w-full shrink-0">
          <label htmlFor="pod-recipient" className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Recipient name</label>
          <div className="flex items-center w-full px-[14px] h-[44px] rounded-md" style={{ border: "1px solid #E5E5E2" }}>
            <input
              id="pod-recipient"
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Who received the goods?"
              autoComplete="off"
              className="w-full text-[14px] outline-none"
              style={{ color: "#12202E", backgroundColor: "transparent" }}
            />
          </div>
        </div>

        {/* Signature field */}
        <div className="flex flex-col gap-1.5 w-full shrink-0">
          <label className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Recipient signature</label>
          <SignaturePad onChange={setSignature} />
        </div>

        {/* Photo evidence */}
        <div className="flex flex-col gap-1.5 w-full shrink-0">
          <div className="flex justify-between items-center">
            <label className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Photo evidence</label>
            <span className="text-[11px]" style={{ color: "#8793A0" }}>{photos.length}/{MAX_PHOTOS}</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={handlePhotos}
          />

          {photos.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col justify-center items-center w-full p-[14px] gap-2 rounded-xl"
              style={{ height: "126px", backgroundColor: "#F2F5F8", border: "1px dashed #2167D5" }}
            >
              <Camera size={25} color="#12202E" />
              <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Add photo evidence</span>
              <span className="font-normal text-[12px] text-center" style={{ color: "#5D6A78" }}>
                Capture the delivered goods at the unloading point.
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, i) => (
                <div key={photo.preview} className="relative aspect-square rounded-lg overflow-hidden" style={{ border: "1px solid #D9E1E8" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={`Delivery photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded-full"
                    style={{ backgroundColor: "rgba(11, 39, 67, 0.75)" }}
                  >
                    <X size={13} color="#FFFFFF" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1 aspect-square rounded-lg"
                  style={{ backgroundColor: "#F2F5F8", border: "1px dashed #2167D5" }}
                >
                  <Plus size={20} color="#2167D5" />
                  <span className="text-[11px] font-semibold" style={{ color: "#2167D5" }}>Add photo</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Note for dispatch */}
        {outcome === "partial" && (
          <div className="flex flex-col gap-1.5 w-full shrink-0">
            <label htmlFor="pod-notes" className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Note for dispatch (optional)</label>
            <textarea
              id="pod-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="e.g. 2 cartons damaged, returned to truck"
              className="w-full p-3 rounded-md text-[13px] outline-none resize-none"
              style={{ border: "1px solid #E5E5E2", color: "#12202E" }}
            />
          </div>
        )}

        {error && (
          <div className="w-full p-3 rounded-lg text-[12px] shrink-0" style={{ backgroundColor: "#FDECEC", color: "#C9363E" }}>
            {error}
          </div>
        )}

        {/* Primary Action Button */}
        <div className="mt-auto pt-2 shrink-0">
          <button
            onClick={handleSubmit}
            disabled={submitting || loading || !stop}
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
            style={{ backgroundColor: "#092C4C" }}
          >
            {submitting ? (online ? "Saving & syncing..." : "Saving on this phone...") : "Submit & complete stop"}
          </button>
        </div>
      </div>

    </div>
  );
}

export default function ProofOfDeliveryPage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <ProofOfDeliveryContent />
    </React.Suspense>
  );
}
