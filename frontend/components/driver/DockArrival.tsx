"use client";

/**
 * While the truck is loaded: where to go, and "I've arrived at the dock", which
 * puts "Driver at Dock 3 · <name>" on the loader's tablet log and the
 * dispatcher's run log. Start stays locked until the loader marks it ready.
 */
import { useState } from "react";
import { Warehouse } from "lucide-react";
import { apiFetch } from "@/lib/api";

export interface DockTrip {
  id: number;
  dock_name?: string | null;
  at_dock_at?: string | null;
}

function colomboHHMM(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });
}

export default function DockArrival<T extends DockTrip>({ trip, onArrived }: { trip: T; onArrived: (trip: T) => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dock = trip.dock_name ?? "the dock";

  async function arrived() {
    setSending(true);
    setError(null);
    try {
      const updated = await apiFetch<DockTrip>(`/driver/trips/${trip.id}/at-dock`, { method: "POST" });
      onArrived({ ...trip, ...updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't tell the loader. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (trip.at_dock_at) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: "#FFF4D6" }}>
        <Warehouse size={16} color="#A85D00" className="shrink-0 mt-px" />
        <span className="text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
          <b>The loader knows you&apos;re at {dock}</b> (since {colomboHHMM(trip.at_dock_at)}). You can start once they mark the truck ready.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ backgroundColor: "#FFF4D6" }}>
      <span className="flex items-start gap-2 text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
        <Warehouse size={16} color="#A85D00" className="shrink-0 mt-px" />
        <span>
          <b>Go to {dock}.</b> The loader is loading your truck. Tap below when you&apos;re there.
        </span>
      </span>
      <button
        type="button"
        onClick={arrived}
        disabled={sending}
        className="w-full h-[44px] rounded-lg font-bold text-[14px] text-white disabled:opacity-60"
        style={{ backgroundColor: "#A85D00" }}
      >
        {sending ? "Telling the loader..." : `I've arrived at ${dock}`}
      </button>
      {error && <span role="alert" className="text-[12px]" style={{ color: "#AD3D3D" }}>{error}</span>}
    </div>
  );
}
