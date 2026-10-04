"use client";
import React, { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, AlertTriangle, Truck } from "lucide-react";
import { MetricCard } from "@/components/dispatcher/MetricCard";
import { LiveRunList } from "@/components/dispatcher/LiveRunList";
import { LiveRouteMap } from "@/components/dispatcher/LiveRouteMap";
import { RunOperationsDialog } from "@/components/dispatcher/RunOperationsDialog";
import { SyncDegradedDialog } from "@/components/dispatcher/SyncDegradedDialog";
import { SyncConflictDialog } from "@/components/dispatcher/SyncConflictDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

export interface LiveRun {
  id: number;
  trip_code: string;
  vehicle_number: string;
  driver_name: string;
  depot_name: string;
  origin: string;
  destination: string;
  status: string;
  departure_time: string | null;
  estimated_arrival: string | null;
  stop_count: number;
  stops_completed: number;
  stop_sequence: (string | { name?: string })[];
  open_shortfalls: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loading_events: any[];
  total_weight_kg: number;
  total_volume_m3: number;
  updated_at: string | null;
  sync_status: "ok" | "degraded" | "conflict" | "unknown";
  last_update_mins: number | null;
}

export default function LiveTrackingPage() {
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [depotFilter, setDepotFilter] = useState("all");
  const [selectedRun, setSelectedRun] = useState<LiveRun | null>(null);
  
  // Dialog visibility state
  const [showRunOps, setShowRunOps] = useState(false);
  const [showDegraded, setShowDegraded] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/live`);
      if (res.ok) {
        const data: LiveRun[] = await res.json();
        setRuns(data);
        setLastRefreshed(new Date());
        setSelectedRun(previous => previous ? data.find(r => r.id === previous.id) ?? previous : null);
      } else {
        toast.error("Failed to load live runs");
      }
    } catch {
      toast.error("Network error loading live tracking");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => { void fetchRuns(); }, 0);
    const id = setInterval(() => { void fetchRuns(); }, 30_000);
    return () => { clearTimeout(initial); clearInterval(id); };
  }, [fetchRuns]);

  // Handlers for Dialog Flows
  const handleReviewException = () => {
    setShowRunOps(false);
    if (selectedRun?.sync_status === "conflict") setShowConflict(true);
    else setShowDegraded(true);
  };

  const handleReviewConflict = () => {
    setShowDegraded(false);
    setShowConflict(true);
  };

  const handleBackToSyncQueue = () => {
    setShowConflict(false);
    setShowDegraded(true);
  };

  const handleResolveConflict = async (choice: "field" | "dispatcher") => {
    if (!selectedRun) return;
    try {
      if (choice === "field") {
        await fetch(`${API_BASE}/api/v1/delivery-runs/${selectedRun.id}/mark-stop-complete`, { method: "POST" });
        toast.success("Conflict resolved — field outcome accepted");
      } else {
        await fetch(`${API_BASE}/api/v1/delivery-runs/${selectedRun.id}/recall-run`, { method: "POST" });
        toast.success("Conflict resolved — dispatcher plan applied");
      }
      setShowConflict(false);
      fetchRuns();
    } catch {
      toast.error("Network error while resolving conflict");
    }
  };

  // Filter Data
  const uniqueDepots = Array.from(new Set(runs.map(r => r.depot_name).filter(Boolean)));
  
  const filteredRuns = runs.filter((r) => {
    const matchesSearch = r.trip_code.toLowerCase().includes(search.toLowerCase()) ||
                          r.driver_name.toLowerCase().includes(search.toLowerCase()) ||
                          r.vehicle_number.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || r.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesDepot = depotFilter === "all" || r.depot_name === depotFilter;
    return matchesSearch && matchesStatus && matchesDepot;
  });

  // Derived Metrics
  const activeCount = runs.filter(r => r.status === "en_route" || r.status === "scheduled" || r.status === "ready").length;
  const completedCount = runs.filter(r => r.status === "completed").length;
  const delayedCount = runs.filter(r => r.sync_status !== "ok" || r.open_shortfalls > 0).length;
  const exceptionsCount = runs.filter(r => r.sync_status === "conflict").length;

  // Derived Needs Attention Items
  const attentionItems = runs.flatMap(r => {
    const items = [];
    if (r.last_update_mins !== null && r.last_update_mins > 10) {
      items.push({ message: `${r.vehicle_number} is ${r.last_update_mins} min behind schedule`, severity: 'High' });
    }
    if (r.open_shortfalls > 0) {
      items.push({ message: `${r.trip_code} has ${r.open_shortfalls} open shortfall(s)`, severity: 'Medium' });
    }
    if (r.sync_status === "degraded") {
      items.push({ message: `Driver sync pending on ${r.vehicle_number}`, severity: 'Low' });
    }
    return items;
  });

  const severityColor = (severity: string) => {
    if (severity === 'High') return 'bg-red-50 text-red-600 border border-red-100';
    if (severity === 'Medium') return 'bg-amber-50 text-amber-600 border border-amber-100';
    return 'bg-slate-100 text-slate-600 border border-slate-200';
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <Truck className="size-5 text-[#18385F]" />
          <h1 className="text-xl font-bold text-slate-900">Live Tracking</h1>
          <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-emerald-100">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
        <p className="text-sm text-slate-500">Monitor active runs, vehicle positions, delivery progress, and live exceptions.</p>
      </div>

      {/* ── Filter Bar ── */}
      <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <Input
              placeholder="Search vehicle, driver or run..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[280px] h-9 bg-white border-slate-200 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] h-9 bg-white border-slate-200">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="en_route">En Route</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={depotFilter} onValueChange={setDepotFilter}>
            <SelectTrigger className="w-[180px] h-9 bg-white border-slate-200">
              <SelectValue placeholder="Depot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Depots</SelectItem>
              {uniqueDepots.map(d => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-slate-400">
              Last updated: {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRuns}
            disabled={isLoading}
            className="h-9 gap-2 border-slate-200 bg-white text-slate-700"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Metrics Row ── */}
      <div className="px-6 py-4 grid grid-cols-4 gap-4 border-b border-slate-100 bg-[#F8F9FC]">
        <MetricCard title="Active Trips" value={activeCount} />
        <MetricCard title="Completed" value={completedCount} />
        <MetricCard title="Delayed" value={delayedCount} />
        <MetricCard title="Exceptions" value={exceptionsCount} />
      </div>

      {/* ── Main 2-column body ── */}
      <div className="flex flex-1 overflow-hidden bg-white">
        {/* Left: Active Routes */}
        <div className="w-[340px] flex-shrink-0 border-r border-slate-100 flex flex-col bg-slate-50/50">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 mb-0.5">Active Routes</h2>
            <p className="text-xs text-slate-500">Select a run to focus the map.</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {isLoading && runs.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                 <RefreshCw className="size-6 animate-spin mb-3 text-slate-300" />
                 <p className="text-sm">Loading routes...</p>
               </div>
            ) : filteredRuns.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                 <p className="text-sm">No active routes found.</p>
               </div>
            ) : (
               <LiveRunList runs={filteredRuns} selectedRunId={selectedRun?.id ?? null} onSelect={setSelectedRun} />
            )}
          </div>
        </div>

        {/* Right: Map + Needs Attention */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Map Panel */}
          <div className="flex-1 border-b border-slate-100 relative p-6 bg-white flex flex-col">
            <div className="flex justify-between items-start mb-4 flex-shrink-0">
              <div>
                <h2 className="text-sm font-bold text-slate-900 mb-0.5">Live Route Map</h2>
                {selectedRun ? (
                  <p className="text-xs text-slate-500">Selected: {selectedRun.vehicle_number} · {selectedRun.trip_code}</p>
                ) : (
                  <p className="text-xs text-slate-500">Select a run to view its active route map.</p>
                )}
              </div>
              {selectedRun && (
                <Button 
                  variant="outline" 
                  size="sm"
                  className="h-8 border-slate-200 text-slate-700 bg-white font-medium"
                  onClick={() => setShowRunOps(true)}
                >
                  View Run Operations
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <LiveRouteMap run={selectedRun} />
            </div>
          </div>

          {/* Needs Attention Panel */}
          <div className="h-[220px] overflow-y-auto p-6 bg-slate-50/50 flex-shrink-0">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="size-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900">Needs Attention</h3>
            </div>
            
            {attentionItems.length === 0 ? (
               <p className="text-sm text-slate-500 italic">No alerts requiring attention.</p>
            ) : (
               <div className="space-y-2">
                 {attentionItems.map((item, i) => (
                   <div key={i} className="flex justify-between items-center py-3 px-4 bg-white border border-slate-200 rounded-[8px] shadow-sm">
                     <span className="text-sm text-slate-700 font-medium">{item.message}</span>
                     <span className={`text-xs font-bold px-2 py-1 rounded-[6px] ${severityColor(item.severity)}`}>
                       {item.severity}
                     </span>
                   </div>
                 ))}
               </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dialogs ── */}
      {showRunOps && selectedRun && (
        <RunOperationsDialog 
          open={showRunOps} 
          run={selectedRun} 
          onClose={() => setShowRunOps(false)} 
          onReviewException={handleReviewException} 
        />
      )}
      {showDegraded && selectedRun && (
        <SyncDegradedDialog 
          open={showDegraded} 
          run={selectedRun} 
          onClose={() => setShowDegraded(false)} 
          onReviewConflict={handleReviewConflict} 
        />
      )}
      {showConflict && selectedRun && (
        <SyncConflictDialog 
          open={showConflict} 
          run={selectedRun} 
          onClose={() => setShowConflict(false)} 
          onBack={handleBackToSyncQueue} 
          onResolve={handleResolveConflict} 
        />
      )}
    </div>
  );
}
