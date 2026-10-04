"use client";

import React, { useState, useEffect } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  Lock, 
  AlertTriangle, 
  MapPin, 
  ShieldCheck, 
  RefreshCw 
} from "lucide-react";
import { 
  getDispatcherDepot, 
  setDispatcherDepot, 
  DEPOT_CHANGE_EVENT, 
  type DispatcherDepot 
} from "@/lib/dispatcher-depot";
import { fetchWithFallback } from "@/lib/api";
import { UserNotificationBell } from "@/components/notifications/user-notification-bell";

interface DepotScopeData {
  depot: DispatcherDepot | null;
  can_switch: boolean;
  is_assigned: boolean;
  user_name?: string;
  user_email?: string;
  user_role?: string;
}

export function DispatcherNavbar() {
  const [currentDepot, setCurrentDepot] = useState<DispatcherDepot>(getDispatcherDepot());
  const [scopeData, setScopeData] = useState<DepotScopeData | null>(null);
  const [isLoadingScope, setIsLoadingScope] = useState(true);

  // Fetch verified depot scope from backend
  const checkScope = async () => {
    try {
      const res = await fetchWithFallback("/api/v1/auth/depot-scope", { cache: "no-store" });
      if (res.ok) {
        const data: DepotScopeData = await res.json();
        setScopeData(data);
        if (data.depot && (data.depot === "peliyagoda" || data.depot === "kandy")) {
          setCurrentDepot(data.depot);
          setDispatcherDepot(data.depot);
        }
      }
    } catch (e) {
      console.error("Failed to fetch depot scope", e);
    } finally {
      setIsLoadingScope(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void checkScope());

    const handleDepotChange = (e: Event) => {
      const customEvent = e as CustomEvent<DispatcherDepot>;
      if (customEvent.detail) {
        setCurrentDepot(customEvent.detail);
      }
    };

    window.addEventListener(DEPOT_CHANGE_EVENT, handleDepotChange);
    return () => {
      window.removeEventListener(DEPOT_CHANGE_EVENT, handleDepotChange);
    };
  }, []);

  const handleSelectDepot = (depot: DispatcherDepot) => {
    if (!scopeData?.can_switch) return;
    setCurrentDepot(depot);
    setDispatcherDepot(depot);
  };

  const getInitials = (name?: string) => {
    if (!name) return "DP";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        {/* Left: Sidebar trigger and Depot Hub Scope */}
        <div className="flex items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <div className="h-4 w-px bg-border hidden sm:block" />

          {/* Depot Scope Presentation */}
          {isLoadingScope ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
              <RefreshCw className="size-3.5 animate-spin text-primary" />
              <span>Checking depot assignment...</span>
            </div>
          ) : scopeData && !scopeData.is_assigned ? (
            <Badge 
              variant="outline" 
              className="bg-amber-50 text-amber-900 border-amber-300 text-xs py-1 px-2.5 flex items-center gap-1.5 shadow-2xs"
            >
              <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
              <span className="font-semibold">Unassigned Account</span>
            </Badge>
          ) : scopeData?.can_switch ? (
            /* Admin or dev: interactive depot switcher */
            <div className="flex items-center gap-1.5">
              <div className="inline-flex rounded-lg border border-border bg-slate-100 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => handleSelectDepot("peliyagoda")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                    currentDepot === "peliyagoda"
                      ? "bg-white text-blue-900 font-semibold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Building2 className="size-3.5 text-blue-600" />
                  <span>Peliyagoda Hub</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDepot("kandy")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                    currentDepot === "kandy"
                      ? "bg-white text-purple-900 font-semibold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MapPin className="size-3.5 text-purple-600" />
                  <span>Kandy Hub</span>
                </button>
              </div>
              <Badge variant="outline" className="hidden lg:flex text-[10px] py-0.5 px-1.5 text-slate-500 border-slate-200">
                Admin Scope
              </Badge>
            </div>
          ) : (
            /* Dispatcher: locked to admin-assigned depot */
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-xs py-1 px-3 font-semibold flex items-center gap-1.5 shadow-2xs ${
                  currentDepot === "kandy"
                    ? "bg-purple-50 text-purple-900 border-purple-300"
                    : "bg-blue-50 text-blue-900 border-blue-300"
                }`}
              >
                <Lock className="size-3 text-slate-500" />
                <span>
                  {currentDepot === "kandy" ? "📍 Kandy Regional Depot" : "📍 Peliyagoda Central Depot"}
                </span>
              </Badge>
              <span className="hidden md:inline text-[11px] text-muted-foreground font-medium">
                (Assigned Hub)
              </span>
            </div>
          )}
        </div>

        {/* Right: User Information & Notifications */}
        <div className="flex items-center gap-3">
          <UserNotificationBell />

          <div className="h-4 w-px bg-border" />

          {/* User Account Pill */}
          <div className="flex items-center gap-2.5 pl-1">
            <div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              {getInitials(scopeData?.user_name)}
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-semibold text-foreground leading-tight truncate max-w-[130px]">
                {scopeData?.user_name || "Dispatcher"}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 leading-tight">
                <ShieldCheck className="size-2.5 text-emerald-600" />
                <span>{scopeData?.user_role || "DISPATCHER"}</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Unassigned Warning Banner */}
      {scopeData && !scopeData.is_assigned && (
        <div className="bg-amber-500/10 border-b border-amber-500/25 px-6 py-2.5 flex items-center justify-between text-xs text-amber-950">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-4 text-amber-600 shrink-0" />
            <span>
              <strong>Depot Assignment Required:</strong> Your dispatcher account is not yet assigned to an operational depot.
              Orders, fleet, and manifests are currently hidden until an administrator assigns you to a hub.
            </span>
          </div>
          <a
            href="mailto:admin@waypoint.synapx.lk"
            className="text-[11px] font-semibold text-amber-800 underline hover:text-amber-950 shrink-0"
          >
            Contact Admin
          </a>
        </div>
      )}
    </>
  );
}
