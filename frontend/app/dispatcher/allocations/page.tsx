"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "@/components/dispatcher/MetricCard";
import { FilterBar } from "@/components/dispatcher/FilterBar";
import { AllocationTable } from "@/components/dispatcher/AllocationTable";
import { AllocationDetailDrawer } from "@/components/dispatcher/AllocationDetailDrawer";
import { Button } from "@/components/ui/button";
import { type Allocation } from "@/components/dispatcher/AllocationTable";
import { fetchWithFallback } from "@/lib/api";

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Available", value: "available" },
  { label: "Allocated", value: "allocated" },
  { label: "Ready", value: "ready" },
  { label: "Loading", value: "loading" },
  { label: "Unavailable", value: "unavailable" },
];

const TYPE_OPTIONS = [
  { label: "All Types", value: "" },
  { label: "Van", value: "van" },
  { label: "Reefer", value: "reefer" },
  { label: "Dry Box", value: "dry box" },
];


export default function AllocationsPage() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // Drawer states
  const [selectedAllocation, setSelectedAllocation] = useState<Allocation | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const fetchAllocations = useCallback(async () => {
    setFetchError(false);
    try {
      const response = await fetchWithFallback("/api/v1/allocations/");
      if (response.ok) {
        const data = await response.json();
        setAllocations(data);
      } else {
        console.warn("API returned error, falling back to mock data.");
        setFetchError(true);
      }
    } catch (error) {
      console.warn("Fetch failed, falling back to mock data:", error);
      setFetchError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAllocations();
  }, [fetchAllocations]);

  // Use real data from API; show empty on API error so backend issues are visible
  const rawData = useMemo(() => (fetchError ? [] : allocations), [fetchError, allocations]);

  // Filter logic (client-side filtering)
  const filteredData = useMemo(() => {
    return rawData.filter((alloc) => {
      const search = searchQuery.toLowerCase();
      const matchesSearch =
        !search ||
        alloc.vehicle?.code?.toLowerCase().includes(search) ||
        alloc.driver?.user?.full_name?.toLowerCase().includes(search) ||
        alloc.run_id?.toLowerCase().includes(search);

      // Normalise both sides to lowercase so "READY" === "ready" works
      const matchesStatus = !statusFilter || alloc.status?.toLowerCase() === statusFilter.toLowerCase();
      const matchesType = !typeFilter || alloc.vehicle?.vehicle_type?.toLowerCase().includes(typeFilter);

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [rawData, searchQuery, statusFilter, typeFilter]);

  // Dynamic metric counts — normalise status to lowercase before comparing
  const metrics = useMemo(() => {
    const counts = { available: 0, allocated: 0, loading: 0, ready: 0, unavailable: 0 };
    rawData.forEach((a) => {
      const s = a.status?.toLowerCase();
      if (s === "available") counts.available++;
      else if (s === "allocated" || s === "draft") counts.allocated++;
      else if (s === "loading") counts.loading++;
      else if (s === "ready") counts.ready++;
      else if (s === "unavailable" || s === "cancelled") counts.unavailable++;
    });
    return counts;
  }, [rawData]);

  const handleViewClick = (allocation: Allocation) => {
    setSelectedAllocation(allocation);
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Allocations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review today&apos;s fleet assignments, capacity usage, drivers, and allocation readiness.
          </p>
        </div>
      </div>

      {/* Metrics Row — counts computed live from data */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard title="AVAILABLE" value={metrics.available.toString()} />
        <MetricCard title="ALLOCATED" value={metrics.allocated.toString()} />
        <MetricCard title="LOADING" value={metrics.loading.toString()} />
        <MetricCard title="READY" value={metrics.ready.toString()} />
        <MetricCard title="UNAVAILABLE" value={metrics.unavailable.toString()} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search vehicle, driver or run..."
          onSearchChange={setSearchQuery}
          statusOptions={STATUS_OPTIONS}
          onStatusChange={setStatusFilter}
          typeOptions={TYPE_OPTIONS}
          onTypeChange={setTypeFilter}
        />

        {fetchError && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <p className="text-sm font-medium text-destructive">Failed to load allocations from server.</p>
            <p className="text-xs text-muted-foreground">Check the backend is running, then retry.</p>
            <Button variant="outline" size="sm" onClick={fetchAllocations}>Retry</Button>
          </div>
        ) : (
          <AllocationTable allocations={filteredData} isLoading={isLoading} onViewClick={handleViewClick} />
        )}
      </div>

      {/* Detail Drawer — opens when View is clicked */}
      <AllocationDetailDrawer
        open={!!selectedAllocation}
        onOpenChange={(open) => { if (!open) setSelectedAllocation(null); }}
        allocation={selectedAllocation}
        onSuccess={fetchAllocations}
      />
    </div>
  );
}
