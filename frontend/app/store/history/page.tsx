"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Truck,
  Building2,
  Calendar,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StorePill } from "@/components/store/status-pill";
import { StoreMetricCard } from "@/components/store/store-cards";

interface HistoryRecord {
  orderId: string;
  deliveryDate: string;
  arrivalInfo: string;
  vehicleId: string;
  vehicleType: string;
  driverName: string;
  itemCount: number;
  unitCount: number;
  outcomeType: "clean" | "issue_resolved" | "issue_under_review";
  outcomeTitle: string;
  outcomeDetail: string;
  status: "completed" | "archived";
}

const mockHistoryRecords: HistoryRecord[] = [
  {
    orderId: "ORD0000001",
    deliveryDate: "Today, 26 Sep 2026",
    arrivalInfo: "Arrived 06:08 • Rear dock",
    vehicleId: "VEH001",
    vehicleType: "Truck • Reefer",
    driverName: "Marcus Vance",
    itemCount: 3,
    unitCount: 33,
    outcomeType: "issue_under_review",
    outcomeTitle: "1 issue • under review",
    outcomeDetail: "ISS0000001 • 2 boxes crushed",
    status: "completed",
  },
  {
    orderId: "ORD0000005",
    deliveryDate: "23 Sep 2026",
    arrivalInfo: "Arrived 04:50 • Rear dock",
    vehicleId: "VEH037",
    vehicleType: "Van • Ambient",
    driverName: "Elena Ramos",
    itemCount: 6,
    unitCount: 28,
    outcomeType: "issue_resolved",
    outcomeTitle: "1 issue • resolved",
    outcomeDetail: "ISS0000003 • 1 case over",
    status: "completed",
  },
  {
    orderId: "ORD0000006",
    deliveryDate: "19 Sep 2026",
    arrivalInfo: "Arrived 05:10 • Rear dock",
    vehicleId: "VEH009",
    vehicleType: "Truck • Ambient",
    driverName: "Marcus Vance",
    itemCount: 12,
    unitCount: 75,
    outcomeType: "issue_under_review",
    outcomeTitle: "1 issue • under review",
    outcomeDetail: "ISS0000002 • 2 cases short",
    status: "completed",
  },
  {
    orderId: "ORD0000007",
    deliveryDate: "15 Sep 2026",
    arrivalInfo: "Arrived 04:20 • Rear dock",
    vehicleId: "VEH036",
    vehicleType: "Van • Reefer",
    driverName: "Elena Ramos",
    itemCount: 4,
    unitCount: 22,
    outcomeType: "clean",
    outcomeTitle: "Clean delivery",
    outcomeDetail: "Verified in full • zero defects",
    status: "completed",
  },
  {
    orderId: "ORD0000008",
    deliveryDate: "12 Sep 2026",
    arrivalInfo: "Arrived 04:35 • Rear dock",
    vehicleId: "VEH004",
    vehicleType: "Truck • Reefer",
    driverName: "Saman Kumara",
    itemCount: 8,
    unitCount: 45,
    outcomeType: "clean",
    outcomeTitle: "Clean delivery",
    outcomeDetail: "Verified in full • cold chain OK",
    status: "completed",
  },
];

export default function DeliveryHistoryPage() {
  const [selectedTab, setSelectedTab] = useState<"all" | "clean" | "issues">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("30");
  const [issuesFilter, setIssuesFilter] = useState("all");

  const totalCount = 28;
  const cleanCount = 25;
  const issuesCount = 3;

  const filtered = mockHistoryRecords.filter((rec) => {
    if (selectedTab === "clean" && rec.outcomeType !== "clean") return false;
    if (selectedTab === "issues" && rec.outcomeType === "clean") return false;

    if (issuesFilter === "clean" && rec.outcomeType !== "clean") return false;
    if (issuesFilter === "with_issues" && rec.outcomeType === "clean") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchOrder = rec.orderId.toLowerCase().includes(q);
      const matchDriver = rec.driverName.toLowerCase().includes(q);
      const matchVehicle = rec.vehicleId.toLowerCase().includes(q);
      if (!matchOrder && !matchDriver && !matchVehicle) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header (Figma 18:861) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
            Delivery History
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Completed deliveries, their linked orders, and receiving outcome records.
          </p>
        </div>
      </div>

      {/* 4 Metric Cards (Figma 18:867) */}
      <section aria-label="History Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StoreMetricCard
          label="Total Deliveries"
          value="28"
          caption="Completed this month"
          mobileCaption="28 total"
        />
        <StoreMetricCard
          label="Clean Deliveries"
          value="25"
          caption="Accepted without discrepancy"
          mobileCaption="25 clean"
        />
        <StoreMetricCard
          label="With Issues"
          value="3"
          caption="Discrepancies recorded"
          mobileCaption="3 issues"
        />
        <StoreMetricCard
          label="On-Time Arrival"
          value="96%"
          caption="Within scheduled window"
          mobileCaption="96% on-time"
        />
      </section>

      {/* History Table Container (Figma 18:884) */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {/* Tabs (Figma 18:885) */}
        <div className="flex items-center border-b border-border/80 px-4 pt-3 gap-1 overflow-x-auto">
          {[
            { key: "all", label: `All (${totalCount})` },
            { key: "clean", label: `Clean (${cleanCount})` },
            { key: "issues", label: `With Issues (${issuesCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedTab(tab.key as any)}
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

        {/* Filter Bar (Figma 18:892) */}
        <div className="p-4 border-b border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search order ID or driver..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9 bg-background"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="text-xs p-2 rounded-lg border border-border bg-background focus:outline-none"
            >
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="all">All time</option>
            </select>

            <select
              value={issuesFilter}
              onChange={(e) => setIssuesFilter(e.target.value)}
              className="text-xs p-2 rounded-lg border border-border bg-background focus:outline-none"
            >
              <option value="all">Issues: All</option>
              <option value="clean">Clean only</option>
              <option value="with_issues">With issues only</option>
            </select>
          </div>
        </div>

        {/* Table (Figma 50:1777) */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <tr>
                <th className="py-3 px-4">ORDER ID</th>
                <th className="py-3 px-4">DATE &amp; TIME</th>
                <th className="py-3 px-4">VEHICLE &amp; DRIVER</th>
                <th className="py-3 px-4">ITEMS</th>
                <th className="py-3 px-4">RECEIVING OUTCOME</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((row) => (
                <tr key={row.orderId} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-foreground">
                    {row.orderId}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-foreground">{row.deliveryDate}</div>
                    <div className="text-[11px] text-muted-foreground">{row.arrivalInfo}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-foreground">
                      {row.vehicleId} &bull; {row.vehicleType}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{row.driverName}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-foreground">{row.itemCount} items</div>
                    <div className="text-[11px] text-muted-foreground">{row.unitCount} units</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div
                      className={`font-semibold ${
                        row.outcomeType === "clean"
                          ? "text-success"
                          : row.outcomeType === "issue_resolved"
                          ? "text-foreground"
                          : "text-warning"
                      }`}
                    >
                      {row.outcomeTitle}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{row.outcomeDetail}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <StorePill tone="success">Completed</StorePill>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary hover:bg-secondary font-semibold text-xs"
                    >
                      <Link href={`/store/deliveries/${row.orderId}`}>
                        <span>View</span>
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
