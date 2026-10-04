"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Truck,
  FileText,
  AlertTriangle,
  Clock,
  Warehouse,
  Layers,
  Activity,
  CheckCircle2,
  ArrowUpRight,
  MapPin,
  RefreshCw,
  Navigation,
  ShieldAlert,
  Sparkles,
  ChevronRight,
  Store,
  PieChart,
  CarFront,
  Zap,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { dispatcherDepotHeaders, getDispatcherDepot, setDispatcherDepot, type DispatcherDepot } from "@/lib/dispatcher-depot";
import { fetchWithFallback } from "@/lib/api";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────

interface OrderItem {
  id: number;
  product_id?: number;
  sku: string;
  name: string;
  quantity: number;
  quantity_sent?: number | null;
  dispatcher_note?: string | null;
}

interface OrderRecord {
  id: number;
  order_number: string;
  client_name: string;
  outlet_id?: number | null;
  status: string;
  priority: string;
  delivery_date: string;
  created_at: string;
  total_weight_kg?: number;
  items: OrderItem[];
}

interface DeliveryRunStop {
  id?: string;
  name?: string;
  eta?: string;
  sla_ok?: boolean;
}

interface LoadingEvent {
  event: string;
  time: string;
  note?: string;
  status: string;
}

interface DeliveryRunRecord {
  id: number;
  trip_code: string;
  vehicle_number: string;
  driver_name: string;
  depot_name: string;
  origin?: string;
  destination?: string;
  status: string;
  departure_time: string | null;
  total_weight_kg: number;
  total_volume_m3: number;
  stop_count: number;
  stops_completed: number;
  stop_sequence?: (DeliveryRunStop | string)[] | null;
  loading_events?: LoadingEvent[] | null;
}

interface VehicleRecord {
  id: number;
  code: string;
  vehicle_type: string;
  status: string;
  depot_name: string;
  temperature_mode: string;
  capacity_kg: number;
  capacity_vol_m3: number;
}

