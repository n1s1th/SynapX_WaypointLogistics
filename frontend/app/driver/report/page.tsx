"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Signal, BatteryFull, Store, DoorClosed, PackageX,
  Ellipsis, Check, Map as MapIcon, Home, TriangleAlert, Layers
} from "lucide-react";
import { apiFetch, apiFetchUpload } from "@/lib/api";
import { cachedGet } from "@/lib/driverCache";
import { useSyncContext } from "@/components/SyncProvider";
import PhotoAttach, { type PhotoDraft } from "@/components/driver/PhotoAttach";
import { getCachedStop } from "@/lib/driverStop";
import DeviceClock from "@/components/driver/DeviceClock";

export default function ReportProblemPage() {
  const router = useRouter();
  const { enqueue, enqueueWithPhoto, online } = useSyncContext();

  const [selectedIssue, setSelectedIssue] = useState("Outlet closed");
  const [notes, setNotes] = useState("");
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [currentStop, setCurrentStop] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const issues = [
    { label: "Outlet closed", icon: Store, backendType: "customer_unavailable" },
    { label: "Access denied", icon: DoorClosed, backendType: "customer_unavailable" },
    { label: "Order mismatch", icon: PackageX, backendType: "other" }, // not damage; the label goes in the description
    { label: "Other", icon: Ellipsis, backendType: "other" },
  ];

  useEffect(() => {
    async function loadActiveTrip() {
      try {
        const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
        const startedTrip = trips.find(t => t.status === "started");

        if (startedTrip) {
          const detail = await cachedGet<any>(`/driver/trips/${startedTrip.id}`);
          setActiveTrip(detail);

          // Coming from the outcome screen, the failed stop is passed explicitly
          const requestedStopId = new URLSearchParams(window.location.search).get("stop_id");
          const requestedStop = detail.stops?.find((s: any) => String(s.id) === requestedStopId);
          const activeStop = requestedStop ?? detail.stops
            ?.slice()
            .sort((a: any, b: any) => a.sequence - b.sequence)
            .find((s: any) => s.status === "pending" || s.status === "arrived");
          if (activeStop) {
            setCurrentStop(activeStop);
          }
        }
      } catch (error) {
        // No signal: a report for a stop can still be saved, from the phone's copy of that stop
        const requestedStopId = new URLSearchParams(window.location.search).get("stop_id");
        const cached = requestedStopId ? getCachedStop(requestedStopId) : null;
        if (cached) {
          setActiveTrip({ id: cached.driver_trip_id });
          setCurrentStop(cached);
        } else {
          console.error("Failed to load active trip:", error);
        }
      } finally {
        setLoading(false);
      }
    }
    loadActiveTrip();
  }, []);

  async function handleSubmit() {
    if (!activeTrip) return;
    setSubmitting(true);
    
    const issueConfig = issues.find(i => i.label === selectedIssue) || issues[3];
    const basePayload = {
      stop_id: currentStop ? currentStop.id : null,
      issue_type: issueConfig.backendType,
      description: notes.trim() ? `${selectedIssue}: ${notes.trim()}` : selectedIssue, // dispatch sees what the driver picked
    };
    const action = {
      action_type: "issue" as const,
      trip_id: activeTrip.id,
      stop_id: currentStop?.id,
      payload: basePayload,
      label: selectedIssue,
    };

    // Offline, or the network drops mid-send: keep the report (and its photo) for sync
    async function saveForLater() {
      if (photo) await enqueueWithPhoto(action, photo.file);
      else await enqueue(action);
      router.push("/driver/queue");
    }

    if (!online) {
      await saveForLater();
      return;
    }

    try {
      let photo_url: string | undefined;
      if (photo) {
        const form = new FormData();
        form.append("file", photo.file);
        ({ photo_url } = await apiFetchUpload<{ photo_url: string }>("/driver/upload/photo", form));
      }
      await apiFetch(`/driver/trips/${activeTrip.id}/issues`, {
        method: "POST",
        body: JSON.stringify({ ...basePayload, photo_url }),
      });
      router.push("/driver/trip");
    } catch (error) {
      console.error("Failed to submit issue, queued for sync:", error);
      await saveForLater();
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>Online</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Report a problem
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading ? "..." : activeTrip ? `${activeTrip.run_code ?? `Trip ${activeTrip.id}`} ${currentStop ? `· Stop ${currentStop.sequence}` : ''}` : "No Active Trip"}
            </p>
          </div>
        </div>
      </div>

      {/* Report Content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-[100px] gap-3">
        
        {/* Delivery issues */}
        <div className="flex flex-col gap-2 w-full">
          <h2 className="font-bold text-[18px]" style={{ color: "#12202E" }}>Delivery issue</h2>
          
          <div className="flex flex-col gap-2.5 w-full">
            {issues.map((issue) => {
              const Icon = issue.icon;
              const isSelected = selectedIssue === issue.label;

              return (
                <div 
                  key={issue.label}
                  onClick={() => setSelectedIssue(issue.label)}
                  className="flex items-center justify-between p-[11px] rounded-xl cursor-pointer"
                  style={{
                    backgroundColor: isSelected ? "#EAF2FF" : "#FFFFFF",
                    border: `1px solid ${isSelected ? "#2167D5" : "#D9E1E8"}`,
                    boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)"
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={19} color="#12202E" />
                    <span 
                      className={`text-[14px] ${isSelected ? 'font-bold' : 'font-medium'}`} 
                      style={{ color: "#12202E" }}
                    >
                      {issue.label}
                    </span>
                  </div>
                  
                  <div 
                    className="flex justify-center items-center w-[19px] h-[19px] rounded-full"
                    style={{ 
                      backgroundColor: isSelected ? "#2167D5" : "#FFFFFF",
                      border: `2px solid ${isSelected ? "#2167D5" : "#D9E1E8"}`
                    }}
                  >
                    {isSelected && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Optional note */}
        <div className="flex flex-col gap-1 w-full mt-1">
          <label className="font-semibold text-[12px]" style={{ color: "#12202E" }}>Optional note</label>
          <textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1900} // issue_reports.description is 2000, with the issue label in front
            className="w-full h-[120px] p-4 rounded bg-white outline-none resize-none font-normal text-[16px]"
            style={{ border: "1px solid #E0E0E0", color: "#4F4F4F" }}
            placeholder="Add details for dispatch…"
          />
        </div>

        {/* Optional photo */}
        <div className="flex flex-col gap-1 w-full mt-1">
          <PhotoAttach
            photo={photo}
            onChange={setPhoto}
            hint="Show the problem, e.g. a closed shutter or a damaged box."
            onError={setPhotoError}
          />
          {photoError && <p className="text-[12px] font-medium" style={{ color: "#AD3D3D" }}>{photoError}</p>}
        </div>

        {/* Primary action */}
        <div className="w-full mt-1">
          <button
            onClick={handleSubmit}
            disabled={submitting || !activeTrip}
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px] disabled:opacity-50"
            style={{ backgroundColor: "#092C4C" }}
          >
            {submitting ? (photo && online ? "Uploading photo…" : "Submitting...") : "Submit report"}
          </button>
        </div>
      </div>

      {/* Bottom Nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white z-50"
        style={{ borderTop: "1px solid #D9E1E8", boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >
        <Link href="/driver" className="flex flex-col items-center gap-1 w-[72px]">
          <Home size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Home</span>
        </Link>
        <Link href="/driver/trip" className="flex flex-col items-center gap-1 w-[72px]">
          <MapIcon size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Map</span>
        </Link>
        <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
          <TriangleAlert size={22} color="#163A5F" />
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium" style={{ color: "#5D6A78" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
