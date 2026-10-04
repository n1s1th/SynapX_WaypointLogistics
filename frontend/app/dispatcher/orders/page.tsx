"use client";

import React, { useState, useEffect, useMemo } from "react";
import { type Order, type OrderMetrics } from "@/types/order";
import { OrdersTable } from "@/components/dispatcher/orders/OrdersTable";
import { OrdersFilterBar } from "@/components/dispatcher/orders/OrdersFilterBar";
import { QuickAllocationDrawer } from "@/components/dispatcher/orders/QuickAllocationDrawer";
import { LateOrdersDrawer } from "@/components/dispatcher/orders/LateOrdersDrawer";
import { CapacityShortfallModal } from "@/components/dispatcher/orders/CapacityShortfallModal";
import { AllocationSuccessBanner } from "@/components/dispatcher/orders/AllocationSuccessBanner";
import { MetricCard } from "@/components/dispatcher/MetricCard";
import { Button } from "@/components/ui/button";
import { fetchWithFallback } from "@/lib/api";
import { DEPOT_CHANGE_EVENT } from "@/lib/dispatcher-depot";
import { RefreshCw, Package, Layers } from "lucide-react";
import { StocksView } from "@/components/dispatcher/orders/StocksView";
import { OrderDetailDrawer } from "@/components/dispatcher/orders/OrderDetailDrawer";

