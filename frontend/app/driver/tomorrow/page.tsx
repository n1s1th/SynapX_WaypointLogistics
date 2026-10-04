"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Signal, BatteryFull, ChevronLeft, CalendarCheck, CalendarClock, CircleCheck,
  Map, Home, TriangleAlert, Layers,
} from "lucide-react";
import DeviceClock from "@/components/driver/DeviceClock";
import SyncStatus from "@/components/driver/SyncStatus";
import { confirmReadyForTomorrow, readyState, tomorrowLabel, type ReadyState } from "@/lib/tomorrowReady";

export default function TomorrowAvailabilityPage() {
  const [state, setState] = useState<ReadyState | null>(null);
  const [day, setDay] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Read once the page is on the phone: the server pre-render knows neither
    // the phone's saved confirmation nor the time it's opened
    /* eslint-disable react-hooks/set-state-in-effect */
    setState(readyState());
    setDay(tomorrowLabel());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function handleConfirm() {
    setSubmitting(true);
    await confirmReadyForTomorrow();
    setState("confirmed");
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div className="flex flex-col w-full bg-white z-10" style={{ borderBottom: "1px solid #D9E1E8" }}>
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <DeviceClock className="text-[12px] font-semibold" style={{ color: "#12202E" }} />
          <div className="flex items-center gap-2">
            <SyncStatus className="text-[14px] font-normal text-[#BDBDBD]" />
            <Signal size={16} color="#BDBDBD" />
            <BatteryFull size={18} color="#BDBDBD" />
          </div>
        </div>

        {/* Title bar */}
        <div className="flex px-5 py-2.5 items-center gap-3 w-full">
          <Link href="/driver" aria-label="Back to home" className="flex justify-center items-center w-9 h-9 rounded-full shrink-0" style={{ backgroundColor: "#F2F5F8" }}>
            <ChevronLeft size={20} color="#12202E" />
          </Link>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[18px] font-bold leading-[1.25em]" style={{ color: "#12202E" }}>
              Tomorrow&apos;s availability
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              {day || "..."}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-6 pb-[100px] gap-4">
        {state === null ? (
          <div className="text-center py-10 text-[#5D6A78] text-sm font-medium">Loading...</div>
        ) : state === "confirmed" ? (
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-white text-center" style={{ border: "1px solid #18794E" }}>
            <CircleCheck size={44} color="#18794E" />
            <h2 className="font-bold text-[18px]" style={{ color: "#12202E" }}>You&apos;re confirmed for tomorrow</h2>
            <p className="text-[13px]" style={{ color: "#5D6A78" }}>
              Dispatch knows you can take a run on {day}. Your trips show on the home page once they&apos;re planned.
            </p>
            <Link href="/driver" className="w-full mt-2">
              <button className="w-full h-[52px] rounded-lg text-white font-bold text-[16px]" style={{ backgroundColor: "#092C4C" }}>
                Back to home
              </button>
            </Link>
          </div>
        ) : state === "open" ? (
          <div className="flex flex-col gap-4 p-5 rounded-2xl bg-white" style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}>
            <div className="flex items-center gap-3">
              <div className="flex justify-center items-center w-12 h-12 rounded-full shrink-0" style={{ backgroundColor: "#E8F6EF" }}>
                <CalendarCheck size={24} color="#18794E" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-[16px]" style={{ color: "#12202E" }}>Available tomorrow?</span>
                <span className="text-[12px]" style={{ color: "#5D6A78" }}>{day}</span>
              </div>
            </div>
            <p className="text-[13px]" style={{ color: "#5D6A78" }}>
              Let dispatch know you can take a run tomorrow. This closes at 4 PM, when dispatch plans tomorrow&apos;s trips.
            </p>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="w-full h-[55px] rounded-lg font-bold text-[16px] text-white disabled:opacity-50"
              style={{ backgroundColor: "#18794E" }}
            >
              {submitting ? "Sending..." : "I'm Ready"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-white text-center" style={{ border: "1px solid #D9E1E8" }}>
            <CalendarClock size={44} color="#A85D00" />
            <h2 className="font-bold text-[18px]" style={{ color: "#12202E" }}>Closed for today</h2>
            <p className="text-[13px]" style={{ color: "#5D6A78" }}>
              Confirming closes at 4 PM, when dispatch plans tomorrow&apos;s trips. To work on {day}, call dispatch.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-8 py-2.5 bg-white z-50"
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
