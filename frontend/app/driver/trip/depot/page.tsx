"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Warehouse, MapPin, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cachedGet } from "@/lib/driverCache";

export default function ArrivedAtDepotPage() {
  const router = useRouter();
  
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);

  useEffect(() => {
    async function loadActiveTrip() {
      try {
        const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
        // Could be completed but not yet checked-in at depot
        const trip = trips.find(t => t.status === "completed" || t.status === "started");
        setActiveTrip(trip);
      } catch (error) {
        console.error("Failed to load active trip:", error);
      } finally {
        setLoading(false);
      }
    }
    loadActiveTrip();
  }, []);

  async function handleConfirm() {
    if (!activeTrip) {
      // Just go home if no active trip
      router.push("/driver");
      return;
    }
    
    setCheckingIn(true);
    try {
      await apiFetch("/driver/depot/checkin", {
        method: "POST",
        body: JSON.stringify({
          trip_id: activeTrip.id,
          notes: "Checked in via driver app"
        })
      });
      router.push("/driver");
    } catch (error) {
      console.error("Failed to check in at depot:", error);
      setCheckingIn(false);
    }
  }

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col font-sans relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Underlying Map Screen */}
      <div className="absolute inset-0 flex flex-col z-0 pointer-events-none">
        
        {/* Header */}
        <div 
          className="flex justify-between items-center px-5 py-4 w-full bg-white"
          style={{ borderBottom: "1px solid #D9E1E8" }}
        >
          <div className="flex items-center gap-2">
            <ArrowLeft size={20} color="#163A5F" />
            <span className="font-bold text-[16px]" style={{ color: "#163A5F" }}>Active Trip</span>
          </div>
          <div className="flex items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F2F5F8" }}>
            <span className="font-semibold text-[12px]" style={{ color: "#5D6A78" }}>In Progress</span>
          </div>
        </div>

        {/* Simulated Map */}
        <div className="flex-1 w-full relative" style={{ backgroundColor: "#E1E6EB", maxHeight: "450px" }}>
          {/* Map graphics (simplified representation) */}
          <div className="absolute w-full h-1.5 bg-white top-[150px]"></div>
          <div className="absolute w-1.5 h-full bg-white left-[120px]"></div>
          <div className="absolute w-1.5 h-full bg-white left-[280px]"></div>
          <div className="absolute w-[160px] h-1.5 top-[150px] left-[120px]" style={{ backgroundColor: "#2167D5" }}></div>
          
          <div className="absolute w-[18px] h-[18px] rounded-full border-2 border-white left-[114px] top-[144px]" style={{ backgroundColor: "#2167D5" }}></div>
          <div className="absolute w-[24px] h-[24px] rounded-full border-[3px] border-white left-[271px] top-[141px]" style={{ backgroundColor: "#FF6B00" }}></div>
          
          {/* SOS FAB */}
          <div 
            className="absolute flex justify-center items-center w-[54px] h-[54px] rounded-full left-[320px] top-[410px]"
            style={{ backgroundColor: "#C9363E", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <span className="font-extrabold text-[14px] text-white">SOS</span>
          </div>
        </div>
      </div>

      {/* Dim Overlay */}
      <div className="absolute inset-0 z-10" style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}></div>

      {/* Popup Bottom Sheet */}
      <div 
        className="absolute bottom-0 left-0 right-0 flex flex-col px-6 pt-5 pb-8 gap-6 bg-white z-20"
        style={{ borderRadius: "24px 24px 0px 0px", boxShadow: "0px -8px 28px 0px rgba(11, 39, 67, 0.16)" }}
      >
        {/* Pull bar */}
        <div className="flex justify-center w-full">
          <div className="w-[40px] h-[4px] rounded-sm" style={{ backgroundColor: "#E5E5E2" }}></div>
        </div>

        {/* Header Info */}
        <div className="flex flex-col items-center gap-4 w-full">
          <div className="flex justify-center items-center w-[64px] h-[64px] rounded-[32px]" style={{ backgroundColor: "#FFF0E6" }}>
            <Warehouse size={32} color="#FF6B00" />
          </div>
          <div className="flex flex-col items-center gap-2 w-full text-center">
            <h2 className="font-bold text-[22px]" style={{ color: "#163A5F" }}>Arrived at depot?</h2>
            <p className="font-normal text-[14px] leading-[20px]" style={{ color: "#5D6A78" }}>
              You're about to notify the dispatcher that you have returned to the depot.
            </p>
          </div>
        </div>

        {/* Details Box */}
        <div className="flex flex-col p-4 gap-4 w-full rounded-2xl" style={{ backgroundColor: "#F2F5F8" }}>
          
          {/* Location */}
          <div className="flex items-center gap-3 w-full">
            <div className="flex justify-center items-center w-[36px] h-[36px] rounded-lg shrink-0 bg-white">
              <MapPin size={20} color="#8793A0" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-[12px]" style={{ color: "#8793A0" }}>Depot</span>
              <span className="font-bold text-[15px]" style={{ color: "#163A5F" }}>Colombo Main Depot</span>
            </div>
          </div>

          <div className="w-full h-[1px]" style={{ backgroundColor: "#D9E1E8" }}></div>

          {/* Time */}
          <div className="flex items-start gap-3 w-full">
            <div className="flex justify-center items-center w-[36px] h-[36px] rounded-lg shrink-0 bg-white">
              <Clock size={20} color="#8793A0" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-[12px]" style={{ color: "#8793A0" }}>Arrival time</span>
              <span className="font-bold text-[15px]" style={{ color: "#163A5F" }}>{now}</span>
              <div className="flex items-center gap-1 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#18794E" }}></div>
                <span className="font-medium text-[12px]" style={{ color: "#18794E" }}>Location detected</span>
              </div>
            </div>
          </div>

        </div>

        {/* Action Buttons */}
        <div className="flex flex-col items-center gap-4 w-full">
          <button 
            onClick={handleConfirm}
            disabled={checkingIn || loading}
            className="w-full flex justify-center items-center py-[14px] px-6 rounded-full text-white font-semibold text-[16px] disabled:opacity-50"
            style={{ backgroundColor: "#FF6B00" }}
          >
            {checkingIn ? "Checking in..." : "Confirm arrival"}
          </button>
          <Link href="/driver/trip/summary">
            <span className="font-semibold text-[15px] underline" style={{ color: "#5D6A78" }}>
              Cancel
            </span>
          </Link>
        </div>

      </div>

    </div>
  );
}
