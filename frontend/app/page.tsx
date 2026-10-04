"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Truck,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  Lock,
  Building2,
  Navigation,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Database,
  Server,
  Radio,
  ScanBarcode,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

interface HealthCheckData {
  keycloak: {
    status: "online" | "offline";
    latency: number;
    url: string;
    realm: string;
    error?: string;
  };
  backend: {
    status: "online" | "offline";
    latency: number;
    url: string;
    version?: string;
    error?: string;
  };
  database: {
    status: "online" | "offline" | "unknown";
    provider: string;
    details?: string;
  };
  bridge: {
    status: "connected" | "disconnected";
  };
  timestamp: string;
}

import { useAuth } from "@/lib/auth-context";
import { ROLE_CONFIGS, KeycloakAppRole } from "@/lib/keycloak";
import { UserCheck, LogOut, User } from "lucide-react";

export default function Home() {
  const { user, isAuthenticated, logout, loginWithKeycloak } = useAuth();
  const [healthData, setHealthData] = useState<HealthCheckData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<string>("");

  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://auth.tenderease.me";
  const keycloakRealm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "waypointlogistics";
  const keycloakClientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "waypoint-frontend";

  const keycloakLoginUrl = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/auth?client_id=${keycloakClientId}&response_type=code&scope=openid%20profile%20email&redirect_uri=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
  )}`;

  const fetchHealth = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/health-check", {
        cache: "no-store",
      });
      if (res.ok) {
        const data: HealthCheckData = await res.json();
        setHealthData(data);
      } else {
        // Fallback default structure
        setHealthData({
          keycloak: { status: "offline", latency: 0, url: keycloakUrl, realm: keycloakRealm, error: "Health check route error" },
          backend: { status: "offline", latency: 0, url: "http://localhost:5000/api/v1", error: "Offline" },
          database: { status: "offline", provider: "Neon Serverless PostgreSQL", details: "Unavailable" },
          bridge: { status: "disconnected" },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Health check request failed";
      setHealthData({
        keycloak: { status: "offline", latency: 0, url: keycloakUrl, realm: keycloakRealm, error: errMsg },
        backend: { status: "offline", latency: 0, url: "http://localhost:5000/api/v1", error: errMsg },
        database: { status: "offline", provider: "Neon Serverless PostgreSQL" },
        bridge: { status: "disconnected" },
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, [keycloakRealm, keycloakUrl]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHealth();
    }, 10);
    return () => clearTimeout(timer);
  }, [fetchHealth]);

  const isKeycloakUp = healthData?.keycloak.status === "online";
  const isBackendUp = healthData?.backend.status === "online";
  const isDatabaseUp = healthData?.database.status === "online";
  const isBridgeUp = healthData?.bridge.status === "connected";

  const totalServices = 4;
  const onlineCount = (isKeycloakUp ? 1 : 0) + (isBackendUp ? 1 : 0) + (isDatabaseUp ? 1 : 0) + (isBridgeUp ? 1 : 0);

  const roles = [
    {
      id: "dispatcher",
      title: "Dispatcher",
      subtitle: "Central Fleet & Trip Operations",
      badgeText: "Desktop Console",
      badgeStyle: "bg-blue-100 text-blue-800 border-blue-300 font-semibold",
      description:
        "Coordinate multi-stop vehicle dispatches, assign manifests to drivers, evaluate route sequences, and track real-time delivery performance.",
      href: "/dispatcher",
      icon: <Truck className="size-5 text-[#092C4C]" />,
      features: [
        "Live Manifest Schedule & Trip Timeline",
        "Vehicle & Driver Staging Allocations",
        "Dynamic Multi-Stop Delivery Sequencing",
      ],
    },
    {
      id: "loader",
      title: "Loader",
      subtitle: "Loading Bay & Barcode Staging",
      badgeText: "Dock Scanner",
      badgeStyle: "bg-teal-100 text-teal-900 border-teal-300 font-semibold",
      description:
        "Manage loading bay pallet queues, verify carton barcodes in reverse drop order, verify cold-chain temperatures, and report inventory shortfalls.",
      href: "/loader",
      icon: <ScanBarcode className="size-5 text-[#0f766e]" />,
      features: [
        "Bay Staging Queue & Barcode Verification",
        "Strict Reverse Drop Sequence Loading",
        "Instant Shortfall & Damage Discrepancy Reporting",
      ],
    },
    {
      id: "driver",
      title: "Driver",
      subtitle: "Turn-by-Turn Mobile Trips",
      badgeText: "Mobile Safe",
      badgeStyle: "bg-indigo-100 text-indigo-900 border-indigo-300 font-semibold",
      description:
        "Phone-optimized trip interface with next-stop address, arrival countdown, one-tap GPS navigation, and digital proof of delivery with offline caching.",
      href: "/driver",
      icon: <Navigation className="size-5 text-[#092C4C]" />,
      features: [
        "Next Drop Address & Arrival ETA Countdown",
        "One-Tap Turn-by-Turn GPS Navigation",
        "Digital Signature & Photo POD with Offline Sync",
      ],
    },
    {
      id: "store",
      title: "Store Manager",
      subtitle: "Inbound Deliveries & Orders",
      badgeText: "Store Portal",
      badgeStyle: "bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold",
      description:
        "Inspect estimated delivery arrival windows, review incoming carton counts, place store replenishment orders, and confirm physical delivery receipt.",
      href: "/store",
      icon: <Building2 className="size-5 text-[#0f766e]" />,
      features: [
        "Real-Time Inbound Delivery Arrival Windows",
        "One-Click Replenishment Order Requests",
        "Carton Count Tally & Delivery Sign-Off",
      ],
    },
    {
      id: "admin",
      title: "Admin",
      subtitle: "Keycloak IAM & Security",
      badgeText: "System Admin",
      badgeStyle: "bg-purple-100 text-purple-900 border-purple-300 font-semibold",
      description:
        "Configure Keycloak OIDC federation, manage role-based access permissions (RBAC), inspect security audit logs, and monitor database migrations.",
      href: "/admin",
      icon: <ShieldCheck className="size-5 text-[#092C4C]" />,
      features: [
        "Keycloak OIDC Realm & Client Federation",
        "Role-Based Access Control (RBAC) Assignment",
        "System Health & Security Audit Logging",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 font-sans flex flex-col antialiased">
      {/* Top Application Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Logo & Product Identity */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#092C4C] flex items-center justify-center text-white shadow-sm">
              <Truck className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  Waypoint Logistics
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
                  SynapX
                </span>
              </div>
              <p className="text-xs text-slate-600 hidden sm:block font-medium">
                Operations Portal &amp; Role Launchpad
              </p>
            </div>
          </div>

          {/* Right Action: Keycloak SSO & User Session */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-xs border border-slate-200">
              <span className={`h-2.5 w-2.5 rounded-full ${isKeycloakUp ? "bg-emerald-600 animate-pulse" : "bg-red-500"}`} />
              <span className="text-slate-600 font-medium">Realm:</span>
              <span className="font-mono text-xs font-bold text-slate-900">{keycloakRealm}</span>
            </div>

            {isAuthenticated && user ? (
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <div className="w-6 h-6 rounded-full bg-[#092C4C] text-white flex items-center justify-center font-bold text-[10px]">
                    {user.name ? user.name.slice(0, 2).toUpperCase() : "U"}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-slate-900 leading-tight truncate max-w-[120px]">
                      {user.name || user.username}
                    </span>
                    <span className="text-[10px] font-mono text-teal-700 font-semibold uppercase">
                      {user.primaryRole || user.roles[0] || "operator"}
                    </span>
                  </div>
                </div>

                <Button
                  onClick={() => logout(true)}
                  variant="outline"
                  size="sm"
                  className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs h-8 px-2.5 gap-1.5"
                  title="Sign out of Keycloak"
                >
                  <LogOut className="size-3.5" />
                  <span className="hidden md:inline">Sign Out</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => loginWithKeycloak()}
                  size="sm"
                  className="bg-[#092C4C] text-white hover:bg-[#061e34] shadow-xs font-medium h-9 flex items-center gap-1.5"
                >
                  <Lock className="size-3.5" />
                  <span>Sign In</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Operations Gateway Intro */}
        <div className="border-b border-slate-200 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">
                Enterprise Logistics Network
              </span>
              <span className="text-xs font-medium text-slate-500">&bull; Single Sign-On Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Waypoint Operations Portal
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl font-normal leading-relaxed">
              Operational mission control for Dispatchers, Loaders, Drivers, Store Managers, and System Administrators.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHealth}
              disabled={isLoading}
              className="gap-2 text-xs font-semibold border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-xs"
            >
              <RefreshCw className={`size-3.5 text-slate-600 ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Pinging Services..." : "Recheck Connectivity"}</span>
            </Button>
            {lastChecked && (
              <span className="text-xs text-slate-600 font-mono hidden sm:inline bg-slate-100 px-2 py-1 rounded border border-slate-200">
                Checked: {lastChecked}
              </span>
            )}
          </div>
        </div>

        {/* Live Infrastructure & Active Connectivity Section */}
        <section className="space-y-4">
          {/* Diagnostic Status Alert Banner */}
          {onlineCount === totalServices ? (
            <div className="p-3.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold shadow-xs">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="size-5 text-emerald-700 shrink-0" />
                <span>All 4 Systems Operational &bull; Frontend, Backend, Database, and Keycloak Fully Connected</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 text-xs font-mono font-bold">
                4/4 ONLINE
              </span>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm shadow-xs">
              <div className="flex items-start sm:items-center gap-2.5">
                <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <div className="font-bold text-amber-900">
                    Service Disruption Notice: {totalServices - onlineCount} of {totalServices} Services Offline
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    FastAPI backend is offline on port 5000. Start it to restore database connectivity.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-md bg-amber-200/80 text-amber-900 text-xs font-mono font-bold">
                  {onlineCount}/{totalServices} ONLINE
                </span>
              </div>
            </div>
          )}

          {/* 4 Diagnostic Service Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Keycloak Status */}
            <Card className={`border shadow-xs transition-all ${isKeycloakUp ? "border-emerald-300 bg-white" : "border-red-300 bg-red-50/20"}`}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                    <Lock className="size-3.5 text-[#092C4C]" /> Keycloak OIDC
                  </span>
                  {isLoading ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                      Pinging...
                    </span>
                  ) : isKeycloakUp ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="size-3 text-emerald-700" /> ONLINE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-300">
                      <XCircle className="size-3 text-red-700" /> OFFLINE
                    </span>
                  )}
                </div>

                <div className="font-extrabold text-sm text-slate-900 truncate">
                  auth.tenderease.me
                </div>

                <div className="text-xs text-slate-600 flex flex-col gap-1 border-t border-slate-200 pt-2 font-mono">
                  <div className="flex justify-between">
                    <span>Realm:</span>
                    <span className="font-semibold text-slate-800">{keycloakRealm}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Latency:</span>
                    <span className="font-semibold text-emerald-700">
                      {healthData?.keycloak.latency ? `${healthData.keycloak.latency}ms` : "Live"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-sans mt-0.5">
                    {isKeycloakUp ? "SSO Authentication Ready" : healthData?.keycloak.error || "Cannot reach auth server"}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. FastAPI Backend Status */}
            <Card className={`border shadow-xs transition-all ${isBackendUp ? "border-emerald-300 bg-white" : "border-red-300 bg-red-50/20"}`}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                    <Server className="size-3.5 text-[#092C4C]" /> FastAPI Backend
                  </span>
                  {isLoading ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                      Pinging...
                    </span>
                  ) : isBackendUp ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="size-3 text-emerald-700" /> ONLINE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-300">
                      <XCircle className="size-3 text-red-700" /> OFFLINE
                    </span>
                  )}
                </div>

                <div className="font-extrabold text-sm text-slate-900 truncate">
                  Port 5000 (API v1)
                </div>

                <div className="text-xs text-slate-600 flex flex-col gap-1 border-t border-slate-200 pt-2 font-mono">
                  <div className="flex justify-between">
                    <span>Endpoint:</span>
                    <span className="font-semibold text-slate-800">/api/v1/health</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Response:</span>
                    <span className={`font-semibold ${isBackendUp ? "text-emerald-700" : "text-red-700"}`}>
                      {isBackendUp ? `${healthData?.backend.latency}ms` : "Down (No Response)"}
                    </span>
                  </div>
                  <div className="text-[11px] font-sans mt-0.5 font-medium">
                    {isBackendUp ? (
                      <span className="text-emerald-700">REST API &amp; Swagger Active</span>
                    ) : (
                      <span className="text-red-700">Action: Run python main.py in backend/</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3. Neon PostgreSQL Status */}
            <Card className={`border shadow-xs transition-all ${isDatabaseUp ? "border-emerald-300 bg-white" : isBackendUp ? "border-red-300 bg-red-50/20" : "border-amber-300 bg-amber-50/20"}`}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                    <Database className="size-3.5 text-teal-700" /> Neon PostgreSQL
                  </span>
                  {isLoading ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                      Checking...
                    </span>
                  ) : isDatabaseUp ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="size-3 text-emerald-700" /> CONNECTED
                    </span>
                  ) : isBackendUp ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-300">
                      <XCircle className="size-3 text-red-700" /> DB DOWN
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <AlertTriangle className="size-3 text-amber-700" /> STANDBY
                    </span>
                  )}
                </div>

                <div className="font-extrabold text-sm text-slate-900 truncate">
                  waypoint @ Neon Cloud
                </div>

                <div className="text-xs text-slate-600 flex flex-col gap-1 border-t border-slate-200 pt-2 font-mono">
                  <div className="flex justify-between">
                    <span>Pooler Port:</span>
                    <span className="font-semibold text-slate-800">5432 (SSL Active)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Driver:</span>
                    <span className="font-semibold text-slate-800">psycopg2-binary</span>
                  </div>
                  <div className="text-[11px] font-sans mt-0.5">
                    {isDatabaseUp ? (
                      <span className="text-emerald-700 font-medium">Session query (SELECT 1) succeeded</span>
                    ) : (
                      <span className="text-slate-600">Awaiting backend connection probe</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 4. Frontend & Backend Link */}
            <Card className={`border shadow-xs transition-all ${isBridgeUp ? "border-emerald-300 bg-white" : "border-amber-300 bg-amber-50/20"}`}>
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                    <Radio className="size-3.5 text-[#092C4C]" /> FE &harr; BE Bridge
                  </span>
                  {isLoading ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                      Checking...
                    </span>
                  ) : isBridgeUp ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="size-3 text-emerald-700" /> LINKED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <AlertTriangle className="size-3 text-amber-700" /> NOT LINKED
                    </span>
                  )}
                </div>

                <div className="font-extrabold text-sm text-slate-900 truncate">
                  {isBridgeUp ? ":3000 &harr; :5000 Active" : "Waiting for :5000"}
                </div>

                <div className="text-xs text-slate-600 flex flex-col gap-1 border-t border-slate-200 pt-2 font-mono">
                  <div className="flex justify-between">
                    <span>Next.js Client:</span>
                    <span className="font-semibold text-slate-800">Port 3000</span>
                  </div>
                  <div className="flex justify-between">
                    <span>FastAPI Target:</span>
                    <span className="font-semibold text-slate-800">Port 5000</span>
                  </div>
                  <div className="text-[11px] font-sans mt-0.5 font-medium">
                    {isBridgeUp ? (
                      <span className="text-emerald-700">CORS Handshake OK</span>
                    ) : (
                      <span className="text-amber-800">Browser cannot reach FastAPI</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Roles & Dashboards Launchpad */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Operational Role Dashboards
            </h2>
            <p className="text-base text-slate-900 font-extrabold mt-0.5">
              Select an operational role to enter its dedicated workspace:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {roles.map((r) => {
              const matchedRoleKey = r.id === "store" ? "store_manager" : (r.id as KeycloakAppRole);
              const isUserAssigned = user?.roles.includes(matchedRoleKey);

              return (
                <Card
                  key={r.id}
                  className={`border bg-white transition-all flex flex-col justify-between ${
                    isUserAssigned
                      ? "border-teal-500 ring-2 ring-teal-500/25 shadow-md"
                      : "border-slate-200 hover:border-[#092C4C] hover:shadow-md"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center border border-slate-200 shadow-xs">
                        {r.icon}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isUserAssigned && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-900 border border-teal-300">
                            Your Role
                          </span>
                        )}
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${r.badgeStyle}`}>
                          {r.badgeText}
                        </span>
                      </div>
                    </div>
                    <CardTitle className="text-lg font-extrabold text-slate-900 mt-3">
                      {r.title}
                    </CardTitle>
                    <div className="text-xs font-bold text-teal-800 -mt-0.5">
                      {r.subtitle}
                    </div>
                    <CardDescription className="text-xs text-slate-600 mt-2 leading-relaxed font-normal">
                      {r.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="py-2">
                    <div className="space-y-2 border-t border-slate-100 pt-3">
                      <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                        Core Operations
                      </div>
                      <ul className="text-xs space-y-1.5 text-slate-800">
                        {r.features.map((feat, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-slate-700">
                            <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            <span className="font-medium">{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-4 border-t border-slate-100">
                    <Button
                      asChild
                      className={`w-full text-xs font-bold gap-2 shadow-xs h-9 ${
                        isUserAssigned
                          ? "bg-teal-700 hover:bg-teal-800 text-white"
                          : "bg-[#092C4C] hover:bg-[#061e34] text-white"
                      }`}
                    >
                      <Link href={r.href}>
                        <span>{isUserAssigned ? `Open My ${r.title} Workspace` : `Enter ${r.title} Dashboard`}</span>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Quick Developer & Console Strip */}
        <section className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-100 border border-slate-200 text-[#092C4C]">
              <Terminal className="size-5 shrink-0" />
            </div>
            <div>
              <div className="font-bold text-slate-900">How to launch the FastAPI Backend:</div>
              <div className="text-slate-600 mt-0.5">
                Open a terminal in the <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-900 font-bold border border-slate-200">backend/</code> directory and run <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-900 font-bold border border-slate-200">python main.py</code>.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="http://localhost:5000/api/v1/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#092C4C] hover:underline font-bold"
            >
              <span>Swagger API Docs</span>
              <ExternalLink className="size-3" />
            </a>
            <span className="text-slate-300">&bull;</span>
            <a
              href={`${keycloakUrl}/admin/master/console/#/${keycloakRealm}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#092C4C] hover:underline font-bold"
            >
              <span>Keycloak Console</span>
              <ExternalLink className="size-3" />
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-xs text-slate-600 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium">
            <span className="font-bold text-slate-900">Waypoint Logistics</span>
            <span>&bull;</span>
            <span>SynapX Logistics Operations Suite</span>
            <span>&bull;</span>
            <span>&copy; {new Date().getFullYear()} Waypoint Group</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-emerald-700 flex items-center gap-1.5 font-bold">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Portal Operational
            </span>
            <span className="text-slate-300">&bull;</span>
            <span className="text-slate-600 font-mono">Keycloak Realm: {keycloakRealm}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