export default function DispatcherDashboard() {
  const [hubFilter, setHubFilter] = useState<DispatcherDepot>(() => getDispatcherDepot());
  const [canSwitchDepot, setCanSwitchDepot] = useState(false);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [runs, setRuns] = useState<DeliveryRunRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [outletCount, setOutletCount] = useState<number>(120);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  useEffect(() => {
    void fetchWithFallback("/api/v1/auth/depot-scope", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const scope = (await response.json()) as { depot?: DispatcherDepot; can_switch?: boolean };
        if (scope.depot === "peliyagoda" || scope.depot === "kandy") {
          setDispatcherDepot(scope.depot);
          setHubFilter(scope.depot);
        }
        setCanSwitchDepot(scope.can_switch === true);
      })
      .catch(() => {
        // The dashboard remains usable in local development before the API is running.
      });
  }, []);

  // The depot is sent to the backend on every request; filtering here only
  // refines the already-scoped response for display.
  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [ordersRes, runsRes, vehiclesRes, outletsRes] = await Promise.allSettled([
        fetchWithFallback("/api/v1/orders/", { cache: "no-store" }),
        fetchWithFallback("/api/v1/delivery-runs/", { cache: "no-store" }),
        fetchWithFallback("/api/v1/fleet/vehicles", { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/outlets?depot=${hubFilter}`, { cache: "no-store", headers: dispatcherDepotHeaders() }),
      ]);

      if (ordersRes.status === "fulfilled" && ordersRes.value.ok) {
        const data = await ordersRes.value.json();
        setOrders(Array.isArray(data) ? data : []);
      }
      if (runsRes.status === "fulfilled" && runsRes.value.ok) {
        const data = await runsRes.value.json();
        setRuns(Array.isArray(data) ? data : []);
      }
      if (vehiclesRes.status === "fulfilled" && vehiclesRes.value.ok) {
        const data = await vehiclesRes.value.json();
        setVehicles(Array.isArray(data) ? data : []);
      }
      if (outletsRes.status === "fulfilled" && outletsRes.value.ok) {
        const data = await outletsRes.value.json();
        if (Array.isArray(data)) setOutletCount(data.length);
      }
      setLastRefreshed(new Date());
    } catch (err) {
      console.error("Failed to load dispatcher telemetry:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [hubFilter]);

  useEffect(() => {
    // Defer the first pulse so the effect only subscribes to refresh work.
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    // Auto-refresh pulse every 45s
    const timer = setInterval(() => {
      void loadData();
    }, 45000);
    return () => {
      window.clearTimeout(initialLoad);
      clearInterval(timer);
    };
  }, [loadData]);

  // Filtered runs & vehicles by selected Hub
  const filteredRuns = useMemo(() => {
    return runs.filter(
      (r) => (r.depot_name || "").toLowerCase() === hubFilter
    );
  }, [runs, hubFilter]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(
      (v) => (v.depot_name || "").toLowerCase() === hubFilter
    );
  }, [vehicles, hubFilter]);

  // Operational Metrics
  const activeRuns = runs.filter((r) => {
    const s = (r.status || "").toLowerCase();
    return s === "en_route" || s === "in_progress" || s === "loading";
  });
  const pendingOrders = orders.filter((o) => {
    const s = (o.status || "").toUpperCase();
    return s === "SUBMITTED" || s === "CONFIRMED";
  });
  const highPriorityOrders = pendingOrders.filter((o) => {
    const p = (o.priority || "").toUpperCase();
    return p === "EMERGENCY" || p === "HIGH";
  });
  const deferredOrders = orders.filter((o) => (o.status || "").toUpperCase() === "DEFERRED");

  // Partial allocations count across all items
  const partialItemsCount = orders.reduce((acc, order) => {
    return (
      acc +
      (order.items || []).filter(
        (it) => it.quantity_sent !== undefined && it.quantity_sent !== null && it.quantity_sent < it.quantity
      ).length
    );
  }, 0);

  const availableVehiclesCount = filteredVehicles.filter(
    (v) => (v.status || "").toUpperCase() === "AVAILABLE"
  ).length;

  const fleetReadinessPct =
    filteredVehicles.length > 0
      ? Math.round((availableVehiclesCount / filteredVehicles.length) * 100)
      : 100;

  // Urgent Orders (Sorted by Priority & Delivery Date)
  const urgentOrders = useMemo(() => {
    const priorityWeight: Record<string, number> = {
      EMERGENCY: 4,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    };
    return [...orders]
      .filter((o) => {
        const s = (o.status || "").toUpperCase();
        return s === "SUBMITTED" || s === "CONFIRMED";
      })
      .sort((a, b) => {
        const pA = (a.priority || "NORMAL").toUpperCase();
        const pB = (b.priority || "NORMAL").toUpperCase();
        const pDiff = (priorityWeight[pB] || 0) - (priorityWeight[pA] || 0);
        if (pDiff !== 0) return pDiff;
        return (a.delivery_date || "").localeCompare(b.delivery_date || "");
      })
      .slice(0, 6);
  }, [orders]);

  // Format Helper for Priority
  const getPriorityBadge = (priority?: string | null) => {
    const p = (priority || "NORMAL").toUpperCase();
    switch (p) {
      case "EMERGENCY":
        return (
          <Badge className="bg-destructive text-destructive-foreground animate-pulse font-semibold text-[10px]">
            EMERGENCY
          </Badge>
        );
      case "HIGH":
        return (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold text-[10px]">
            HIGH PRIORITY
          </Badge>
        );
      case "NORMAL":
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            Normal
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-[10px]">
            {priority || "Normal"}
          </Badge>
        );
    }
  };

  // Run Status Badge
  const getRunStatusBadge = (status?: string | null) => {
    const s = (status || "").toLowerCase();
    switch (s) {
      case "en_route":
      case "in_progress":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
            En Route
          </Badge>
        );
      case "loading":
        return (
          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 text-[10px]">
            Dock Loading
          </Badge>
        );
      case "scheduled":
        return (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
            Scheduled
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            Completed
          </Badge>
        );
      case "recalled":
        return (
          <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 text-[10px]">
            Recalled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Top Command Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
              Live Operations Telemetry &bull; Colombo Standard Time (GMT+5:30)
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5 mt-1">
            <Truck className="size-6 text-primary" />
            <span>Dispatcher Command Center</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Active multi-stop manifests, priority order inflow, vehicle allocation readiness, and exception resolution.
          </p>
        </div>

        {/* Action Controls & Hub Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {canSwitchDepot ? (
            <div className="inline-flex rounded-lg border border-border bg-card p-1 text-xs font-medium" aria-label="Depot scope">
              <button
                onClick={() => { setDispatcherDepot("peliyagoda"); setHubFilter("peliyagoda"); }}
                className={`px-3 py-1 rounded-md transition-all ${
                  hubFilter === "peliyagoda"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Peliyagoda
              </button>
              <button
                onClick={() => { setDispatcherDepot("kandy"); setHubFilter("kandy"); }}
                className={`px-3 py-1 rounded-md transition-all ${
                  hubFilter === "kandy"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Kandy
              </button>
            </div>
          ) : (
            <Badge variant="outline" className="border-primary/30 bg-accent text-primary text-xs font-semibold">
              {hubFilter === "peliyagoda" ? "Peliyagoda Depot" : "Kandy Depot"}
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isRefreshing}
            className="text-xs gap-1.5 border-border"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
          </Button>

          <Button asChild size="sm" className="text-xs gap-1.5 bg-primary font-semibold">
            <Link href="/dispatcher/orders">
              <FileText className="size-3.5" />
              <span>Inspect Queue ({pendingOrders.length})</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Operational Pulse: 4 Key Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Runs */}
        <Card className="border-border shadow-xs hover:border-primary/40 transition-all">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active Trips On Road
              </span>
              <Activity className="size-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-3xl font-extrabold text-foreground">
              {isLoading ? "..." : activeRuns.length}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{runs.filter((r) => r.status === "en_route").length} En Route</span>
              <span>&bull;</span>
              <span>{runs.filter((r) => r.status === "loading").length} Loading</span>
              <span>&bull;</span>
              <span>{runs.filter((r) => r.status === "scheduled").length} Scheduled</span>
            </div>
          </CardContent>
        </Card>

        {/* Orders Pending Dispatch */}
        <Card className="border-border shadow-xs hover:border-primary/40 transition-all">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Orders Awaiting Dispatch
              </span>
              <FileText className="size-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground">
                {isLoading ? "..." : pendingOrders.length}
              </span>
              {highPriorityOrders.length > 0 && (
                <span className="text-xs font-semibold text-destructive flex items-center gap-0.5">
                  <Zap className="size-3 fill-destructive" />
                  {highPriorityOrders.length} Urgent
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {orders.filter((o) => o.status === "ALLOCATED").length} Allocated &bull;{" "}
              {orders.filter((o) => o.status === "DELIVERED").length} Completed today
            </div>
          </CardContent>
        </Card>

        {/* Fleet Availability */}
        <Card className="border-border shadow-xs hover:border-primary/40 transition-all">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fleet Readiness Rate
              </span>
              <Truck className="size-4 text-sky-500" />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-foreground">
                {isLoading ? "..." : `${fleetReadinessPct}%`}
              </span>
              <span className="text-xs text-muted-foreground">
                {availableVehiclesCount} / {filteredVehicles.length} Available
              </span>
            </div>
            <div className="mt-2">
              <Progress value={fleetReadinessPct} className="h-1.5" />
            </div>
          </CardContent>
        </Card>

        {/* Exceptions & Shortfalls */}
        <Card className="border-border shadow-xs hover:border-primary/40 transition-all">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Exceptions &amp; Shortages
              </span>
              <AlertTriangle className="size-4 text-amber-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">
                {isLoading ? "..." : deferredOrders.length + partialItemsCount}
              </span>
              <span className="text-xs text-muted-foreground">attention items</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {deferredOrders.length} Deferred orders &bull; {partialItemsCount} Stock shortfalls
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Active Trips & Urgent Queue (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Delivery Runs Monitor */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 sm:p-5 border-b border-border flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Navigation className="size-4 text-primary" />
                  <span>Active Delivery Manifests &amp; Runs</span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Live multi-stop runs currently in progress, loading, or staged for departure.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-xs gap-1">
                <Link href="/dispatcher/delivery-runs">
                  <span>View All Runs</span>
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {isLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                  Loading active delivery runs...
                </div>
              ) : filteredRuns.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No active delivery runs recorded for this depot selection.
                </div>
              ) : (
                filteredRuns.slice(0, 4).map((run) => {
                  const progressPct =
                    run.stop_count > 0
                      ? Math.round((run.stops_completed / run.stop_count) * 100)
                      : 0;

                  return (
                    <div
                      key={run.id}
                      className="p-3.5 rounded-lg border border-border bg-card/60 hover:bg-muted/40 transition-colors space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-foreground px-2 py-0.5 rounded bg-muted border border-border">
                            {run.trip_code}
                          </span>
                          <span className="text-xs font-medium text-foreground">
                            {run.driver_name || "Unassigned Driver"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            &bull; {run.vehicle_number || "No Vehicle"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground capitalize">
                            {run.depot_name} Depot
                          </span>
                          {getRunStatusBadge(run.status)}
                        </div>
                      </div>

                      {/* Stops Progress */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            Progress:{" "}
                            <strong className="text-foreground">
                              {run.stops_completed} of {run.stop_count} stops completed
                            </strong>
                          </span>
                          <span>{progressPct}%</span>
                        </div>
                        <Progress value={progressPct} className="h-1.5" />
                      </div>

                      {/* Weight and stops info */}
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                        <span>
                          Payload:{" "}
                          <strong className="text-foreground">
                            {run.total_weight_kg ? `${run.total_weight_kg.toLocaleString()} kg` : "—"}
                          </strong>
                        </span>
                        {run.departure_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            Dep: {new Date(run.departure_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                        <Link
                          href={`/dispatcher/live-tracking`}
                          className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                        >
                          <span>Track GPS</span>
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Urgent Orders Inflow Radar */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 sm:p-5 border-b border-border flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Zap className="size-4 text-destructive" />
                  <span>Urgent Order Inflow &amp; SLA Cutoffs</span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Orders requiring immediate dispatcher prioritization and vehicle allocation.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-xs gap-1">
                <Link href="/dispatcher/orders">
                  <span>Open Orders Queue</span>
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-primary" />
                  Scanning incoming store orders...
                </div>
              ) : urgentOrders.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <CheckCircle2 className="size-5 text-emerald-500 mx-auto mb-1.5" />
                  All incoming orders currently allocated or fulfilled.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {urgentOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-3.5 sm:px-5 flex items-center justify-between hover:bg-muted/40 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-foreground">
                            {order.order_number}
                          </span>
                          {getPriorityBadge(order.priority)}
                          <span className="text-xs text-muted-foreground">&bull;</span>
                          <span className="text-xs font-semibold text-foreground">
                            {order.client_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3 text-muted-foreground" />
                            Delivery:{" "}
                            <strong className="text-foreground">
                              {order.delivery_date || "Today"}
                            </strong>
                          </span>
                          <span>&bull;</span>
                          <span>
                            {order.items?.length || 0} line items
                          </span>
                          {order.total_weight_kg && (
                            <>
                              <span>&bull;</span>
                              <span>{order.total_weight_kg} kg</span>
                            </>
                          )}
                        </div>
                      </div>

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-medium border-border"
                      >
                        <Link href="/dispatcher/orders">
                          Inspect &amp; Defer
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Fleet Distribution & Operations Hub (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Depot Fleet & Van-Only Readiness */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 sm:p-5 border-b border-border pb-3">
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Warehouse className="size-4 text-primary" />
                <span>Depot Capacity &amp; Fleet Status</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Readiness breakdown across Peliyagoda and Kandy hubs.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              {/* Peliyagoda Hub Row */}
              <div className="p-3.5 rounded-lg border border-border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-sky-500" />
                    <span className="font-bold text-foreground">Peliyagoda Hub</span>
                    <span className="text-[10px] text-muted-foreground">(Western Sector)</span>
                  </div>
                  <Badge variant="outline" className="border-sky-500/30 text-sky-700 dark:text-sky-300 font-semibold text-[10px]">
                    {vehicles.filter((v) => v.depot_name.toLowerCase() === "peliyagoda" && v.status === "AVAILABLE").length} Ready
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1">
                  <div>
                    <span className="block text-[10px]">Total Fleet</span>
                    <strong className="text-foreground">
                      {vehicles.filter((v) => v.depot_name.toLowerCase() === "peliyagoda").length} units
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px]">Delivery Vans</span>
                    <strong className="text-purple-600 dark:text-purple-400">
                      {vehicles.filter((v) => v.depot_name.toLowerCase() === "peliyagoda" && v.vehicle_type === "van").length} vans
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px]">Active Runs</span>
                    <strong className="text-foreground">
                      {runs.filter((r) => (r.depot_name || "").toLowerCase() === "peliyagoda").length} trips
                    </strong>
                  </div>
                </div>
              </div>

              {/* Kandy Hub Row */}
              <div className="p-3.5 rounded-lg border border-border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-500" />
                    <span className="font-bold text-foreground">Kandy Hub</span>
                    <span className="text-[10px] text-muted-foreground">(Central / Hill Country)</span>
                  </div>
                  <Badge variant="outline" className="border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-semibold text-[10px]">
                    {vehicles.filter((v) => v.depot_name.toLowerCase() === "kandy" && v.status === "AVAILABLE").length} Ready
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1">
                  <div>
                    <span className="block text-[10px]">Total Fleet</span>
                    <strong className="text-foreground">
                      {vehicles.filter((v) => v.depot_name.toLowerCase() === "kandy").length} units
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px]">Delivery Vans</span>
                    <strong className="text-purple-600 dark:text-purple-400">
                      {vehicles.filter((v) => v.depot_name.toLowerCase() === "kandy" && v.vehicle_type === "van").length} vans
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px]">Active Runs</span>
                    <strong className="text-foreground">
                      {runs.filter((r) => (r.depot_name || "").toLowerCase() === "kandy").length} trips
                    </strong>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-800 dark:text-purple-300 flex items-start gap-2">
                <CarFront className="size-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Van Restriction Enforcement:</strong> 42 verified outlets require strict van access. Rigid trucks must not be assigned to mall docks or street turns.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Operations Launchpad */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 sm:p-5 border-b border-border pb-3">
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                <span>Operations Launchpad</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Rapid navigation across active dispatch modules.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-2 gap-2.5">
              <Link
                href="/dispatcher/orders"
                className="p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <FileText className="size-4 text-primary" />
                  <Badge variant="secondary" className="text-[10px] font-bold">
                    {orders.length}
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="font-semibold text-xs text-foreground">Order Queue</div>
                  <div className="text-[10px] text-muted-foreground">Shortfalls &amp; Deferrals</div>
                </div>
              </Link>

              <Link
                href="/dispatcher/allocations"
                className="p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <Navigation className="size-4 text-sky-500" />
                  <Badge variant="secondary" className="text-[10px] font-bold">
                    Active
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="font-semibold text-xs text-foreground">Trip Allocations</div>
                  <div className="text-[10px] text-muted-foreground">Vehicle assignment</div>
                </div>
              </Link>

              <Link
                href="/dispatcher/delivery-runs"
                className="p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <Truck className="size-4 text-emerald-500" />
                  <Badge variant="secondary" className="text-[10px] font-bold">
                    {runs.length}
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="font-semibold text-xs text-foreground">Delivery Runs</div>
                  <div className="text-[10px] text-muted-foreground">Multi-stop manifests</div>
                </div>
              </Link>

              <Link
                href="/dispatcher/live-tracking"
                className="p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <Activity className="size-4 text-rose-500" />
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="mt-2">
                  <div className="font-semibold text-xs text-foreground">Live Tracking</div>
                  <div className="text-[10px] text-muted-foreground">Real-time GPS status</div>
                </div>
              </Link>

              <Link
                href="/dispatcher/outlets"
                className="col-span-2 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <Store className="size-4 text-purple-500" />
                  <Badge variant="secondary" className="text-[10px] font-bold">
                    {outletCount}
                  </Badge>
                </div>
                <div className="mt-2">
                  <div className="font-semibold text-xs text-foreground">Outlets Registry</div>
                  <div className="text-[10px] text-muted-foreground">Docking &amp; Hours</div>
                </div>
              </Link>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
