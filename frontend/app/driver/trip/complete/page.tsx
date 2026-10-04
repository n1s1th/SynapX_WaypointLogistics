"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Signal, BatteryFull, Check, CloudOff,
  Map as MapIcon, Home, TriangleAlert, Layers
} from "lucide-react";
import { cachedGet } from "@/lib/driverCache";
import { isStopOpen, mergeLocalProgress } from "@/lib/driverStop";
import DeviceClock from "@/components/driver/DeviceClock";

interface DeliveryStop {
  id: number;
  sequence: number;
  address: string;
  customer_name: string;
  status: string;
}

function StopCompleteContent() {
  const searchParams = useSearchParams();
  const stopId = searchParams.get("stop_id");

  const [stop, setStop] = useState<DeliveryStop | null>(null);
  const [tripDetail, setTripDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const trips = await cachedGet<{ id: number; status: string }[]>("/driver/trips/today");
        const startedTrip = trips.find(t => t.status === "started");
        
        if (startedTrip) {
          const detail = await cachedGet<any>(`/driver/trips/${startedTrip.id}`);
          setTripDetail({ ...detail, stops: mergeLocalProgress(detail.stops) });

          if (stopId) {
            const foundStop = detail.stops.find((s: any) => s.id.toString() === stopId);
            if (foundStop) setStop(foundStop);
          }
        }
      } catch (error) {
        console.error("Failed to load trip detail:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [stopId]);

  const totalCount = tripDetail?.stops?.length || 0;
  const pendingStops = tripDetail?.stops?.filter(isStopOpen) || [];
  const nextStop = pendingStops[0];

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
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>Online</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Delivery complete
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em] truncate max-w-full" style={{ color: "#5D6A78" }}>
              {loading ? "..." : stop?.customer_name || "Unknown Stop"}
            </p>
          </div>
        </div>
      </div>

      {/* Completion Content */}
      <div className="flex flex-col flex-1 px-5 pt-[26px] pb-5 gap-[18px]">
        
        {/* Success Summary */}
        <div className="flex flex-col items-center gap-3 w-full">
          <div className="flex justify-center items-center w-[72px] h-[72px] rounded-full" style={{ backgroundColor: "#18794E" }}>
            <Check size={36} color="#FFFFFF" strokeWidth={3} />
          </div>
          <div className="flex flex-col items-center gap-[5px] w-full text-center">
            <h2 className="font-bold text-[24px]" style={{ color: "#12202E" }}>
              {loading ? "Completing..." : `Stop ${stop?.sequence || '?'} of ${totalCount} complete`}
            </h2>
            <p className="font-normal text-[14px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {stop?.customer_name} · POD captured
            </p>
          </div>
        </div>

        {/* Offline Warning Card (Hidden by default, can be toggled by offline state) */}
        {/*
        <div 
          className="flex flex-col p-[13px] gap-[10px] rounded-xl w-full"
          style={{ backgroundColor: "#FFF4D6", border: "2px solid #A85D00" }}
        >
          <div className="flex items-center gap-2.5 w-full">
            <CloudOff size={20} color="#A85D00" className="shrink-0" />
            <div className="flex flex-col gap-0.5 flex-1">
              <span className="font-bold text-[12px]" style={{ color: "#A85D00" }}>Saved on this device</span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                It will sync automatically when connection returns.
              </span>
            </div>
            <div className="flex items-center px-2 py-1 rounded-full shrink-0" style={{ backgroundColor: "#FFF4D6" }}>
              <span className="font-bold text-[10px]" style={{ color: "#A85D00" }}>Pending sync</span>
            </div>
          </div>
        </div>
        */}

        {/* Next Stop Card */}
        {nextStop ? (
          <div 
            className="flex flex-col p-4 gap-2.5 rounded-xl w-full bg-white"
            style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>NEXT STOP · {nextStop.sequence} OF {totalCount}</span>
            <span className="font-bold text-[18px] truncate" style={{ color: "#12202E" }}>{nextStop.customer_name}</span>
            
            <div className="flex w-full gap-2.5 mt-1">
              <div className="flex-1 flex flex-col p-3 rounded-lg gap-[3px]" style={{ backgroundColor: "#F2F5F8" }}>
                <span className="font-bold text-[22px]" style={{ color: "#163A5F" }}>{pendingStops.length}</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Remaining</span>
              </div>
              <div className="flex-1 flex flex-col p-3 rounded-lg gap-[3px]" style={{ backgroundColor: "#F2F5F8" }}>
                <span className="font-bold text-[22px]" style={{ color: "#163A5F" }}>-- km</span>
                <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>Distance</span>
              </div>
            </div>
          </div>
        ) : (
          !loading && (
            <div 
              className="flex flex-col p-4 gap-2.5 rounded-xl w-full bg-white text-center"
              style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
            >
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>All stops complete!</span>
              <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>Return to the route to finish your trip.</span>
            </div>
          )
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col px-5 pb-[100px] gap-[9px] w-full">
        <Link href="/driver/trip" className="w-full">
          <button 
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
            style={{ backgroundColor: "#092C4C" }}
          >
            {nextStop ? `Continue to stop ${nextStop.sequence}` : 'Return to route'}
          </button>
        </Link>
        <Link href="/driver/trip" className="w-full">
          <button 
            className="w-full flex justify-center items-center h-[40px] rounded-md font-semibold text-[13px] bg-white"
            style={{ border: "1px solid #E5E5E2", color: "#171A1F" }}
          >
            View full trip list
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

export default function StopCompletePage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <StopCompleteContent />
    </React.Suspense>
  );
}
