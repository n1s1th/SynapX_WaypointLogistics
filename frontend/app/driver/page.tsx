"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  MapPin, Signal, BatteryFull, Map, Home, TriangleAlert, Layers, User,
  CalendarCheck, ChevronRight,
} from "lucide-react";
<<<<<<< Updated upstream
import { apiFetch, ApiError } from "@/lib/api";
import { cachedGet, keepPageOffline, writeCache } from "@/lib/driverCache";
import { colomboNow, greeting, READY_CUTOFF_HOUR } from "@/lib/colomboTime";
import DeviceClock, { useColomboClock } from "@/components/driver/DeviceClock";
import SyncStatus from "@/components/driver/SyncStatus";

// "I'm ready" for the next working day, saved on the server for the dispatcher.
interface ReadyState {
  for_date: string; // "2026-10-05"
  confirmed: boolean;
  open: boolean; // before the 4 PM cutoff
}

/** "2026-10-05" → "Mon 5 Oct" */
function dayLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`));
}
=======
import { cachedGet, keepPageOffline } from "@/lib/driverCache";
import { greeting } from "@/lib/colomboTime";
import { readyState, type ReadyState } from "@/lib/tomorrowReady";
import DeviceClock, { useColomboClock } from "@/components/driver/DeviceClock";
import SyncStatus from "@/components/driver/SyncStatus";

// How the "Tomorrow's availability" card on the home page reads
const READY_CARD: Record<ReadyState, { text: string; color: string; bg: string; border: string }> = {
  open: { text: "Confirm before 4 PM", color: "#18794E", bg: "#E8F6EF", border: "#18794E" },
  confirmed: { text: "✓ You're confirmed for tomorrow", color: "#2167D5", bg: "#EAF2FF", border: "#2167D5" },
  closed: { text: "Closed at 4 PM · call dispatch", color: "#5D6A78", bg: "#FFFFFF", border: "#D9E1E8" },
};
>>>>>>> Stashed changes

interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

interface DriverTripSummary {
  id: number;
  dispatch_trip_id: number;
  run_code?: string | null; // e.g. RUN-0067
  vehicle_number?: string | null; // e.g. VEH005
  status: string;
  assigned_date: string;
}

export default function DriverDashboard() {
  const clock = useColomboClock();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<DriverTripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState<ReadyState | null>(null);
<<<<<<< Updated upstream
  const [submittingReady, setSubmittingReady] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
=======
>>>>>>> Stashed changes

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [profileData, tripsData] = await Promise.all([
          cachedGet<UserProfile>("/driver/me"),
          cachedGet<DriverTripSummary[]>("/driver/trips/today"),
        ]);
        setProfile(profileData);
        setTrips(tripsData);
        // Each trip's page opens offline too
        tripsData.forEach((t) => keepPageOffline(`/driver/trip/${t.id}`));
      } catch (error) {
        console.error("Failed to load dashboard data:", error);
      } finally {
        setReady(readyState());
        setLoading(false);
      }
    }
    loadDashboardData();
    // Separate, so an old server without /driver/profile can't hide the trips.
    cachedGet<{ complete: boolean }>("/driver/profile")
      .then((driver) => setNeedsProfile(!driver.complete))
      .catch(() => undefined);
    cachedGet<ReadyState>("/driver/ready-tomorrow")
      .then(setReady)
      .catch(() => undefined);
  }, []);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
<<<<<<< Updated upstream
  // Dispatch plans tomorrow's trips at the 4 PM cutoff (Sri Lanka time), so
  // the driver confirms before then, once a day.
  const showTomorrowButton =
    !loading && ready !== null && ready.open && !ready.confirmed && colomboNow().hour < READY_CUTOFF_HOUR;

  async function handleReadyForTomorrow() {
    setSubmittingReady(true);
    setReadyError(null);
    try {
      const saved = await apiFetch<ReadyState>("/driver/ready-tomorrow", { method: "POST" });
      setReady(saved);
      writeCache("/driver/ready-tomorrow", saved);
    } catch (err) {
      setReadyError(
        err instanceof ApiError && !err.isNetworkError
          ? err.message
          : "Couldn't reach dispatch. Try again when you have signal."
      );
    } finally {
      setSubmittingReady(false);
    }
  }
=======
  const readyCard = ready ? READY_CARD[ready] : null;
>>>>>>> Stashed changes

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-xs font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <SyncStatus className="text-sm font-normal text-[#BDBDBD]" />
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center justify-between w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Today — {today}
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading ? "Loading..." : `${greeting(clock)}, ${profile?.full_name?.split(' ')[0] || 'Driver'} · DRV-${profile?.id?.toString().padStart(4, '0') || '0000'}`}
            </p>
          </div>
          <Link href="/driver/profile">
            <div className="flex justify-center items-center w-10 h-10 rounded-full shrink-0" style={{ backgroundColor: "#EAF2FF" }}>
              <User size={20} color="#2167D5" />
            </div>
          </Link>
        </div>
      </div>

      {/* Trips content */}
      <div className="flex flex-col flex-1 px-5 pt-5 pb-24 gap-4">
        
<<<<<<< Updated upstream
        {/* No phone or licence yet: dispatch can't give this driver a trip */}
        {needsProfile && (
          <Link href="/driver/profile" className="flex items-center justify-between gap-3 p-4 rounded-xl" style={{ backgroundColor: "#FFF4E5", border: "1px solid #B26A00" }}>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[14px]" style={{ color: "#8A5300" }}>Complete your profile</span>
              <span className="font-normal text-[12px]" style={{ color: "#8A5300" }}>Add your phone and licence so dispatch can give you trips.</span>
            </div>
            <span className="font-bold text-[13px] shrink-0" style={{ color: "#8A5300" }}>Add →</span>
          </Link>
        )}

        {/* Availability for Tomorrow Prompt */}
        {showTomorrowButton && ready && (
          <div className="flex justify-between items-center p-4 rounded-xl" style={{ backgroundColor: "#E8F6EF", border: "1px solid #18794E", boxShadow: "0px 5px 16px 0px rgba(24, 121, 78, 0.08)" }}>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[14px]" style={{ color: "#18794E" }}>Available {dayLabel(ready.for_date)}?</span>
              <span className="font-normal text-[11px]" style={{ color: "#18794E", maxWidth: "160px" }}>Let dispatch know you can take a run that day. Closes at 4 PM, when dispatch plans trips.</span>
=======
        {/* Tomorrow's availability: confirmed on its own page */}
        {readyCard && (
          <Link
            href="/driver/tomorrow"
            className="flex justify-between items-center p-4 gap-3 rounded-xl"
            style={{ backgroundColor: readyCard.bg, border: `1px solid ${readyCard.border}`, boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <div className="flex items-center gap-3">
              <CalendarCheck size={22} color={readyCard.color} />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Tomorrow&apos;s availability</span>
                <span className="font-semibold text-[12px]" style={{ color: readyCard.color }}>{readyCard.text}</span>
              </div>
>>>>>>> Stashed changes
            </div>
            <ChevronRight size={20} color="#5D6A78" />
          </Link>
        )}

<<<<<<< Updated upstream
        {readyError && (
          <p role="alert" className="text-[12px] font-medium px-1" style={{ color: "#C9363E" }}>{readyError}</p>
        )}

        {ready?.confirmed && (
          <div className="flex items-center p-3 gap-2 rounded-xl" style={{ backgroundColor: "#EAF2FF", border: "1px solid #2167D5" }}>
            <span className="font-bold text-[12px]" style={{ color: "#2167D5" }}>{`✓ You're down as available for ${dayLabel(ready.for_date)}`}</span>
          </div>
        )}
