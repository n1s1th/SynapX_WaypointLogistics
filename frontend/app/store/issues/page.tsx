"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  X,
  Camera,
  Upload,
  ExternalLink,
  ChevronRight,
  Plus,
  FileText,
  Image as ImageIcon,
  Check,
  Building2,
  Truck,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StorePill, StorePillTone } from "@/components/store/status-pill";
import { StoreMetricCard } from "@/components/store/store-cards";
import { getStoredIssues, saveIssue, StoreIssue } from "@/services/issues-store";

export default function ExceptionsAndIssuesPage() {
  const [issues, setIssues] = useState<StoreIssue[]>([]);
  const [selectedTab, setSelectedTab] = useState<"all" | "open" | "under_review" | "resolved">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("30");
  const [selectedIssue, setSelectedIssue] = useState<StoreIssue | null>(null);

  // Report Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrderId, setNewOrderId] = useState("ORD0000001");
  const [newItemName, setNewItemName] = useState("");
  const [newItemSku, setNewItemSku] = useState("");
  const [newType, setNewType] = useState<"Damaged Goods" | "Missing Items" | "Quantity Mismatch" | "Temperature Breach">("Damaged Goods");
  const [newExpected, setNewExpected] = useState(10);
  const [newReceived, setNewReceived] = useState(8);
  const [newDescription, setNewDescription] = useState("");
  const [newPhoto, setNewPhoto] = useState<{ name: string; url: string; size: string } | null>(null);

  const loadIssues = () => {
    setIssues(getStoredIssues());
  };

  useEffect(() => {
    loadIssues();
    const handleUpdate = () => loadIssues();
    window.addEventListener("waypoint_issues_updated", handleUpdate);
    return () => window.removeEventListener("waypoint_issues_updated", handleUpdate);
  }, []);

  const openCount = issues.filter((i) => i.status === "open").length;
  const underReviewCount = issues.filter((i) => i.status === "under_review").length;
  const resolvedCount = issues.filter((i) => i.status === "resolved" || i.status === "credit_issued").length;
  const totalCount = issues.length;

  const filteredIssues = issues.filter((iss) => {
    // Tab filter
    if (selectedTab === "open" && iss.status !== "open") return false;
    if (selectedTab === "under_review" && iss.status !== "under_review") return false;
    if (selectedTab === "resolved" && iss.status !== "resolved" && iss.status !== "credit_issued") return false;

    // Type filter
    if (typeFilter !== "all" && iss.type !== typeFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = iss.id.toLowerCase().includes(q);
      const matchOrder = iss.orderId.toLowerCase().includes(q);
      const matchItem = iss.affectedItem.toLowerCase().includes(q);
      const matchType = iss.type.toLowerCase().includes(q);
      if (!matchId && !matchOrder && !matchItem && !matchType) return false;
    }

    return true;
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewPhoto({
        name: file.name,
        url: URL.createObjectURL(file),
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB • Captured today`,
      });
    }
  };

  const handleCreateIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDescription.trim()) return;

    const created = saveIssue({
      orderId: newOrderId,
      type: newType,
      title: `${newType}: ${newItemName || "Order Discrepancy"}`,
      affectedItem: newItemName || "Consignment Item",
      sku: newItemSku || "SKU-GEN",
      expectedUnits: newExpected,
      receivedUnits: newReceived,
      description: newDescription,
      photoUrl: newPhoto?.url,
      photoName: newPhoto?.name,
      photoSize: newPhoto?.size,
      driverName: "Marcus Vance",
      vehicleId: "VEH001",
    });

    loadIssues();
    setSelectedIssue(created);
    setShowCreateModal(false);
    setNewDescription("");
    setNewPhoto(null);
  };

  const getStatusTone = (status: StoreIssue["status"]): StorePillTone => {
    switch (status) {
      case "open":
        return "warning";
      case "under_review":
        return "info";
      case "resolved":
      case "credit_issued":
        return "success";
      default:
        return "neutral";
    }
  };

  const getStatusLabel = (status: StoreIssue["status"]) => {
    switch (status) {
      case "open":
        return "Open";
      case "under_review":
        return "Under Review";
      case "resolved":
        return "Resolved";
      case "credit_issued":
        return "Credit Issued";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header (Figma 16:608 & 16:821) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
            Exceptions &amp; Issues
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Track delivery discrepancies, short shipments, damage claims, and credit notes.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="bg-primary text-primary-foreground font-bold hover:bg-primary/90 gap-1.5 shadow-xs"
        >
          <Plus className="size-4" />
          <span>Report New Issue</span>
        </Button>
      </div>

      {/* 4 Metric Cards (Figma 16:828) */}
      <section aria-label="Exceptions Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StoreMetricCard
          label="Total Issues"
          value={String(totalCount)}
          caption="All recorded discrepancies"
          mobileCaption="17 total"
        />
        <StoreMetricCard
          label="Open"
          value={String(openCount)}
          caption="Requires store or dispatch action"
          mobileCaption="1 open"
        />
        <StoreMetricCard
          label="Under Review"
          value={String(underReviewCount)}
          caption="Investigating with central dispatch"
          mobileCaption="2 in review"
        />
        <StoreMetricCard
          label="Resolved"
          value={String(resolvedCount)}
          caption="Credits issued or reconciled"
          mobileCaption="14 closed"
        />
      </section>

      {/* Issues Main Card with Tabs, Filters & Table (Figma 16:833) */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {/* Tabs Row (Figma 16:834) */}
        <div className="flex items-center border-b border-border/80 px-4 pt-3 gap-1 overflow-x-auto">
          {[
            { key: "all", label: `All (${totalCount})` },
            { key: "open", label: `Open (${openCount})` },
            { key: "under_review", label: `Under Review (${underReviewCount})` },
            { key: "resolved", label: `Resolved (${resolvedCount})` },
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

        {/* Filter Bar (Figma 16:843) */}
        <div className="p-4 border-b border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search issue or order ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9 bg-background"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs p-2 rounded-lg border border-border bg-background focus:outline-none"
            >
              <option value="all">Issue type: All</option>
              <option value="Damaged Goods">Damaged Goods</option>
              <option value="Missing Items">Missing Items</option>
              <option value="Quantity Mismatch">Quantity Mismatch</option>
              <option value="Temperature Breach">Temperature Breach</option>
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="text-xs p-2 rounded-lg border border-border bg-background focus:outline-none"
            >
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        {/* Issues Table (Figma 16:857) */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <tr>
                <th className="py-3 px-4">ISSUE ID</th>
                <th className="py-3 px-4">ORDER ID</th>
                <th className="py-3 px-4">ISSUE TYPE</th>
                <th className="py-3 px-4">AFFECTED ITEMS</th>
                <th className="py-3 px-4">REPORTED</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No exceptions or issues match your criteria.
                  </td>
                </tr>
              ) : (
                filteredIssues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => setSelectedIssue(issue)}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-foreground">
                      {issue.id}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-primary">
                      {issue.orderId}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-foreground">
                      {issue.type}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-foreground">{issue.affectedItem}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {issue.receivedUnits < issue.expectedUnits
                          ? `${issue.expectedUnits - issue.receivedUnits} units short`
                          : issue.type === "Damaged Goods"
                          ? "Damaged packaging reported"
                          : `${issue.receivedUnits} units counted`}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-foreground">{issue.reportedAt}</div>
                      <div className="text-[11px] text-muted-foreground">{issue.reportedBy}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <StorePill tone={getStatusTone(issue.status)}>
                        {getStatusLabel(issue.status)}
                      </StorePill>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIssue(issue);
                        }}
                        className="text-primary hover:text-primary hover:bg-secondary font-semibold text-xs"
                      >
                        View Details
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side Panel / Issue Details Drawer (Figma 16:816 & 16:939) */}
      {selectedIssue && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-card h-full shadow-2xl border-l border-border flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200">
            {/* Panel Header */}
            <div className="p-6 border-b border-border space-y-2 sticky top-0 bg-card/95 backdrop-blur-md z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg font-bold text-foreground">
                    Issue {selectedIssue.id}
                  </span>
                  <StorePill tone={getStatusTone(selectedIssue.status)}>
                    {getStatusLabel(selectedIssue.status)}
                  </StorePill>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIssue(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedIssue.type} &bull; Reported {selectedIssue.reportedAt}
              </p>
            </div>

            {/* Panel Body (Figma 16:949) */}
            <div className="p-6 space-y-5 text-xs flex-1">
              {/* Issue Information (Figma 16:951) */}
              <div className="space-y-3 p-4 rounded-lg bg-muted/40 border border-border/60">
                <div className="font-bold text-foreground uppercase tracking-wider text-[11px]">
                  Issue Information
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-muted-foreground text-[11px]">Issue type</span>
                    <div className="font-semibold text-foreground">{selectedIssue.type}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[11px]">Reported by</span>
                    <div className="font-semibold text-foreground">{selectedIssue.reportedBy}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[11px]">Linked Order</span>
                    <div>
                      <Link
                        href={`/store/deliveries/${selectedIssue.orderId}`}
                        className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <span>{selectedIssue.orderId}</span>
                        <ExternalLink className="size-3" />
                      </Link>
                    </div>
                  </div>
                  {selectedIssue.vehicleId && (
                    <div>
                      <span className="text-muted-foreground text-[11px]">Vehicle / Driver</span>
                      <div className="font-semibold text-foreground">
                        {selectedIssue.vehicleId} ({selectedIssue.driverName})
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Affected Item Section (Figma 16:970) */}
              <div className="space-y-3 p-4 rounded-lg border border-border bg-background">
                <div className="font-bold text-foreground uppercase tracking-wider text-[11px] flex items-center justify-between">
                  <span>Affected Item</span>
                  <span className="font-mono text-muted-foreground font-normal">{selectedIssue.sku}</span>
                </div>
                <div className="text-sm font-bold text-foreground">
                  {selectedIssue.affectedItem}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                  <div className="p-2.5 rounded bg-muted/40">
                    <span className="text-muted-foreground text-[10px] uppercase font-bold">Expected</span>
                    <div className="font-bold text-sm text-foreground">{selectedIssue.expectedUnits} units</div>
                  </div>
                  <div className="p-2.5 rounded bg-muted/40">
                    <span className="text-muted-foreground text-[10px] uppercase font-bold">Received</span>
                    <div className="font-bold text-sm text-foreground">
                      {selectedIssue.receivedUnits} units
                      {selectedIssue.receivedUnits < selectedIssue.expectedUnits && (
                        <span className="text-warning text-xs font-normal ml-1">
                          ({selectedIssue.expectedUnits - selectedIssue.receivedUnits} short)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <span className="text-muted-foreground text-[11px] font-bold">Description / Defect Note</span>
                  <p className="text-foreground text-xs leading-relaxed bg-muted/20 p-2.5 rounded border border-border/40">
                    {selectedIssue.description}
                  </p>
                </div>
              </div>

              {/* Photo Evidence Section (Figma 16:990) */}
              <div className="space-y-2 p-4 rounded-lg border border-border bg-background">
                <div className="font-bold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <ImageIcon className="size-3.5 text-primary" />
                  <span>Photo Evidence</span>
                </div>

                {selectedIssue.photoUrl ? (
                  <div className="space-y-2">
                    <div className="rounded-lg overflow-hidden border border-border bg-muted/30 aspect-video flex items-center justify-center">
                      <img
                        src={selectedIssue.photoUrl}
                        alt="Photo Evidence"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-mono">{selectedIssue.photoName || "evidence_photo.jpg"}</span>
                      <span>{selectedIssue.photoSize || "2.4 MB • Captured during intake"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-border text-center space-y-1 text-muted-foreground">
                    <ImageIcon className="size-6 mx-auto text-muted-foreground/60" />
                    <p className="text-xs font-medium">No photo attachment registered for this issue</p>
                  </div>
                )}
              </div>

              {/* Status Workflow Tracker (Figma 16:1000) */}
              <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border/60">
                <div className="font-bold text-foreground uppercase tracking-wider text-[11px]">
                  Resolution Workflow
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
                  <div className="p-2 rounded bg-success-muted border border-success/30 space-y-0.5">
                    <div className="w-4 h-4 rounded-full bg-success text-success-foreground mx-auto flex items-center justify-center text-[10px] font-bold">
                      ✓
                    </div>
                    <div className="font-bold text-success-muted-foreground">Reported</div>
                  </div>

                  <div
                    className={`p-2 rounded border space-y-0.5 ${
                      selectedIssue.status === "under_review"
                        ? "bg-warning-muted border-warning/40 text-warning-muted-foreground font-bold"
                        : selectedIssue.status === "resolved" || selectedIssue.status === "credit_issued"
                        ? "bg-success-muted border-success/30 text-success-muted-foreground"
                        : "bg-muted/40 border-border/50 text-muted-foreground"
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-muted text-muted-foreground mx-auto flex items-center justify-center text-[10px] font-bold">
                      2
                    </div>
                    <div>Under Review</div>
                  </div>

                  <div
                    className={`p-2 rounded border space-y-0.5 ${
                      selectedIssue.status === "resolved" || selectedIssue.status === "credit_issued"
                        ? "bg-success-muted border-success/30 text-success-muted-foreground font-bold"
                        : "bg-muted/40 border-border/50 text-muted-foreground"
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-muted text-muted-foreground mx-auto flex items-center justify-center text-[10px] font-bold">
                      3
                    </div>
                    <div>Resolved</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel Footer (Figma 16:1010) */}
            <div className="p-4 border-t border-border bg-card/95 flex items-center justify-end gap-2 sticky bottom-0">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedIssue(null)}>
                Close
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-primary text-primary-foreground font-bold hover:bg-primary/90 gap-1.5"
                onClick={() => {
                  alert(`Credit Note Request #REQ-${selectedIssue.id} submitted to Central Dispatch.`);
                }}
              >
                <Download className="size-3.5" />
                <span>Request Credit Note</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manual "Report New Issue" Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-card border border-border rounded-xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-warning" />
                <h3 className="text-base font-bold text-foreground">Report Delivery Discrepancy</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleCreateIssue} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Order ID *</label>
                  <Input
                    required
                    value={newOrderId}
                    onChange={(e) => setNewOrderId(e.target.value)}
                    placeholder="e.g. ORD0000001"
                    className="text-xs h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Issue Classification *</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as any)}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-background focus:outline-none h-9"
                  >
                    <option value="Damaged Goods">Damaged Goods</option>
                    <option value="Missing Items">Missing Items</option>
                    <option value="Quantity Mismatch">Quantity Mismatch</option>
                    <option value="Temperature Breach">Temperature Breach</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Affected Item Name</label>
                  <Input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="e.g. Fresh Whole Milk 1L"
                    className="text-xs h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Item SKU</label>
                  <Input
                    value={newItemSku}
                    onChange={(e) => setNewItemSku(e.target.value)}
                    placeholder="e.g. SKU-99201"
                    className="text-xs h-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Expected Units</label>
                  <Input
                    type="number"
                    min="1"
                    value={newExpected}
                    onChange={(e) => setNewExpected(parseInt(e.target.value, 10) || 0)}
                    className="text-xs h-9"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-muted-foreground">Received Units</label>
                  <Input
                    type="number"
                    min="0"
                    value={newReceived}
                    onChange={(e) => setNewReceived(parseInt(e.target.value, 10) || 0)}
                    className="text-xs h-9"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-muted-foreground">Issue Description / Defect Details *</label>
                <textarea
                  rows={3}
                  required
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Describe the discrepancy, crushed packaging, or missing count..."
                  className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-none resize-none"
                />
              </div>

              {/* Photo Evidence Upload */}
              <div className="space-y-1">
                <label className="font-bold text-muted-foreground flex items-center justify-between">
                  <span>Attach Photo Evidence</span>
                  <span className="text-[10px] text-muted-foreground">Recommended for credit claims</span>
                </label>
                {newPhoto ? (
                  <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/40">
                    <div className="flex items-center gap-2">
                      <img src={newPhoto.url} alt="Uploaded preview" className="w-10 h-10 object-cover rounded border" />
                      <div>
                        <div className="font-semibold text-foreground">{newPhoto.name}</div>
                        <div className="text-[10px] text-muted-foreground">{newPhoto.size}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewPhoto(null)}
                      className="p-1 text-destructive hover:bg-destructive-muted rounded"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border hover:border-primary/60 bg-muted/20 cursor-pointer">
                    <Camera className="size-4 text-primary" />
                    <span className="font-semibold text-foreground">Upload Photo Evidence</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!newDescription.trim()}
                  className="bg-primary text-primary-foreground font-bold hover:bg-primary/90"
                >
                  Submit Issue Report
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
