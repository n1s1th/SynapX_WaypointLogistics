"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Signal, BatteryFull, Wifi, CloudUpload,
  CircleCheck, Map, Home, TriangleAlert, Layers, RefreshCw
} from "lucide-react";
import { useSyncContext } from "@/components/SyncProvider";

export default function SyncingQueuePage() {
  const router = useRouter();
  const { queue, state, flush, pendingCount, failedCount } = useSyncContext();

  const total   = queue.length;
  const synced  = queue.filter((a) => a.status !== "pending" && a.status !== "syncing").length; // rough proxy
  const done    = total - pendingCount;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 100;

  // Auto-navigate away once everything is synced
  useEffect(() => {
    if (state === "idle" && pendingCount === 0 && failedCount === 0 && total === 0) {
      const t = setTimeout(() => router.push("/driver/queue"), 1500);
      return () => clearTimeout(t);
    }
  }, [state, pendingCount, failedCount, total, router]);

  // Kick off flush when this page mounts
  useEffect(() => { flush(); }, []); // eslint-disable-line

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div className="flex flex-col w-full bg-white z-10" style={{ borderBottom: "1px solid #D9E1E8" }}>
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <span className="text-[12px] font-semibold" style={{ color: "#12202E" }}>
            {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-normal" style={{ color: "#18794E" }}>Syncing</span>
            <Wifi size={16} color="#18794E" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>
        <div className="flex px-5 py-2.5 items-center w-full">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>Sync Queue</h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {state === "syncing" ? `Uploading ${done} / ${total}` : total === 0 ? "All records synced" : `${pendingCount} remaining`}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-[24px] pb-[100px] gap-[18px]">

        {/* Progress Card */}
        <div
          className="flex flex-col p-[18px] gap-[10px] w-full rounded-xl"
          style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
        >
          <div className="flex justify-between items-baseline w-full">
            <div className="flex flex-col gap-[3px]">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>
                {total === 0 ? "All done!" : `Uploading ${done} / ${total}`}
              </span>
              <span className="font-normal text-[12px]" style={{ color: "#5D6A78" }}>
                {state === "syncing" ? "Uploading records securely…" : "Connection restored"}
              </span>
            </div>
            <span className="font-bold text-[24px]" style={{ color: "#2167D5" }}>{pct}%</span>
          </div>

          <div className="w-full h-[9px] rounded-full" style={{ backgroundColor: "#D5E3F8" }}>
            <div
              className="h-[9px] rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: "#2167D5" }}
            />
          </div>

          <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#2167D5" }}>
            {state === "syncing"
              ? <span className="flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> Uploading securely…</span>
              : "Connection restored"}
          </span>
        </div>

        {/* Records */}
        {queue.length > 0 && (
          <div className="flex flex-col gap-[9px] w-full">
            {queue.map((record) => {
              const isSyncing = record.status === "syncing";
              const isFailed  = record.status === "failed";
              const color = isFailed ? "#D32F2F" : isSyncing ? "#2167D5" : "#18794E";
              const bg    = isFailed ? "#FFEBEB" : isSyncing ? "#EAF2FF" : "#E8F6EF";
              const label = isFailed ? "Failed" : isSyncing ? "Uploading" : "Queued";
              const Icon  = isSyncing ? CloudUpload : CircleCheck;

              return (
                <div
                  key={record.action_id}
                  className="flex flex-col p-[13px] gap-[10px] w-full bg-white rounded-xl"
                  style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
                >
                  <div className="flex items-center gap-[11px] w-full">
                    <div className="flex justify-center items-center w-[38px] h-[38px] rounded-lg shrink-0" style={{ backgroundColor: bg }}>
                      <Icon size={19} color={color} />
                    </div>
                    <div className="flex flex-col gap-0.5 w-full">
                      <span className="font-bold text-[10px]" style={{ color }}>{record.action_type.toUpperCase()}</span>
                      <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{record.label}</span>
                    </div>
                    <div className="flex items-center px-[9px] py-[5px] rounded-full shrink-0" style={{ backgroundColor: bg }}>
                      <span className="font-medium text-[10px]" style={{ color }}>{label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Banner */}
        <div className="flex p-3 gap-2.5 rounded-xl w-full" style={{ backgroundColor: "#E8F6EF", border: "1px solid rgba(24, 121, 78, 0.21)" }}>
          <CircleCheck size={18} color="#18794E" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
              {total === 0 ? "All records synced!" : "Almost done — you can keep driving."}
            </span>
            <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#18794E" }}>
              Sync continues safely in the background.
            </span>
          </div>
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
