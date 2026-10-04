"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "@/components/dispatcher/MetricCard";
import { FilterBar } from "@/components/dispatcher/FilterBar";
import { DeliveryRunTable } from "@/components/dispatcher/DeliveryRunTable";
import { DeliveryRunDetailPanel } from "@/components/dispatcher/DeliveryRunDetailPanel";
import { RouteOptimizationDialog } from "@/components/dispatcher/RouteOptimizationDialog";
import { LoadingReadinessDialog } from "@/components/dispatcher/LoadingReadinessDialog";
import { LoadingShortfallDialog } from "@/components/dispatcher/LoadingShortfallDialog";
import { ManifestDialog } from "@/components/dispatcher/ManifestDialog";

import { toast } from "sonner";
import { dispatcherDepotHeaders } from "@/lib/dispatcher-depot";

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Planned", value: "scheduled" },
  { label: "Ready", value: "ready" },
  { label: "On Route", value: "en_route" },
  { label: "Delayed", value: "delayed" },
  { label: "Completed", value: "completed" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

export interface DeliveryRunStop {
  id: string;
  outlet_code: string;
  name: string;
  eta: string;
  sla_ok: boolean;
  sla_note: string;
}

export interface DeliveryRun {
  id: number;
  allocation_id?: number | null;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader?: any;
  loader_warning?: string | null;
}

export default function DeliveryRunsPage() {
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [depotFilter, setDepotFilter] = useState("");
  const [selectedRun, setSelectedRun] = useState<DeliveryRun | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Dialog state
  const [showRouteOpt, setShowRouteOpt] = useState(false);
  const [showLoadingReadiness, setShowLoadingReadiness] = useState(false);
  const [showShortfall, setShowShortfall] = useState(false);
  const [showManifest, setShowManifest] = useState(false);

  const fetchRuns = useCallback(async (isBackground = false) => {
    if (!isBackground) setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/`, { headers: dispatcherDepotHeaders() });
      if (res.ok) {
        const data: DeliveryRun[] = await res.json();
        setRuns(data);
        // Re-sync selected run with fresh data (using functional updater to avoid stale closure)
        setSelectedRun(prev => {
          if (!prev) return null;
          return data.find((r) => r.id === prev.id) ?? prev;
        });
      } else {
        if (!isBackground) toast.error("Failed to load delivery runs from server");
      }
    } catch {
      if (!isBackground) toast.error("Failed to load delivery runs — check your connection");
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, []); // No dependencies — fetchRuns is stable

  const hasSelectedRun = selectedRun !== null;
  useEffect(() => {
    const initial = setTimeout(() => { void fetchRuns(); }, 0);
    let interval: NodeJS.Timeout;
    if (hasSelectedRun) {
      interval = setInterval(() => fetchRuns(true), 15000);
    }
    return () => {
      clearTimeout(initial);
      if (interval) clearInterval(interval);
    }
  }, [fetchRuns, hasSelectedRun]);

  // Derive "delayed" status on frontend (en_route + overdue ETA)
  const now = new Date();
  const enriched = runs.map(r => ({
    ...r,
    displayStatus: (r.status === "en_route" && r.estimated_arrival && new Date(r.estimated_arrival) < now)
      ? "delayed" : r.status
  }));

  const depots = useMemo(() => [...new Set(runs.map(r => r.depot_name).filter(Boolean))], [runs]);

  const depotOptions = useMemo(() => [
    { label: "All Depots", value: "" },
    ...depots.map(d => ({ label: d.charAt(0).toUpperCase() + d.slice(1), value: d }))
  ], [depots]);

  const filtered = enriched.filter(r => {
    const s = searchQuery.toLowerCase();
    const matchSearch = !s || r.trip_code.toLowerCase().includes(s) ||
      r.vehicle_number.toLowerCase().includes(s) || r.driver_name.toLowerCase().includes(s);
    const matchStatus = !statusFilter || r.displayStatus === statusFilter;
    const matchDepot = !depotFilter || r.depot_name === depotFilter;
    return matchSearch && matchStatus && matchDepot;
  });

  const planned = enriched.filter(r => r.displayStatus === "scheduled").length;
  const ready   = enriched.filter(r => r.displayStatus === "ready").length;
  const onRoute = enriched.filter(r => r.displayStatus === "en_route").length;
  const delayed = enriched.filter(r => r.displayStatus === "delayed").length;

  return (
    <div className="space-y-6 flex flex-col h-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Delivery Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage planned trips, stop sequences, manifests, and route readiness.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="PLANNED" value={planned.toString()} />
        <MetricCard title="READY" value={ready.toString()} />
        <MetricCard title="ON ROUTE" value={onRoute.toString()} />
        <MetricCard title="DELAYED" value={delayed.toString()} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search vehicle, driver or run..."
          onSearchChange={setSearchQuery}
          statusOptions={STATUS_OPTIONS}
          onStatusChange={setStatusFilter}
          typeOptions={depotOptions}
          onTypeChange={setDepotFilter}
        />

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
