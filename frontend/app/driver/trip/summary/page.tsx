"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Signal, BatteryFull, Check, CloudCheck, MapPin, CheckCircle2,
  Map as MapIcon, Home, TriangleAlert, Layers
} from "lucide-react";
import { cachedGet } from "@/lib/driverCache";
import { mergeLocalProgress } from "@/lib/driverStop";
import DeviceClock from "@/components/driver/DeviceClock";
import SyncStatus from "@/components/driver/SyncStatus";

type SummaryStop = { id: number; status: string; pod: unknown; completed_at: string | null };

export default function TripSummaryPage() {
  const [tripDetail, setTripDetail] = useState<any>(null);
  const [issueCount, setIssueCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
        // Prioritize started trip, otherwise take the most recently completed one
        const targetTrip = trips.find(t => t.status === "started") || trips.find(t => t.status === "completed");
        
        if (targetTrip) {
          const [detail, issues] = await Promise.all([
            cachedGet<{ stops: SummaryStop[] }>(`/driver/trips/${targetTrip.id}`),
            cachedGet<unknown[]>(`/driver/trips/${targetTrip.id}/issues`),
          ]);
          setTripDetail({ ...detail, stops: mergeLocalProgress(detail.stops) });
          setIssueCount(issues.length);
        }
      } catch (error) {
        console.error("Failed to load trip summary:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const stops: SummaryStop[] = tripDetail?.stops ?? [];
  const totalStops = stops.length;
  const processedStops = stops.filter((s) => ["delivered", "partial", "failed", "rescheduled"].includes(s.status)).length;
  const fullDeliveries = stops.filter((s) => s.status === "delivered").length;
  const partialDeliveries = stops.filter((s) => s.status === "partial").length;
  // A proof saved offline shows as the stop closed before the server has it
  const podComplete = stops.filter((s) => s.pod || (s.completed_at && (s.status === "delivered" || s.status === "partial"))).length;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="min-h-screen flex flex-col font-sans relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <SyncStatus className="text-[14px] font-normal" style={{ color: "#BDBDBD" }} />
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>
      </div>

      {/* Completion Content */}
      <div className="flex flex-col flex-1 px-5 pt-[36px] pb-[100px] gap-[20px]">
        
        {/* Celebration */}
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="flex justify-center items-center w-[84px] h-[84px] rounded-full" style={{ backgroundColor: "#163A5F" }}>
            <Check size={40} color="#FFFFFF" strokeWidth={3} />
          </div>
          <div className="flex items-center px-3 py-1.5 rounded-md gap-2.5" style={{ backgroundColor: "#27AE60" }}>
            <span className="font-medium text-[14px] leading-[22px] text-white">Success</span>
          </div>
          <div className="flex flex-col items-center gap-[5px] w-full mt-1 text-center">
            <h1 className="font-bold text-[32px]" style={{ color: "#12202E" }}>Trip complete</h1>
            <p className="font-normal text-[14px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {loading ? "..." : tripDetail ? `Trip R-${tripDetail.id} · ${today}` : "No trip data"}
            </p>
          </div>
        </div>

        {/* Completion totals */}
        <div className="flex w-full gap-[10px]">
          <div 
            className="flex-1 flex flex-col p-4 rounded-xl gap-[10px]"
            style={{ backgroundColor: "#E8F6EF", border: "2px solid #18794E" }}
          >
            <span className="font-bold text-[28px]" style={{ color: "#18794E" }}>
              {loading ? "-" : `${processedStops} / ${totalStops}`}
            </span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>Stops processed</span>
          </div>
          <div 
            className="flex-1 flex flex-col p-4 rounded-xl gap-[10px]"
            style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
          >
            <span className="font-bold text-[28px]" style={{ color: "#2167D5" }}>
              {loading ? "-" : `${podComplete} / ${totalStops}`}
            </span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>POD complete</span>
          </div>
        </div>

        {/* Summary stats card */}
        <div 
          className="flex flex-col p-3.5 gap-2.5 rounded-xl w-full bg-white"
          style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          <div className="flex justify-between items-center py-1.5">
            <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>Full deliveries</span>
            <span className="font-bold text-[18px]" style={{ color: "#18794E" }}>{loading ? "-" : fullDeliveries}</span>
          </div>
          <div className="flex justify-between items-center py-1.5">
            <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>Partial deliveries</span>
            <span className="font-bold text-[18px]" style={{ color: "#A85D00" }}>{loading ? "-" : partialDeliveries}</span>
          </div>
          <div className="flex justify-between items-center py-1.5">
            <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>Issues reported</span>
            <span className="font-bold text-[18px]" style={{ color: "#5D6A78" }}>{loading ? "-" : issueCount}</span>
          </div>
        </div>

        {/* Banner */}
        <div 
          className="flex p-3 gap-2.5 rounded-xl w-full"
          style={{ backgroundColor: "#E8F6EF", border: "1px solid rgba(24, 121, 78, 0.21)" }}
        >
          <CloudCheck size={18} color="#18794E" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
              All records synced — up to date.
            </span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
              Your shift record is safely stored.
            </span>
          </div>
        </div>

        {/* Return to depot card */}
        <div 
          className="flex flex-col p-3 gap-2 rounded-xl w-full bg-white"
          style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          <div className="flex justify-between items-center w-full">
            <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Return to depot</span>
            <div className="flex items-center px-[9px] py-[5px] rounded-full" style={{ backgroundColor: "#EAF2FF" }}>
              <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>Next step</span>
            </div>
          </div>
          
          <div className="flex items-center gap-[10px] w-full mt-1">
            <div 
              className="flex justify-center items-center w-[36px] h-[36px] rounded-lg shrink-0"
              style={{ backgroundColor: "#EAF2FF" }}
            >
              <MapPin size={18} color="#2167D5" />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Paliyagoda Depot</span>
              <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>14 Logistics Ave · 2.4 km away</span>
            </div>
            <CheckCircle2 size={22} color="#D9E1E8" className="shrink-0" />
          </div>
        </div>

        {/* Primary Action */}
        <Link href="/driver/trip/depot" className="w-full mt-2">
          <button 
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
            style={{ backgroundColor: "#092C4C" }}
          >
            Continue
          </button>
        </Link>
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
          <TriangleAlert size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
