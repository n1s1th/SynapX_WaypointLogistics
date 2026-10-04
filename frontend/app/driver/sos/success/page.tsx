"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

const noSubscription = () => () => {};

export default function SOSSuccessPage() {
  // What the SOS screen sent (type, run, truck, GPS), passed in the address
  const search = useSyncExternalStore(noSubscription, () => window.location.search, () => "");
  const sent = new URLSearchParams(search);
  const located = sent.get("gps") === "1";

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex items-center px-4 h-[60px] bg-white shrink-0"
        style={{ borderBottom: "1px solid #E5E5E2" }}
      >
        <span className="font-bold text-[18px]" style={{ color: "#171A1F" }}>Emergency Alert</span>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-6 items-center gap-[28px]">
        
        {/* Centered Status */}
        <div className="flex flex-col items-center gap-4 w-full">
          <div className="flex justify-center items-center w-[72px] h-[72px] rounded-full shrink-0" style={{ backgroundColor: "#18794E" }}>
            <Check size={36} color="#FFFFFF" strokeWidth={3} />
          </div>
          <div className="flex flex-col items-center gap-2 w-full text-center">
            <h1 className="font-bold text-[22px]" style={{ color: "#171A1F" }}>Emergency Alert Sent</h1>
            <p className="font-normal text-[14px] leading-[20px]" style={{ color: "#6B7280" }}>
              {located
                ? "The dispatcher has been notified and your current location has been shared."
                : "The dispatcher has been notified. Your location could not be found, so tell them where you are if you can."}
            </p>
          </div>
        </div>

        {/* Summary Card */}
        <div 
          className="flex flex-col p-4 gap-3 w-full bg-white rounded-xl"
          style={{ border: "1px solid #E5E5E2", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          <span className="font-bold text-[13px] uppercase" style={{ color: "#171A1F" }}>Alert details</span>
          
          <div className="flex flex-col w-full gap-2.5">
            {/* Row: Emergency */}
            <div className="flex justify-between items-center w-full">
              <span className="font-normal text-[12px]" style={{ color: "#6B7280" }}>Emergency</span>
              <span className="font-bold text-[12px]" style={{ color: "#AD3D3D" }}>{sent.get("type") ?? "Emergency"}</span>
            </div>
            <div className="w-full h-[1px]" style={{ backgroundColor: "#E5E5E2" }} />
            
            {/* Row: Trip */}
            <div className="flex justify-between items-center w-full">
              <span className="font-normal text-[12px]" style={{ color: "#6B7280" }}>Trip</span>
              <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>{sent.get("run") ?? "No trip under way"}</span>
            </div>
            <div className="w-full h-[1px]" style={{ backgroundColor: "#E5E5E2" }} />
            
            {/* Row: Vehicle */}
            <div className="flex justify-between items-center w-full">
              <span className="font-normal text-[12px]" style={{ color: "#6B7280" }}>Vehicle</span>
              <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>{sent.get("truck") ?? "-"}</span>
            </div>
            <div className="w-full h-[1px]" style={{ backgroundColor: "#E5E5E2" }} />
            
            {/* Row: Location */}
            <div className="flex justify-between items-center w-full">
              <span className="font-normal text-[12px]" style={{ color: "#6B7280" }}>Location</span>
              <span className="font-bold text-[12px]" style={{ color: located ? "#3D7954" : "#B26A00" }}>{located ? "Shared ✓" : "Not available"}</span>
            </div>
            <div className="w-full h-[1px]" style={{ backgroundColor: "#E5E5E2" }} />
            
            {/* Row: Status */}
            <div className="flex justify-between items-center w-full">
              <span className="font-normal text-[12px]" style={{ color: "#6B7280" }}>Status</span>
              <span className="font-bold text-[12px]" style={{ color: "#3D7954" }}>Dispatcher Notified ✓</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col px-[20px] pb-6 gap-[9px] w-full mt-auto">
        <button 
          className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
          style={{ backgroundColor: "#092C4C" }}
        >
          Call for dispatcher
        </button>
        <Link href="/driver" className="w-full">
          <button 
            className="w-full flex justify-center items-center h-[40px] rounded-md font-semibold text-[13px] bg-white"
            style={{ border: "1px solid #E5E5E2", color: "#171A1F" }}
          >
            Return to home
          </button>
        </Link>
      </div>

    </div>
  );
}
