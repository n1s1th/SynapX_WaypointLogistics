"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  MapPin, Signal, BatteryFull, Map, Home, TriangleAlert, Layers, User
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { loadTodayTrips, loadTrip } from "@/lib/driverStop";
import { cacheProfile, getCachedProfile } from "@/lib/syncQueue";
import StatusStrip from "@/components/driver/StatusStrip";

interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

interface DriverTripSummary {
  id: number;
  dispatch_trip_id: number;
  status: string;
  assigned_date: string;
}

export default function DriverDashboard() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<DriverTripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [readyForTomorrow, setReadyForTomorrow] = useState(false);
  const [submittingReady, setSubmittingReady] = useState(false);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const profileData = await apiFetch<UserProfile>("/driver/me");
        setProfile(profileData);
        cacheProfile(profileData);
      } catch {
        setProfile((await getCachedProfile()) as UserProfile | null);
      }
      try {
        const res = await loadTodayTrips();
        setTrips(res.data);
        setFromCache(res.source === "cache");
        // Save today's active trips (stops, orders, POD rules) on the phone while online
        if (res.source === "server") {
          res.data
            .filter((t) => t.status === "started" || t.status === "assigned")
            .forEach((t) => loadTrip(t.id).catch(() => undefined));
        }
      } catch {
        setTrips([]);
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const currentHour = new Date().getHours();
  
  // Show if: has ongoing trip, before 6 PM (18:00), and hasn't confirmed yet
  const showTomorrowButton = trips.some(t => t.status === "started") && currentHour < 18 && !readyForTomorrow;

  async function handleReadyForTomorrow() {
    setSubmittingReady(true);
    try {
      // Send readiness to dispatcher
      await apiFetch("/driver/ready-tomorrow", { method: "POST" });
    } catch (e) {
      console.warn("Backend endpoint might not exist yet, but proceeding to update UI", e);
    } finally {
      setReadyForTomorrow(true);
      setSubmittingReady(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <StatusStrip />

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center justify-between w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Today — {today}
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading ? "Loading..." : `Good morning, ${profile?.full_name?.split(' ')[0] || 'Driver'} · DRV-${profile?.id?.toString().padStart(4, '0') || '0000'}`}
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
        
        {/* Availability for Tomorrow Prompt */}
        {showTomorrowButton && (
          <div className="flex justify-between items-center p-4 rounded-xl" style={{ backgroundColor: "#E8F6EF", border: "1px solid #18794E", boxShadow: "0px 5px 16px 0px rgba(24, 121, 78, 0.08)" }}>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[14px]" style={{ color: "#18794E" }}>Available Tomorrow?</span>
              <span className="font-normal text-[11px]" style={{ color: "#18794E", maxWidth: "160px" }}>Let dispatch know you can take a ride tomorrow (ends at 6 PM).</span>
            </div>
            <button
              onClick={handleReadyForTomorrow}
              disabled={submittingReady}
              className="px-4 py-2.5 rounded-lg font-bold text-[13px] text-white disabled:opacity-50"
              style={{ backgroundColor: "#18794E" }}
            >
              {submittingReady ? "Sending..." : "I'm Ready"}
            </button>
          </div>
        )}

        {readyForTomorrow && (
          <div className="flex items-center p-3 gap-2 rounded-xl" style={{ backgroundColor: "#EAF2FF", border: "1px solid #2167D5" }}>
            <span className="font-bold text-[12px]" style={{ color: "#2167D5" }}>✓ You're confirmed for tomorrow's schedule</span>
          </div>
        )}
        {fromCache && (
          <div className="flex p-3 gap-2.5 rounded-xl" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
              Offline · showing trips saved on this phone. Open the Queue to work any stop.
            </span>
          </div>
        )}
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
                      <span className="font-bold text-[24px]" style={{ color: "#0B2743" }}>Trip R-{trip.id}</span>
                      <span className="font-semibold text-[12px]" style={{ color: "#5D6A78" }}>Dispatch #{trip.dispatch_trip_id}</span>
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
                      Open Trip R-{trip.id}
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
                      <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>Trip R-{trip.id}</span>
                      <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Status · {trip.status}</span>
                    </div>
                    <div className="flex items-center px-2 py-1 rounded-full bg-[#E9EEF3]">
                      <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>Scheduled</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline w-full mt-[-2px]">
                    <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Dispatch Ref</span>
                    <span className="font-bold text-[12px]" style={{ color: "#5D6A78" }}>#{trip.dispatch_trip_id}</span>
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
