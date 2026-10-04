"use client";

import React from "react";
import Link from "next/link";
import {
  Signal, BatteryFull, TriangleAlert, Smartphone, Cloud,
  Map, Home, Layers
} from "lucide-react";
import DeviceClock from "@/components/driver/DeviceClock";

export default function SyncConflictPage() {
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
            <span className="text-[14px] font-normal" style={{ color: "#BDBDBD" }}>Conflict</span>
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Sync Queue
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              1 record needs attention
            </p>
          </div>
        </div>
      </div>

      {/* Conflict Content */}
      <div className="flex flex-col flex-1 px-5 pt-[18px] pb-[100px] gap-[15px]">
        
        {/* Banner */}
        <div 
          className="flex p-3 gap-2.5 rounded-xl w-full"
          style={{ backgroundColor: "#FDECEF", border: "1px solid rgba(201, 54, 62, 0.21)" }}
        >
          <TriangleAlert size={18} color="#C9363E" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>
              Sync conflict — Cityview Market
            </span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#C9363E" }}>
              The plan changed while you were offline
            </span>
          </div>
        </div>

        {/* Explanation */}
        <div className="flex flex-col gap-[5px] w-full">
          <h2 className="font-bold text-[24px] leading-[1.25em]" style={{ color: "#12202E" }}>
            Choose which record to keep
          </h2>
          <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
            Your offline delivery record and the dispatch plan disagree. Nothing will be removed without your choice.
          </p>
        </div>

        {/* Card: Offline Record */}
        <div 
          className="flex flex-col p-[15px] gap-[10px] w-full rounded-xl"
          style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
        >
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Smartphone size={18} color="#2167D5" />
              <span className="font-bold text-[10px]" style={{ color: "#2167D5" }}>OFFLINE RECORD</span>
            </div>
            <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>06:58</span>
          </div>
          <h3 className="font-bold text-[18px]" style={{ color: "#12202E" }}>Delivery completed at 06:58</h3>
          <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
            Full delivery with recipient signature and photo evidence.
          </p>
        </div>

        {/* Conflict divider */}
        <div className="flex items-center gap-[10px] w-full">
          <div className="flex-1 h-[1px]" style={{ backgroundColor: "#D9E1E8" }}></div>
          <div className="px-[10px] py-[5px] rounded-full" style={{ backgroundColor: "#F2F5F8", border: "1px solid #D9E1E8" }}>
            <span className="font-bold text-[10px]" style={{ color: "#5D6A78" }}>VERSUS</span>
          </div>
          <div className="flex-1 h-[1px]" style={{ backgroundColor: "#D9E1E8" }}></div>
        </div>

        {/* Card: Current Plan */}
        <div 
          className="flex flex-col p-[15px] gap-[10px] w-full rounded-xl"
          style={{ backgroundColor: "#FDECEF", border: "2px solid #C9363E" }}
        >
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Cloud size={18} color="#C9363E" />
              <span className="font-bold text-[10px]" style={{ color: "#C9363E" }}>CURRENT PLAN</span>
            </div>
            <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>06:50</span>
          </div>
          <h3 className="font-bold text-[18px]" style={{ color: "#12202E" }}>Stop removed before your record synced</h3>
          <p className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#5D6A78" }}>
            Deferred by Dispatcher at 06:50.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col w-full gap-[9px] mt-1">
          <button 
            className="w-full flex justify-center items-center h-[55px] rounded-lg text-white font-bold text-[16px]"
            style={{ backgroundColor: "#092C4C" }}
          >
            Keep my delivery record
          </button>
          <button 
            className="w-full flex justify-center items-center h-[40px] rounded-md font-semibold text-[13px] bg-white"
            style={{ border: "1px solid #E5E5E2", color: "#171A1F" }}
          >
            Flag for Dispatcher review
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
          <Map size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Map</span>
        </Link>
        <Link href="/driver/report" className="flex flex-col items-center gap-1 w-[72px]">
          <TriangleAlert size={22} color="#8793A0" />
          <span className="text-[10px] font-medium" style={{ color: "#8793A0" }}>Report</span>
        </Link>
        <Link href="/driver/queue" className="flex flex-col items-center gap-1 w-[72px]">
          <Layers size={22} color="#163A5F" />
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Queue</span>
        </Link>
      </div>
    </div>
  );
}
