"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Package,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { TableLoading } from "@/components/ui/table-loading";
import { Input } from "@/components/ui/input";
import { StoreMetricCard } from "@/components/store/store-cards";
import { StorePill, StorePillTone } from "@/components/store/status-pill";
import { getStoreOrders } from "@/components/store/api/store-data";
import { StoreOrder, StoreOrderItem } from "@/components/store/mock-data";

interface ShortfallRecord {
  id: string;
  orderNumber: string;
  sku: string;
  itemName: string;
  category: string;
  requestedQty: number;
  sentQty: number;
  shortfallQty: number;
  unitLabel: string;
  orderDate: string;
  status: "back_ordered" | "short_delivered" | "under_review" | "restocked";
  restockEta: string;
  dispatcherNote?: string;
}

export default function ShortfallsAndBackordersPage() {
  const [shortfalls, setShortfalls] = useState<ShortfallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<"all" | "back_ordered" | "short_delivered" | "under_review">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadShortfallData() {
      setLoading(true);
      try {
        const orders = await getStoreOrders();
        const records: ShortfallRecord[] = [];

        orders.forEach((ord: StoreOrder) => {
          // Lines the depot sent short (order_items.quantity_sent, set by the Dispatcher or Loader).
          const shortLines = ord.items.filter(
            (item: StoreOrderItem) => item.quantitySent !== undefined && item.quantitySent < item.quantity
          );
          shortLines.forEach((item: StoreOrderItem, idx: number) => {
            const sent = item.quantitySent ?? 0;
            records.push({
              id: `${ord.orderNumber}-${item.sku}-${idx}`,
              orderNumber: ord.orderNumber,
              sku: item.sku,
              itemName: item.itemName,
              category: item.category,
              requestedQty: item.quantity,
              sentQty: sent,
              shortfallQty: item.quantity - sent,
              unitLabel: item.unitLabel,
              orderDate: ord.orderDate,
              status: ord.shortfall?.state === "under_review" ? "under_review" : sent === 0 ? "back_ordered" : "short_delivered",
              restockEta: "Not scheduled yet",
              dispatcherNote: item.depotNote ?? ord.deferralReason,
            });
          });
          // The loader flags shortfalls per order, not per item: show those as one order-level row.
          if (shortLines.length === 0 && ord.shortfall) {
            const requested = ord.items.reduce((sum, item) => sum + item.quantity, 0);
            const short = ord.shortfall.unitsShort;
            records.push({
              id: `${ord.orderNumber}-order`,
              orderNumber: ord.orderNumber,
              sku: "",
              itemName: "Whole order (the depot flagged it as short)",
              category: "",
              requestedQty: ord.shortfall.unitsTotal ?? requested,
              sentQty: short !== undefined ? (ord.shortfall.unitsTotal ?? requested) - short : 0,
              shortfallQty: short ?? 0,
              unitLabel: "units",
              orderDate: ord.orderDate,
              status: ord.shortfall.state === "under_review" ? "under_review" : "short_delivered",
              restockEta: "Not scheduled yet",
              dispatcherNote: ord.deferralReason,
            });
          }
        });

        setShortfalls(records);
      } catch {
        // Fallback handled
      } finally {
        setLoading(false);
      }
    }

    loadShortfallData();
  }, []);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const totalShortfalls = shortfalls.length;
  const backOrderedCount = shortfalls.filter((s) => s.status === "back_ordered").length;
  const shortDeliveredCount = shortfalls.filter((s) => s.status === "short_delivered").length;
  const underReviewCount = shortfalls.filter((s) => s.status === "under_review").length;
  const totalUnitsShort = shortfalls.reduce((sum, s) => sum + s.shortfallQty, 0);

  const filtered = shortfalls.filter((s) => {
    if (selectedTab !== "all" && s.status !== selectedTab) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        s.orderNumber.toLowerCase().includes(q) ||
        s.itemName.toLowerCase().includes(q) ||
        s.sku.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginatedShortfalls = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getStatusTone = (status: ShortfallRecord["status"]): StorePillTone => {
    switch (status) {
      case "back_ordered":
        return "brand";
      case "short_delivered":
        return "warning";
      case "under_review":
        return "info";
      case "restocked":
        return "success";
      default:
        return "neutral";
    }
  };

  const getStatusLabel = (status: ShortfallRecord["status"]) => {
    switch (status) {
      case "back_ordered":
        return "Back-ordered";
      case "short_delivered":
        return "Short Delivered";
      case "under_review":
        return "Under Review";
      case "restocked":
        return "Restocked";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col gap-2">
        <Breadcrumb>
          <BreadcrumbList className="text-base">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/store/requests">Goods Requests</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-primary">Shortfalls &amp; Back-orders</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-1">
          <div>
            <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
              Shortfalls &amp; Back-orders
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Track items not sent or received in full, monitor central depot back-orders, and review automated restock ETAs.
            </p>
          </div>

          <Button asChild className="bg-primary text-primary-foreground font-bold hover:bg-primary/90 gap-1.5 self-start sm:self-auto">
            <Link href="/store/requests/new">
              <ShoppingCart className="size-4" />
              <span>Create New Request</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <section aria-label="Shortfalls Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StoreMetricCard
          label="Total Shortfall Items"
          value={String(totalShortfalls)}
          caption="Items with partial or zero delivery"
          mobileCaption={`${totalShortfalls} items`}
        />
        <StoreMetricCard
          label="Active Back-orders"
          value={String(backOrderedCount)}
          caption="Queued for automated next delivery"
          mobileCaption={`${backOrderedCount} back-ordered`}
        />
        <StoreMetricCard
          label="Total Units Short"
          value={String(totalUnitsShort)}
          caption="Units unfulfilled across requests"
          mobileCaption={`${totalUnitsShort} units`}
        />
        <StoreMetricCard
          label="Under Depot Review"
          value={String(underReviewCount)}
          caption="Pending picking or allocation check"
          mobileCaption={`${underReviewCount} in review`}
        />
      </section>

      {/* Main Table Card */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {/* Tabs Row */}
        <div className="flex items-center border-b border-border/80 px-4 pt-3 gap-1 overflow-x-auto">
          {([
            { key: "all", label: `All (${totalShortfalls})` },
            { key: "back_ordered", label: `Back-ordered (${backOrderedCount})` },
            { key: "short_delivered", label: `Short Delivered (${shortDeliveredCount})` },
            { key: "under_review", label: `Under Review (${underReviewCount})` },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedTab(tab.key)}
              className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                selectedTab === tab.key
                  ? "border-primary text-primary font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="p-4 border-b border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search SKU, item, or request #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9 bg-background"
            />
          </div>
          <span className="text-xs text-muted-foreground self-start sm:self-auto">
            Showing {filtered.length} of {shortfalls.length} records
          </span>
        </div>

        {/* Shortfalls Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <tr>
                <th className="py-3 px-4">ITEM / SKU</th>
                <th className="py-3 px-4">GOODS REQUEST</th>
                <th className="py-3 px-4">REQUESTED</th>
                <th className="py-3 px-4">SENT</th>
                <th className="py-3 px-4">SHORTFALL</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4">RESTOCK ETA</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    <TableLoading label="Loading shortfall records..." />
                  </td>
                </tr>
              ) : paginatedShortfalls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    No shortfall or back-order records found.
                  </td>
                </tr>
              ) : (
                paginatedShortfalls.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-foreground">{item.itemName}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{item.sku} &bull; {item.category}</div>
                      {item.dispatcherNote && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 italic">
                          Note: {item.dispatcherNote}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <Link
                        href={`/store/requests/${item.orderNumber}`}
                        className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <span>{item.orderNumber}</span>
                        <ExternalLink className="size-3" />
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-foreground">
                      {item.requestedQty} {item.unitLabel}
                    </td>
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {item.sentQty} {item.unitLabel}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-destructive">
                      −{item.shortfallQty} {item.unitLabel}
                    </td>
                    <td className="py-3.5 px-4">
                      <StorePill tone={getStatusTone(item.status)}>
                        {getStatusLabel(item.status)}
                      </StorePill>
                    </td>
                    <td className="py-3.5 px-4 text-foreground">
                      <div className="font-medium">{item.restockEta}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-1">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary hover:bg-secondary font-semibold text-xs"
                      >
                        <Link href={`/store/issues/new?order=${item.orderNumber}`}>
                          <span>Report</span>
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="text-xs font-semibold"
                      >
                        <Link href={`/store/requests/${item.orderNumber}`}>
                          <span>View</span>
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filtered.length > 0 && (
          <div className="p-3.5 border-t border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">
              Showing {(currentPage - 1) * pageSize + 1} &ndash;{" "}
              {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} records
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 text-xs font-semibold"
              >
                Previous
              </Button>
              <span className="px-2 text-xs font-medium text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="h-8 text-xs font-semibold"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
