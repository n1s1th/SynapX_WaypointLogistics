"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Signal, BatteryFull, CloudOff, Cloud, Camera, X, Plus, ChevronLeft,
  Map as MapIcon, Home, TriangleAlert, Layers
} from "lucide-react";
import DeviceClock from "@/components/driver/DeviceClock";
import { toast } from "sonner";
import { apiFetch, apiFetchUpload, ApiError } from "@/lib/api";
import { fetchStopDetail, updateCachedStop, type StopDetail } from "@/lib/driverStop";
import { useSyncContext } from "@/components/SyncProvider";
import SignaturePad from "@/components/driver/SignaturePad";

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
  const { online, enqueueWithPhoto } = useSyncContext();

  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipientName, setRecipientName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!stopId) return;
    fetchStopDetail(stopId)
      .then((detail) => {
        if (detail.pod) {
          router.replace("/driver/trip");
          return;
        }
        setStop(detail);
      })
      .catch((err) => console.error("Failed to fetch stop data:", err))
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

  const missing = [
    !recipientName.trim() && "the recipient name",
    !signature && "a signature",
    photos.length === 0 && "at least one photo",
  ].filter(Boolean) as string[];

  async function saveOffline(payload: Record<string, unknown>) {
    await enqueueWithPhoto(
      { action_type: "pod", stop_id: Number(stopId), payload, label: `Proof of delivery · ${stop?.customer_name ?? "stop"}` },
      photos[0].file
    );
    // The stop is done on this phone: the map moves on to the next one
    updateCachedStop(stopId!, {
      completed_at: new Date().toISOString(),
      pod: { id: 0, recipient_name: String(payload.recipient_name ?? "") },
    });
    toast.success("Saved on this device", { description: "Proof will sync automatically when signal returns." });
    router.push("/driver/trip");
  }

  // Back to the outcome screen, where the driver can still change the outcome.
  // Not to the map: this stop is already marked delivered and the map would skip it.
  function handleBack() {
    const hasWork = recipientName.trim() || signature || photos.length > 0;
    if (hasWork && !window.confirm("Leave without saving? The name, signature and photos will be lost.")) return;
    router.push(`/driver/trip/outcome?stop_id=${stopId}`);
  }

  async function handleSubmit() {
    if (!stopId || !stop) return;
    if (missing.length) {
      setError(`Add ${missing.join(", ")} before submitting.`);
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      recipient_name: recipientName.trim(),
      signature_data: signature,
      notes: "",
    };

    if (!online) {
      await saveOffline(payload);
      return;
    }

    try {
      // Arrived straight here without choosing an outcome — record a full delivery
      if (stop.status === "pending" || stop.status === "arrived") {
        await apiFetch(`/driver/stops/${stopId}/outcome`, {
          method: "PATCH",
          body: JSON.stringify({ outcome: "delivered" }),
        });
      }

      const photoUrls: string[] = [];
      for (const photo of photos) {
        const form = new FormData();
        form.append("file", photo.file);
        const { photo_url } = await apiFetchUpload<{ photo_url: string }>("/driver/upload/photo", form);
        photoUrls.push(photo_url);
      }

      // The POD endpoint also marks the stop complete
      await apiFetch(`/driver/stops/${stopId}/pod`, {
        method: "POST",
        body: JSON.stringify({ ...payload, photo_url: JSON.stringify(photoUrls) }),
      });

      const remaining = stop.total_stops - stop.sequence;
      toast.success(`Stop ${stop.sequence} completed`, {
        description: remaining > 0 ? "Head to your next stop." : "All stops done. Return to depot.",
      });
      router.push("/driver/trip");
    } catch (err) {
      // Lost signal mid-submit — keep the proof on the device instead of losing it
      if (err instanceof ApiError && err.isNetworkError) {
        await saveOffline(payload);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't submit proof of delivery.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-hidden" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>{online ? "Online" : "Saving offline"}</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-2 py-1 items-center gap-1 w-full">
          <button
            type="button"
            onClick={handleBack}
            disabled={submitting}
            aria-label="Back to delivery outcome"
            className="flex items-center justify-center w-11 h-11 shrink-0 disabled:opacity-50"
          >
            <ChevronLeft size={22} color="#12202E" />
          </button>
          <div className="flex flex-col gap-0.5 min-w-0">
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
              Your proof will be saved on this device and synced when signal returns.
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
            <span className="font-bold text-[10px] uppercase" style={{ color: stop?.status === "partial" ? "#A85D00" : "#18794E" }}>
              {stop?.status === "partial" ? "Partial delivery" : "Full delivery"}
              {stop?.order && ` · ${stop.order.order_number}`}
            </span>
            <span className="font-bold text-[18px] truncate" style={{ color: "#12202E" }}>{stop?.customer_name || "Unknown"}</span>
            {stop && (
              <span className="text-[12px]" style={{ color: "#5D6A78" }}>
                Stop {stop.sequence} of {stop.total_stops}
                {stop.order?.units != null && ` · ${stop.order.units_loaded ?? stop.order.units} units`}
              </span>
            )}
          </div>
          {online ? <Cloud size={22} color="#8793A0" /> : <CloudOff size={22} color="#8793A0" />}
        </div>

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
            {submitting ? (online ? "Uploading proof..." : "Saving...") : "Submit & complete stop"}
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
