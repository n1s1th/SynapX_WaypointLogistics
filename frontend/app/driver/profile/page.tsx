"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Signal, BatteryFull, User, Truck, Phone, Mail,
  LogOut, Map, Home, TriangleAlert, ChevronRight
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { prepareSignOut } from "@/lib/syncQueue";
import { useSyncContext } from "@/components/SyncProvider";

interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { outstandingCount, online, retryAll, state } = useSyncContext();
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await apiFetch<UserProfile>("/driver/me");
        setProfile(data);
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  async function handleLogout() {
    // Unsynced records would need this session to upload — warn first
    if (outstandingCount > 0 && !confirmLogout) {
      setConfirmLogout(true);
      return;
    }
    // Keeps unsynced records + evidence; clears cached customer data only when nothing is waiting
    await prepareSignOut();
    clearToken();
    router.push("/driver/login");
  }

  return (
    <div className="min-h-screen flex flex-col font-sans relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex flex-col w-full bg-white z-10"
        style={{ borderBottom: "1px solid #D9E1E8" }}
      >
        {/* Device status */}
        <div className="flex justify-between items-center px-5 h-[34px] w-full">
          <span className="text-[12px] font-semibold" style={{ color: "#12202E" }}>06:58</span>
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
              Driver Profile
            </h1>
            <p className="text-[12px] font-normal leading-[1.45em]" style={{ color: "#5D6A78" }}>
              View your account and vehicle details
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-[24px] pb-[100px] gap-4">
        
        {/* Driver Info Card */}
        <div 
          className="flex flex-col p-4 gap-4 w-full rounded-2xl bg-white"
          style={{ border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
        >
          <div className="flex items-center gap-4 w-full">
            <div 
              className="flex justify-center items-center w-[64px] h-[64px] rounded-full shrink-0"
              style={{ backgroundColor: "#EAF2FF" }}
            >
              <User size={32} color="#2167D5" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[18px]" style={{ color: "#12202E" }}>
                {loading ? "Loading..." : profile?.full_name || "Unknown Driver"}
              </span>
              <div className="flex items-center px-2.5 py-0.5 rounded-full w-fit" style={{ backgroundColor: "#F2F5F8" }}>
                <span className="font-semibold text-[11px]" style={{ color: "#5D6A78" }}>
                  ID: {loading ? "..." : `DRV-${profile?.id.toString().padStart(4, "0")}`}
                </span>
              </div>
            </div>
          </div>
          
          <div className="w-full h-[1px]" style={{ backgroundColor: "#F2F5F8" }}></div>
          
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Phone size={16} color="#8793A0" className="shrink-0" />
              <span className="font-medium text-[14px]" style={{ color: "#12202E" }}>Not available</span>
            </div>
            <div className="flex items-center gap-3">
              <Mail size={16} color="#8793A0" className="shrink-0" />
              <span className="font-medium text-[14px]" style={{ color: "#12202E" }}>
                {loading ? "Loading..." : profile?.email || "No email"}
              </span>
            </div>
          </div>
        </div>

        {/* Assigned Vehicle */}
        <div className="flex flex-col gap-2 w-full mt-2">
          <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>Current Assignment</span>
          <div 
            className="flex flex-col p-4 gap-3 w-full rounded-xl"
            style={{ backgroundColor: "#EAF2FF", border: "2px solid #2167D5" }}
          >
            <div className="flex items-center gap-3">
              <Truck size={20} color="#2167D5" className="shrink-0" />
              <span className="font-bold text-[14px]" style={{ color: "#2167D5" }}>ASSIGNED VEHICLE</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-[20px]" style={{ color: "#12202E" }}>Pending</span>
              <span className="font-normal text-[14px]" style={{ color: "#5D6A78" }}>Awaiting allocation</span>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex flex-col w-full mt-4 bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #D9E1E8" }}>
          <button className="flex items-center justify-between p-4 w-full active:bg-gray-50 transition-colors">
            <span className="font-medium text-[15px]" style={{ color: "#12202E" }}>Support & Help</span>
            <ChevronRight size={18} color="#8793A0" />
          </button>
          <div className="w-full h-[1px]" style={{ backgroundColor: "#F2F5F8" }}></div>
          <button className="flex items-center justify-between p-4 w-full active:bg-gray-50 transition-colors">
            <span className="font-medium text-[15px]" style={{ color: "#12202E" }}>Privacy Policy</span>
            <ChevronRight size={18} color="#8793A0" />
          </button>
        </div>

        {/* Logout Action */}
        <div className="w-full mt-6 flex flex-col gap-2.5">
          {confirmLogout && outstandingCount > 0 && (
            <div className="flex flex-col p-3 gap-2 rounded-xl" style={{ backgroundColor: "#FFF4D6", border: "1px solid rgba(168, 93, 0, 0.21)" }}>
              <span className="font-bold text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                {outstandingCount} record{outstandingCount === 1 ? " hasn't" : "s haven't"} synced yet
              </span>
              <span className="font-normal text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
                They stay safely on this phone and upload after you sign in again — but dispatch won&apos;t see them until then.
              </span>
              {online && (
                <button
                  onClick={() => { setConfirmLogout(false); retryAll(); }}
                  disabled={state === "syncing"}
                  className="w-full h-[40px] rounded-md font-semibold text-[13px] text-white disabled:opacity-50"
                  style={{ backgroundColor: "#092C4C" }}
                >
                  {state === "syncing" ? "Syncing…" : "Sync now first"}
                </button>
              )}
            </div>
          )}
          <button 
            onClick={handleLogout}
            className="w-full flex justify-center items-center gap-2 h-[55px] rounded-lg bg-white"
            style={{ border: "2px solid #C9363E" }}
          >
            <LogOut size={18} color="#C9363E" />
            <span className="font-bold text-[16px]" style={{ color: "#C9363E" }}>
              {confirmLogout && outstandingCount > 0 ? "Log out anyway" : "Log out"}
            </span>
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
        <Link href="/driver/profile" className="flex flex-col items-center gap-1 w-[72px]">
          <User size={22} color="#163A5F" />
          <span className="text-[10px] font-bold" style={{ color: "#163A5F" }}>Profile</span>
        </Link>
      </div>
    </div>
  );
}
