"use client";

import React from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Truck,
  Store,
  Building2,
  Sliders,
  History,
  Settings,
  ArrowLeft,
  ChevronRight,
  Shield,
  Activity,
} from "lucide-react";

export type AdminTab =
  | "overview"
  | "users"
  | "roles"
  | "vehicles"
  | "outlets"
  | "depots"
  | "operational-config"
  | "audit"
  | "settings";

interface AdminSidebarProps {
  currentTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  systemStatus?: {
    database: string;
    backend: string;
  };
}

const navItems: Array<{
  id: AdminTab;
  label: string;
  subtitle: string;
  icon: React.ElementType;
}> = [
  { id: "overview", label: "Overview", subtitle: "KPIs & System Status", icon: LayoutDashboard },
  { id: "users", label: "Users", subtitle: "Accounts & Provisioning", icon: Users },
  { id: "roles", label: "Roles & Access", subtitle: "RBAC & Permissions", icon: ShieldCheck },
  { id: "vehicles", label: "Vehicles", subtitle: "Fleet Specs & Depots", icon: Truck },
  { id: "outlets", label: "Outlets", subtitle: "Delivery Windows & Docks", icon: Store },
  { id: "depots", label: "Depots", subtitle: "Peliyagoda & Kandy", icon: Building2 },
  { id: "operational-config", label: "Operational Config", subtitle: "Windows & Calendar Days", icon: Sliders },
  { id: "audit", label: "Audit / Activity", subtitle: "Administrative Logs", icon: History },
  { id: "settings", label: "System Settings", subtitle: "Keycloak & Routing", icon: Settings },
];

export function AdminSidebar({ currentTab, onTabChange, systemStatus }: AdminSidebarProps) {
  return (
    <aside className="w-64 bg-[#092C4C] text-white flex flex-col shrink-0 border-r border-[#18385F]/50 shadow-md">
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/10 bg-[#07223b]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#18385F] flex items-center justify-center text-white shadow-xs">
            <Shield className="h-5 w-5 text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white">Waypoint</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1 py-0.2 rounded bg-white/10 text-white/90">
                Admin
              </span>
            </div>
            <p className="text-[11px] text-white/60">Operations &amp; Security</p>
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        <div className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-white/50">
          Administration Console
        </div>
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all ${
                isActive
                  ? "bg-[#18385F] text-white font-semibold shadow-xs"
                  : "text-white/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`size-4 shrink-0 ${
                    isActive ? "text-[#E8EDF3]" : "text-white/60"
                  }`}
                />
                <div className="truncate">
                  <div className="text-xs tracking-tight truncate">{item.label}</div>
                  <div className="text-[10px] text-white/50 truncate font-normal">{item.subtitle}</div>
                </div>
              </div>
              {isActive && <ChevronRight className="size-3.5 text-accent shrink-0 ml-1" />}
            </button>
          );
        })}
      </div>

      {/* Footer & Back Link */}
      <div className="p-3 border-t border-white/10 bg-[#07223b] space-y-2">
        <div className="px-2 py-1.5 rounded bg-white/5 border border-white/10 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-white/70">
            <Activity className="size-3 text-emerald-400 animate-pulse" />
            <span>{systemStatus?.backend || "FastAPI Backend"}</span>
          </span>
          <span className="text-[10px] font-mono font-bold text-emerald-400">ONLINE</span>
        </div>

        <Link
          href="/"
          className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors border border-white/10"
        >
          <ArrowLeft className="size-3.5" />
          <span>Exit to Portal</span>
        </Link>
      </div>
    </aside>
  );
}
