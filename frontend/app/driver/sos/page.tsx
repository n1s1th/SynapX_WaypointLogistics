"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AlertTriangle, HeartPulse, ShieldAlert,
  Car, Flame, MoreHorizontal, MapPin, Route
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, apiFetchUpload, ApiError } from "@/lib/api";
import { cachedGet } from "@/lib/driverCache";
import { useSyncContext } from "@/components/SyncProvider";
import { getRememberedTrip } from "@/lib/driverStop";
import { gpsLabel } from "@/lib/gps";
import PhotoAttach, { type PhotoDraft } from "@/components/driver/PhotoAttach";

// sos_alerts.message is 500 characters: "<type>: <notes>"
const MAX_NOTES = 450;

type Fix = { latitude: number; longitude: number; accuracy: number };

export default function SOSPage() {
  const router = useRouter();
  
  const [selectedType, setSelectedType] = useState("Vehicle Breakdown");
  const [notes, setNotes] = useState("");
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(true);
  const [queued, setQueued] = useState(false);
  const { queue, enqueue, enqueueWithPhoto } = useSyncContext();

  // The real position to share with the dispatcher; the alert still goes without one
  useEffect(() => {
    if (!navigator.geolocation) {
      Promise.resolve().then(() => setLocating(false));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }, []);

  const emergencyTypes = [
    { label: "Accident", icon: AlertTriangle },
    { label: "Medical Emergency", icon: HeartPulse },
    { label: "Safety / Security", icon: ShieldAlert },
    { label: "Vehicle Breakdown", icon: Car },
    { label: "Dangerous Road", icon: Route }, 
    { label: "Vehicle Fire", icon: Flame },
    { label: "Other Emergency", icon: MoreHorizontal }
  ];

  useEffect(() => {
    async function loadActiveTrip() {
      try {
        const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
        const startedTrip = trips.find(t => t.status === "started");
        
        if (startedTrip) {
          const detail = await cachedGet<any>(`/driver/trips/${startedTrip.id}`);
          setActiveTrip(detail);
        }
      } catch (error) {
        // No signal: the trip the map last showed under way, so dispatch knows which run
        const tripId = getRememberedTrip();
        if (tripId) setActiveTrip({ id: tripId });
        else console.warn("Failed to load active trip:", error);
      } finally {
        setLoading(false);
      }
    }
    loadActiveTrip();
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    const alert = {
      driver_trip_id: activeTrip ? activeTrip.id : null,
      latitude: fix?.latitude ?? null,
      longitude: fix?.longitude ?? null,
      message: notes.trim() ? `${selectedType}: ${notes.trim()}` : selectedType,
    };

    // No signal: keep the SOS (and its photo) on the phone; it sends the moment signal returns
    async function saveForLater() {
      const action = {
        action_type: "sos" as const,
        trip_id: alert.driver_trip_id ?? undefined,
        payload: alert,
        label: `SOS · ${selectedType}`,
      };
      if (photo) await enqueueWithPhoto(action, photo.file);
      else await enqueue(action);
      setQueued(true);
      setSubmitting(false);
    }

    // A photo that fails to upload must not hold up the alert
    let photo_url: string | undefined;
    if (photo) {
      try {
        const form = new FormData();
        form.append("file", photo.file);
        ({ photo_url } = await apiFetchUpload<{ photo_url: string }>("/driver/upload/photo", form));
      } catch (error) {
        if (error instanceof ApiError && error.isNetworkError) return saveForLater();
        console.error("SOS photo upload failed, sending without it:", error);
      }
    }

    try {
      await apiFetch("/driver/sos", {
        method: "POST",
        // photo_url is saved once sos_alerts has a photo_url column; ignored until then
        body: JSON.stringify({ ...alert, photo_url }),
      });
      // The success screen shows what was actually sent
      const sent = new URLSearchParams({ type: selectedType, gps: fix ? "1" : "0" });
      if (activeTrip?.run_code) sent.set("run", activeTrip.run_code);
      if (activeTrip?.vehicle_number) sent.set("truck", activeTrip.vehicle_number);
      router.push(`/driver/sos/success?${sent}`);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) return saveForLater();
      toast.error(error instanceof Error ? error.message : "Couldn't send the SOS", {
        description: "Call for help if you can.",
      });
      setSubmitting(false);
    }
  }

  // The saved SOS leaves the queue once the server has it
  const sosWaiting = queue.some((a) => a.action_type === "sos");

  const currentStop = activeTrip?.stops?.find((s: { status: string }) => s.status === 'pending');

  return (
    <div className="h-[100dvh] flex flex-col font-sans overflow-hidden relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 h-[60px] bg-white shrink-0"
        style={{ borderBottom: "1px solid #E5E5E2" }}
      >
        <div className="flex items-center gap-2">
          <Link href="/driver" className="flex justify-center items-center w-5 h-5">
            <ArrowLeft size={20} color="#171A1F" />
          </Link>
          <span className="font-bold text-[18px]" style={{ color: "#171A1F" }}>Emergency</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle size={18} color="#171A1F" />
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex flex-col flex-1 p-4 gap-4 overflow-y-auto">
        
        {/* Emergency Alert Banner */}
        <div 
          className="flex p-3 gap-3 rounded-r-lg"
          style={{ backgroundColor: "#FBEFEF", borderLeft: "4px solid #AD3D3D" }}
        >
          <AlertTriangle size={20} color="#AD3D3D" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-bold text-[14px]" style={{ color: "#AD3D3D" }}>Emergency Assistance</span>
            <span className="font-normal text-[12px] leading-[16px]" style={{ color: "#6B7280" }}>
              For urgent situations only. Your current location will be shared with the dispatcher.
            </span>
          </div>
        </div>

        {/* Emergency Type Section */}
        <div className="flex flex-col gap-2">
          <span className="font-bold text-[14px]" style={{ color: "#171A1F" }}>What's happening?</span>
          
          <div className="grid grid-cols-2 gap-2">
            {emergencyTypes.map((type, idx) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.label;
              const isFullWidth = idx === emergencyTypes.length - 1 && emergencyTypes.length % 2 !== 0;

              return (
                <div 
                  key={type.label}
                  onClick={() => setSelectedType(type.label)}
                  className={`flex items-center p-[10px] gap-2 rounded-md cursor-pointer ${isFullWidth ? 'col-span-2' : ''}`}
                  style={{
                    backgroundColor: isSelected ? "#FBEFEF" : "#FFFFFF",
                    border: `1px solid ${isSelected ? "#AD3D3D" : "#E5E5E2"}`
                  }}
                >
                  <Icon size={16} color={isSelected ? "#AD3D3D" : "#171A1F"} className="shrink-0" />
                  <span 
                    className={`text-[12px] ${isSelected ? 'font-bold' : 'font-semibold'}`}
                    style={{ color: isSelected ? "#AD3D3D" : "#171A1F" }}
                  >
                    {type.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Two Column Details */}
        <div className="flex gap-3 w-full">
          {/* Delivery Info Card */}
          <div 
            className="flex-1 flex flex-col p-3 gap-2 bg-white rounded-lg"
            style={{ border: "1px solid #E5E5E2", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>Current Delivery</span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Order:</span>
                <span className="font-semibold text-[11px]" style={{ color: "#171A1F" }}>{loading ? "..." : (activeTrip ? `TRIP-${activeTrip.id}` : "None")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Trip:</span>
                <span className="font-semibold text-[11px]" style={{ color: "#171A1F" }}>{loading ? "..." : (activeTrip ? `TRIP-${activeTrip.id}` : "None")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Stop:</span>
                <span className="font-semibold text-[11px] truncate" style={{ color: "#171A1F" }}>{loading ? "..." : (currentStop ? currentStop.customer_name : "None")}</span>
              </div>
            </div>
          </div>

          {/* Location Card */}
          <div 
            className="flex-1 flex flex-col p-3 gap-2 bg-white rounded-lg"
            style={{ border: "1px solid #E5E5E2", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>Current Location</span>
              <div
                className="flex items-center px-1.5 py-0.5 rounded"
                style={{ backgroundColor: fix ? "#F0F7F2" : "#FBEFEF", width: "fit-content" }}
              >
                <span className="font-bold text-[9px]" style={{ color: fix ? "#3D7954" : "#AD3D3D" }}>
                  {locating ? "Locating…" : fix ? "Location Available" : "Location unavailable"}
                </span>
              </div>
            </div>
            <div className="flex justify-center items-center h-[42px] rounded" style={{ backgroundColor: "#DCE3EB" }}>
              <MapPin size={14} color="#171A1F" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px]" style={{ color: "#171A1F" }}>
                {fix ? `${fix.latitude.toFixed(4)}° N, ${fix.longitude.toFixed(4)}° E` : "--"}
              </span>
              <span className="font-normal text-[9px]" style={{ color: "#6B7280" }}>
                {fix ? gpsLabel(fix.accuracy) : "Alert will be sent without location"}
              </span>
              <span className="font-normal text-[9px]" style={{ color: "#6B7280" }}>Shared with dispatcher</span>
            </div>
          </div>
        </div>

        {/* Input Section */}
        <div className="flex flex-col gap-2">
          <span className="font-bold text-[13px]" style={{ color: "#171A1F" }}>Tell us what happened</span>
          <textarea
            value={notes}
            maxLength={MAX_NOTES}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-[120px] p-4 rounded bg-white outline-none resize-none font-normal text-[16px]"
            style={{ border: "1px solid #E5E5E2", color: "#4F4F4F" }}
            placeholder="Briefly describe the emergency..."
          />
        </div>

        {/* Photo Upload */}
        <div className="flex flex-col gap-1">
          <PhotoAttach
            photo={photo}
            onChange={setPhoto}
            title="Add Photo"
            hint="Optional proof of incident"
            onError={setPhotoError}
          />
          {photoError && <span className="text-[11px] font-medium" style={{ color: "#AD3D3D" }}>{photoError}</span>}
        </div>
      </div>

      {/* Sticky Footer */}
      <div 
        className="flex flex-col p-4 gap-3 bg-white shrink-0"
        style={{ borderTop: "1px solid #E5E5E2" }}
      >
        {queued && (
          <div role="alert" className="flex flex-col gap-2 p-3 rounded-md" style={{ backgroundColor: sosWaiting ? "#FFF4D6" : "#F0F7F2" }}>
            <span className="font-bold text-[13px]" style={{ color: sosWaiting ? "#7A4F00" : "#3D7954" }}>
              {sosWaiting ? "No signal: SOS saved on this phone" : "Signal back: SOS sent to dispatch"}
            </span>
            {sosWaiting && (
              <>
                <span className="text-[12px] leading-[16px]" style={{ color: "#7A4F00" }}>
                  It sends to dispatch automatically the moment signal returns. If you can, call for help now:
                </span>
                <div className="flex gap-2">
                  <a href="tel:1990" className="flex-1 flex items-center justify-center min-h-[44px] rounded-md font-bold text-[13px] text-white" style={{ backgroundColor: "#AD3D3D" }}>
                    Call 1990 · Ambulance
                  </a>
                  <a href="tel:119" className="flex-1 flex items-center justify-center min-h-[44px] rounded-md font-bold text-[13px] text-white" style={{ backgroundColor: "#AD3D3D" }}>
                    Call 119 · Police
                  </a>
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || loading || queued}
          className="w-full flex justify-center items-center py-3.5 rounded-md text-white font-bold text-[15px] disabled:opacity-50"
          style={{ backgroundColor: "#AD3D3D" }}
        >
          {submitting ? "SENDING..." : queued ? (sosWaiting ? "SAVED · SENDS WHEN SIGNAL RETURNS" : "SOS SENT") : "SEND EMERGENCY ALERT"}
        </button>
        <Link href="/driver" className="w-full">
          <button className="w-full flex justify-center items-center py-1">
            <span className="font-semibold text-[14px]" style={{ color: "#6B7280" }}>Cancel</span>
          </button>
        </Link>
      </div>
    </div>
  );
}
