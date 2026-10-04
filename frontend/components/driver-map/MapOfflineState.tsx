"use client";

import { WifiOff, RefreshCw } from "lucide-react";

interface MapOfflineStateProps {
  lastUpdated: Date | null;
  onRetry: () => void;
}

export default function MapOfflineState({ lastUpdated, onRetry }: MapOfflineStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 p-6 rounded-2xl mx-4"
      style={{
        backgroundColor: "#FFF4D6",
        border: "2px solid #F0B429",
      }}
    >
      <div
        className="flex items-center justify-center w-14 h-14 rounded-full"
        style={{ backgroundColor: "#FDECC8" }}
      >
        <WifiOff size={28} color="#A85D00" />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <h3 className="text-[16px] font-bold" style={{ color: "#0B2743" }}>
          Connection Lost
        </h3>
        <p className="text-[13px] text-[#5D6A78] leading-relaxed max-w-[260px]">
          Your route is still available. Continue following your assigned stops.
        </p>
        {lastUpdated && (
          <span className="text-[11px] text-[#8793A0] mt-1">
            Last updated: {lastUpdated.toLocaleTimeString("en-LK", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <button
        id="driver-map-retry-btn"
        onClick={onRetry}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[14px] transition-all active:scale-95"
        style={{ backgroundColor: "#0B2743", color: "white" }}
      >
        <RefreshCw size={16} />
        Retry Connection
      </button>
    </div>
  );
}
