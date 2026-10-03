"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Truck, Search } from "lucide-react";
import { MetricCard } from "@/components/dispatcher/MetricCard";
import { DeliveryRunTable } from "@/components/dispatcher/DeliveryRunTable";
import { DeliveryRunDetailPanel } from "@/components/dispatcher/DeliveryRunDetailPanel";
import { RouteOptimizationDialog } from "@/components/dispatcher/RouteOptimizationDialog";
import { LoadingReadinessDialog } from "@/components/dispatcher/LoadingReadinessDialog";
import { LoadingShortfallDialog } from "@/components/dispatcher/LoadingShortfallDialog";
import { ManifestDialog } from "@/components/dispatcher/ManifestDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { toast } from "sonner";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

export interface DeliveryRunStop {
  id: string;
  name: string;
  eta: string;
  sla_ok: boolean;
  sla_note: string;
}

export interface DeliveryRun {
  id: number;
  trip_code: string;
  vehicle_number: string;
  driver_name: string;
  stop_count: number;
  stops_completed: number;
  departure_time: string | null;
  estimated_arrival: string | null;
  depot_name: string;
  status: string;
  displayStatus: string;
  stop_sequence: (DeliveryRunStop | string)[];
  open_shortfalls: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loading_events: any[];
  total_weight_kg: number;
  total_volume_m3: number;
}

export default function DeliveryRunsPage() {
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [depotFilter, setDepotFilter] = useState("all");
  const [selectedRun, setSelectedRun] = useState<DeliveryRun | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Dialog state
  const [showRouteOpt, setShowRouteOpt] = useState(false);
  const [showLoadingReadiness, setShowLoadingReadiness] = useState(false);
  const [showShortfall, setShowShortfall] = useState(false);
  const [showManifest, setShowManifest] = useState(false);

  const fetchRuns = useCallback(async (background?: unknown) => {
    // Background refreshes keep the table on screen instead of flashing a loader
    const silent = background === true;
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/`);
      if (res.ok) {
        const data: DeliveryRun[] = await res.json();
        setRuns(data);
        // Re-sync selected run with fresh data (using functional updater to avoid stale closure)
        setSelectedRun(prev => {
          if (!prev) return null;
          return data.find((r) => r.id === prev.id) ?? prev;
        });
      } else {
        toast.error("Failed to load delivery runs from server");
      }
    } catch {
      toast.error("Failed to load delivery runs — check your connection");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []); // No dependencies — fetchRuns is stable

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Keep progress current as drivers' records sync (server-confirmed only)
  useEffect(() => {
    const id = setInterval(() => fetchRuns(true), 30_000);
    return () => clearInterval(id);
  }, [fetchRuns]);

  // Derive "delayed" status on frontend (en_route + overdue ETA)
  const now = new Date();
  const enriched = runs.map(r => ({
    ...r,
    displayStatus: (r.status === "en_route" && r.estimated_arrival && new Date(r.estimated_arrival) < now)
      ? "delayed" : r.status
  }));

  const filtered = enriched.filter(r => {
    const s = search.toLowerCase();
    const matchSearch = !s || r.trip_code.toLowerCase().includes(s) ||
      r.vehicle_number.toLowerCase().includes(s) || r.driver_name.toLowerCase().includes(s);
    const matchStatus = statusFilter === "all" || r.displayStatus === statusFilter;
    const matchDepot = depotFilter === "all" || r.depot_name === depotFilter;
    return matchSearch && matchStatus && matchDepot;
  });

  // Derive depots list dynamically from real data
  const depots = useMemo(() => [...new Set(runs.map(r => r.depot_name).filter(Boolean))], [runs]);

  const planned = enriched.filter(r => r.displayStatus === "scheduled").length;
  const ready   = enriched.filter(r => r.displayStatus === "ready").length;
  const onRoute = enriched.filter(r => r.displayStatus === "en_route").length;
  const delayed = enriched.filter(r => r.displayStatus === "delayed").length;

  return (
    <div className="max-w-full mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Truck className="h-6 w-6 text-[#18385F]" />
          Delivery Runs
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage planned trips, stop sequences, manifests, and route readiness.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input placeholder="Search vehicle, driver or run..." value={search}
            onChange={e => setSearch(e.target.value)} className="h-9 pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Planned</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="en_route">On Route</SelectItem>
            <SelectItem value="delayed">Delayed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={depotFilter} onValueChange={setDepotFilter}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Depot" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Depots</SelectItem>
            {depots.map(d => (
              <SelectItem key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard title="Planned" value={planned.toString()} />
        <MetricCard title="Ready" value={ready.toString()} />
        <MetricCard title="On Route" value={onRoute.toString()} />
        <MetricCard title="Delayed" value={delayed.toString()} />
      </div>

      {/* Table + Detail Panel */}
      <div className="flex gap-4 items-start">
        <div className={selectedRun ? "flex-1 min-w-0" : "w-full"}>
          <DeliveryRunTable runs={filtered} isLoading={isLoading}
            selectedRunId={selectedRun?.id ?? null} onRowClick={setSelectedRun} />
        </div>
        {selectedRun && (
          <div className="w-[340px] shrink-0">
            <DeliveryRunDetailPanel
              run={selectedRun}
              onClose={() => setSelectedRun(null)}
              onUpdate={fetchRuns}
              onViewManifest={() => setShowManifest(true)}
              onOptimizeRoute={() => setShowRouteOpt(true)}
              onViewLoadingStatus={() => {
                if (selectedRun.open_shortfalls > 0) setShowShortfall(true);
                else setShowLoadingReadiness(true);
              }}
            />
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showManifest && selectedRun && (
        <ManifestDialog run={selectedRun} onClose={() => setShowManifest(false)} />
      )}
      {showRouteOpt && selectedRun && (
        <RouteOptimizationDialog run={selectedRun} onClose={() => setShowRouteOpt(false)} onApply={fetchRuns} />
      )}
      {showLoadingReadiness && selectedRun && (
        <LoadingReadinessDialog run={selectedRun} onClose={() => setShowLoadingReadiness(false)} />
      )}
      {showShortfall && selectedRun && (
        <LoadingShortfallDialog run={selectedRun} onClose={() => setShowShortfall(false)} onAction={fetchRuns} />
      )}
    </div>
  );
}