export default function DispatcherOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<OrderMetrics>({
    total_orders: 0,
    confirmed: 0,
    unallocated: 0,
    allocated: 0,
    deferred: 0,
    priority: 0,
    late: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const [activeViewTab, setActiveViewTab] = useState<"orders" | "stocks">("orders");

  // Drawers and Modals
  const [isAllocationOpen, setIsAllocationOpen] = useState(false);
  const [isLateOrdersOpen, setIsLateOrdersOpen] = useState(false);
  const [isCapacityShortfallOpen, setIsCapacityShortfallOpen] = useState(false);
  const [inspectingOrder, setInspectingOrder] = useState<Order | null>(null);

  // Success Banner
  const [successBanner, setSuccessBanner] = useState<{
    vehicleCode: string;
    count: number;
  } | null>(null);

  // Selection
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("27 Jun 2026");

  // Fetch orders and metrics on filter change or refresh
  useEffect(() => {
    let ignore = false;

    async function loadOrdersAndMetrics() {
      try {
        const metricsRes = await fetchWithFallback("/api/v1/orders/metrics");
        if (metricsRes.ok && !ignore) {
          const mData = await metricsRes.json();
          setMetrics(mData);
        }

        const queryParams = new URLSearchParams();
        if (statusFilter && statusFilter !== "all") queryParams.append("status", statusFilter);
        if (brandFilter && brandFilter !== "all") queryParams.append("brand", brandFilter);
        if (districtFilter && districtFilter !== "all") queryParams.append("district", districtFilter);
        if (searchQuery.trim()) queryParams.append("search", searchQuery.trim());
        queryParams.append("is_late", "false");

        const ordersRes = await fetchWithFallback(`/api/v1/orders/?${queryParams.toString()}`);
        if (ordersRes.ok && !ignore) {
          const oData: Order[] = await ordersRes.json();
          setOrders(oData);
        }
      } catch (err) {
        console.error("Failed to load orders:", err);
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadOrdersAndMetrics();

    // Auto-poll every 5 seconds so new store manager orders show up automatically
    const interval = setInterval(loadOrdersAndMetrics, 5000);

    const onFocus = () => {
      loadOrdersAndMetrics();
    };
    const onDepotChange = () => {
      loadOrdersAndMetrics();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(DEPOT_CHANGE_EVENT, onDepotChange);

    return () => {
      ignore = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(DEPOT_CHANGE_EVENT, onDepotChange);
    };
  }, [statusFilter, brandFilter, districtFilter, searchQuery, refreshCount]);

  // Late orders (fetched separately for late drawer)
  const [lateOrders, setLateOrders] = useState<Order[]>([]);
  useEffect(() => {
    let ignore = false;

    async function loadLateOrders() {
      try {
        const res = await fetchWithFallback("/api/v1/orders/?is_late=true");
        if (res.ok && !ignore) {
          const data = await res.json();
          setLateOrders(data);
        }
      } catch (err) {
        console.error("Failed to load late orders:", err);
      }
    }

    loadLateOrders();

    return () => {
      ignore = true;
    };
  }, [refreshCount]);

  // Selected orders array
  const selectedOrders = useMemo(() => {
    return orders.filter((o) => selectedOrderIds.includes(o.id));
  }, [orders, selectedOrderIds]);

  // Selection handlers
  const handleToggleSelectOrder = (orderId: number) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const handleToggleSelectAll = (eligibleOrderIds: number[]) => {
    const isAllSelected = eligibleOrderIds.every((id) => selectedOrderIds.includes(id));
    if (isAllSelected) {
      setSelectedOrderIds((prev) => prev.filter((id) => !eligibleOrderIds.includes(id)));
    } else {
      setSelectedOrderIds((prev) => Array.from(new Set([...prev, ...eligibleOrderIds])));
    }
  };

  const handleDeferOrder = async (order: Order, reason?: string) => {
    try {
      const res = await fetchWithFallback(`/api/v1/orders/${order.id}/defer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || "Capacity limitation" }),
      });
      if (res.ok) {
        setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
        setRefreshCount((c) => c + 1);
      }
    } catch (err) {
      console.error("Failed to defer order:", err);
    }
  };

  const handleAllocationSuccess = (vehicleCode: string, count: number) => {
    setSelectedOrderIds([]);
    setSuccessBanner({ vehicleCode, count });
    setRefreshCount((c) => c + 1);
  };

  return (
    <div className="space-y-6 relative">
      {/* Allocation Success Toast matching Figma frame 30:672 */}
      {successBanner && (
        <AllocationSuccessBanner
          allocatedCount={successBanner.count}
          vehicleCode={successBanner.vehicleCode}
          onDismiss={() => setSuccessBanner(null)}
        />
      )}

      {/* 01 Header & Alerts */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#171A1F] dark:text-foreground">
            Orders
          </h1>
          <p className="text-sm text-[#6B7280] dark:text-muted-foreground mt-1">
            Manage the order queue by operating date, status, and allocation readiness.
          </p>
        </div>

        {/* Action Triggers: Refresh, Late Orders & Capacity Shortfall Warning */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRefreshCount((c) => c + 1)}
            disabled={isLoading}
            className="text-xs h-9 bg-white border-border text-[#18385F] hover:bg-slate-50 font-semibold gap-1.5 shrink-0"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          {/* Capacity Shortfall Warning matching Figma frame 229:2309 */}
          <div className="flex items-center justify-between gap-3 p-3 px-3.5 rounded-lg bg-[#FDF2F2] border border-[#FEE2E2] shadow-xs">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#DC2626] shrink-0" />
              <div className="text-xs font-semibold text-[#171A1F]">Capacity Shortfall</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCapacityShortfallOpen(true)}
              className="text-xs h-7 bg-white border-[#FEE2E2] text-[#DC2626] hover:bg-[#FDF2F2] font-semibold shrink-0"
            >
              Review Shortfall
            </Button>
          </div>

          {/* Late Orders Trigger Card matching Figma frame 148:1331 */}
          <div className="flex items-center justify-between gap-3 p-3 px-3.5 rounded-lg bg-[#FBF6EC] border border-[#EBE3D3] shadow-xs">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#A37A3B] shrink-0" />
              <div className="text-xs font-semibold text-[#171A1F]">
                4:00 PM Cutoff · {lateOrders.length} Late
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsLateOrdersOpen(true)}
              className="text-xs h-7 bg-white border-[#EBE3D3] text-[#18385F] hover:bg-[#FBF6EC] font-semibold shrink-0"
            >
              View Late Orders
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Switcher: Orders Queue vs Chain Stock Inventory */}
      <div className="flex items-center gap-2 border-b border-[#E5E5E2] pb-3">
        <button
          onClick={() => setActiveViewTab("orders")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeViewTab === "orders"
              ? "bg-[#18385F] text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Package className="size-3.5" />
          <span>Orders Queue</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
              activeViewTab === "orders" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {metrics.total_orders}
          </span>
        </button>

        <button
          onClick={() => setActiveViewTab("stocks")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeViewTab === "stocks"
              ? "bg-[#18385F] text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Layers className="size-3.5" />
          <span>Chain Cargo Catalog</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            3 Chains (Fresh · Style · Tech)
          </span>
        </button>
      </div>

      {activeViewTab === "stocks" ? (
        /* ── Stock Inventory Interface with 3-chain views, CSV import/export ── */
        <StocksView />
      ) : (
        <>
          {/* 02 Filters & Actions */}
          <OrdersFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            brandFilter={brandFilter}
            onBrandChange={setBrandFilter}
            districtFilter={districtFilter}
            onDistrictChange={setDistrictFilter}
            dateFilter={dateFilter}
            onDateChange={setDateFilter}
          />

          {/* 03 Summary Metrics Cards matching Figma 03 Summary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              title="Total Orders"
              value={metrics.total_orders}
              className="border-border bg-card"
            />
            <MetricCard
              title="Unallocated"
              value={metrics.unallocated}
              className="border-border bg-card text-[#18385F]"
            />
            <MetricCard
              title="Allocated"
              value={metrics.allocated}
              className="border-border bg-card text-[#166534]"
            />
            <MetricCard
              title="Deferred"
              value={metrics.deferred}
              className="border-border bg-card text-amber-700"
            />
          </div>

          {/* 04 Main Orders Queue Table matching Figma 04 Main Workspace */}
          <OrdersTable
            orders={orders}
            selectedOrderIds={selectedOrderIds}
            onToggleSelectOrder={handleToggleSelectOrder}
            onToggleSelectAll={handleToggleSelectAll}
            onOpenAllocation={() => setIsAllocationOpen(true)}
            onDeferOrder={handleDeferOrder}
            onViewOrder={(order) => setInspectingOrder(order)}
            isLoading={isLoading}
          />
        </>
      )}

      {/* Order Item Details Drawer */}
      <OrderDetailDrawer
        order={inspectingOrder}
        isOpen={!!inspectingOrder}
        onClose={() => setInspectingOrder(null)}
        onAllocate={(order) => {
          setSelectedOrderIds([order.id]);
          setIsAllocationOpen(true);
        }}
        onOrderUpdated={() => {
          setRefreshCount((c) => c + 1);
          setInspectingOrder(null);
        }}
      />

      {/* Quick Allocation Sheet Drawer with Constraint Review (Figma Frames 9:370 & 163:2021) */}
      <QuickAllocationDrawer
        isOpen={isAllocationOpen}
        onClose={() => setIsAllocationOpen(false)}
        selectedOrders={selectedOrders}
        onAllocationSuccess={handleAllocationSuccess}
      />

      {/* Queued Late Orders Drawer (Figma Frame 148:1331) */}
      <LateOrdersDrawer
        isOpen={isLateOrdersOpen}
        onClose={() => setIsLateOrdersOpen(false)}
        lateOrders={lateOrders}
        onOrderPromoted={() => setRefreshCount((c) => c + 1)}
      />

      {/* Capacity Shortfall Warning Modal (Figma Frame 229:2309) */}
      <CapacityShortfallModal
        isOpen={isCapacityShortfallOpen}
        onClose={() => setIsCapacityShortfallOpen(false)}
      />
    </div>
  );
}