=======
>>>>>>> Stashed changes
        {loading ? (
          <div className="text-center py-10 text-[#5D6A78] text-sm font-medium">Loading your trips...</div>
        ) : trips.length === 0 ? (
          <div className="text-center py-10 text-[#5D6A78] text-sm font-medium">No trips assigned for today.</div>
        ) : (
          trips.map((trip, index) => {
            const isActive = trip.status === "started" || (index === 0 && trip.status === "assigned");
            
            if (isActive) {
              return (
                <div 
                  key={trip.id}
                  className="flex flex-col p-4 gap-2.5 rounded-xl"
                  style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
                >
                  {/* Trip Header */}
                  <div className="flex justify-between items-start w-full">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[24px]" style={{ color: "#0B2743" }}>{trip.run_code ?? `Trip R-${trip.id}`}</span>
                      <span className="font-semibold text-[12px]" style={{ color: "#5D6A78" }}>
                        {trip.vehicle_number ? `Truck ${trip.vehicle_number}` : `Dispatch #${trip.dispatch_trip_id}`}
                      </span>
                    </div>
                    <div className="flex items-center px-2 py-1 rounded-full bg-[#FFF4D6]">
                      <span className="font-bold text-[10px]" style={{ color: "#A85D00" }}>{trip.status.replace('_', ' ')}</span>
                    </div>
                  </div>

                  {/* Trip tags */}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center px-2.5 py-1.5 rounded-full bg-[#E8F6EF]">
                      <span className="font-bold text-[10px]" style={{ color: "#18794E" }}>Delivery</span>
                    </div>
                  </div>

                  {/* Region */}
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin size={17} color="#12202E" />
                    <span className="font-semibold text-[14px]" style={{ color: "#12202E" }}>Assigned Route</span>
                  </div>

                  {/* Action */}
                  <Link href={`/driver/trip/${trip.id}`} className="mt-2">
                    <button 
                      className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
                      style={{ backgroundColor: "#092C4C" }}
                    >
                      Open Trip {trip.run_code ?? `R-${trip.id}`}
                    </button>
                  </Link>
                </div>
              );
            } else {
              return (
                <div 
                  key={trip.id}
                  className="flex flex-col p-4 gap-2.5 rounded-xl bg-white"
                  style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
                >
                  {/* Trip Header */}
                  <div className="flex justify-between items-start w-full mb-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>{trip.run_code ?? `Trip R-${trip.id}`}</span>
                      <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Status · {trip.status}</span>
                    </div>
                    <div className="flex items-center px-2 py-1 rounded-full bg-[#E9EEF3]">
                      <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>Scheduled</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline w-full mt-[-2px]">
                    <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>{trip.vehicle_number ? "Truck" : "Dispatch Ref"}</span>
                    <span className="font-bold text-[12px]" style={{ color: "#5D6A78" }}>{trip.vehicle_number ?? `#${trip.dispatch_trip_id}`}</span>
                  </div>
                  
                  {/* Action */}
                  <Link href={`/driver/trip/${trip.id}`} className="mt-2">
                    <button 
                      className="w-full flex justify-center items-center h-[40px] rounded-lg text-[#092C4C] font-bold text-[14px]"
                      style={{ backgroundColor: "#F2F5F8" }}
                    >
                      View Details
                    </button>
                  </Link>
                </div>
              );
            }
          })
        )}

        {/* Shift Summary */}
        <div className="flex w-full gap-2.5 mt-2">
          <div className="flex-1 flex flex-col p-3.5 rounded-xl gap-1" style={{ backgroundColor: "#0B2743" }}>
            <span className="font-bold text-[22px] text-white">{loading ? "-" : trips.length}</span>
            <span className="font-normal text-[12px]" style={{ color: "rgba(255, 255, 255, 0.72)" }}>Trips today</span>
          </div>
          <div className="flex-1 flex flex-col p-3.5 rounded-xl gap-1 bg-white" style={{ border: "1px solid #D9E1E8" }}>
            <span className="font-bold text-[22px]" style={{ color: "#12202E" }}>
              {loading ? "-" : trips.filter(t => t.status === "completed").length}
            </span>
            <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Completed</span>
          </div>
        </div>
      </div>

      {/* SOS Button */}
      <Link href="/driver/sos">
        <button 
          className="fixed bottom-[96px] right-5 flex justify-center items-center w-[54px] h-[54px] rounded-full text-white font-extrabold text-[12px]"
          style={{ backgroundColor: "#C9363E", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          SOS
        </button>
      </Link>

      {/* Bottom Nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white"
        style={{ borderTop: "1px solid #D9E1E8", boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >
        <Link href="/driver" className="flex flex-col items-center gap-1 w-[72px]">
          <Home size={22} color="#111111" />
          <span className="text-[10px] font-medium" style={{ color: "#111111" }}>Home</span>
        </Link>
        <Link href="/driver/trip" className="flex flex-col items-center gap-1 w-[72px]">
          <Map size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Map</span>
        </Link>
        <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
          <TriangleAlert size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium" style={{ color: "#5D6A78" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#5D6A78" />
          <span className="text-[10px] font-medium" style={{ color: "#5D6A78" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
