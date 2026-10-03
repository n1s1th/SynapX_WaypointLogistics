"use client";

/** The thin device-status row at the top of driver screens: clock + real connection state. */
import { useEffect, useState } from "react";
import { BatteryFull, Wifi, WifiOff } from "lucide-react";
import { useSyncContext } from "@/components/SyncProvider";

export default function StatusStrip() {
  const { online, pendingCount, state } = useSyncContext();
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const label = !online ? "Offline" : state === "syncing" || pendingCount > 0 ? "Syncing" : "Online";
  const color = online ? "#18794E" : "#A85D00";

  return (
    <div className="flex justify-between items-center px-5 h-[34px] w-full">
      <span className="text-[12px] font-semibold" style={{ color: "#12202E" }}>{clock}</span>
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-normal" style={{ color }}>{label}</span>
        {online ? <Wifi size={16} color={color} /> : <WifiOff size={16} color={color} />}
        <BatteryFull size={18} color="#BDBDBD" />
      </div>
    </div>
  );
}
