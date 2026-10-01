"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Package,
  ThermometerSnowflake,
  ShieldCheck,
  Minus,
  Plus,
  RefreshCw,
  WifiOff,
  Camera,
  Trash2,
  MapPin,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StorePill } from "@/components/store/status-pill";
import { submitDeliveryReceipt, ReceiptCreatePayload } from "@/services/api";
import { saveIssue } from "@/services/issues-store";
import { mockOrders, StoreOrder } from "@/components/store/mock-data";

interface ItemState {
  id: string;
  sku: string;
  name: string;
  category: string;
  sentUnits: number;
  receivedUnits: number;
  condition: "good" | "damaged" | "missing" | "incorrect";
  issueNote: string;
  photoUrl?: string;
  photoName?: string;
  photoSize?: string;
}

export default function DeliveryDetailsAndReceivingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const resolvedParams = use(params);
  const rawOrderId = resolvedParams.orderId || "ORD0000001";
  const router = useRouter();

  // Find matching order in mock data or construct intelligent defaults
  const matchedOrder = mockOrders.find(
    (o) => o.orderNumber.toLowerCase() === rawOrderId.toLowerCase()
  );

  const orderNumber = matchedOrder?.orderNumber || rawOrderId;
  const vehicleId = matchedOrder?.vehicleCode || matchedOrder?.vehicle?.code || "VEH001";
  const driverName = matchedOrder?.vehicle?.driverName || "Marcus Vance";
  const driverPhone = "(555) 0192-44";
  const vehicleSpecs = matchedOrder?.vehicle?.description || "Truck • Reefer • 5,510 kg • 26.4 m³";
  const homeDepot = matchedOrder?.vehicle?.origin || "Peliyagoda Depot";
  const bolNumber = matchedOrder?.vehicle?.manifestNumber ? `BOL-2026-${matchedOrder.vehicle.manifestNumber}` : "BOL-2026-0926";
  const sealNumber = `SL-${Math.floor(100000 + Math.random() * 900000)}`;
  const tempReading = matchedOrder?.temperatureClass === "chilled" ? "+3.6°C" : "Ambient";
  const tempLimit = matchedOrder?.temperatureClass === "chilled" ? "< +4.0°C (Chilled Cold Chain)" : "Ambient (< 25.0°C)";
  const deliveryWindow = "Today, 04:00 – 07:45";
  const actualArrival = "Today, 06:08 (Within delivery window)";

  // Initialize line items
  const initialItems: ItemState[] = matchedOrder?.items && matchedOrder.items.length > 0
    ? matchedOrder.items.map((it, idx) => ({
        id: `item-${idx + 1}`,
        sku: it.sku,
        name: it.itemName,
        category: it.category,
        sentUnits: it.quantitySent ?? it.quantity,
        receivedUnits: it.quantitySent ?? it.quantity,
        condition: "good" as const,
        issueNote: "",
      }))
    : [
        {
          id: "item-1",
          sku: "SKU-001",
          name: "Bottled Water 500ml",
          category: "Beverages",
          sentUnits: 20,
          receivedUnits: 20,
          condition: "good" as const,
          issueNote: "",
        },
        {
          id: "item-2",
          sku: "SKU-014",
          name: "Soft Drinks 1L (12pk)",
          category: "Beverages",
          sentUnits: 8,
          receivedUnits: 8,
          condition: "good" as const,
          issueNote: "",
        },
        {
          id: "item-3",
          sku: "SKU-032",
          name: "Paper Cups 8oz (500ct)",
          category: "Packaging & Consumables",
          sentUnits: 5,
          receivedUnits: 5,
          condition: "good" as const,
          issueNote: "",
        },
      ];

  const [items, setItems] = useState<ItemState[]>(initialItems);
  const [sealVerified, setSealVerified] = useState(true);
  const [tempVerified, setTempVerified] = useState(true);
  const [generalRemarks, setGeneralRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("temp_breach");
  const [rejectNotes, setRejectNotes] = useState("");
  const [rejectPhoto, setRejectPhoto] = useState<{ name: string; url: string; size: string } | null>(null);

  const [statusFeedback, setStatusFeedback] = useState<{
    success: boolean;
    isOffline?: boolean;
    message?: string;
  } | null>(null);

  const totalSent = items.reduce((acc, it) => acc + it.sentUnits, 0);
  const totalReceived = items.reduce((acc, it) => acc + it.receivedUnits, 0);
  const damagedCount = items.filter((it) => it.condition === "damaged").length;
  const missingCount = items.filter((it) => it.condition === "missing" || it.receivedUnits < it.sentUnits).length;
  const incorrectCount = items.filter((it) => it.condition === "incorrect").length;
  const hasItemIssues = damagedCount > 0 || missingCount > 0 || incorrectCount > 0 || !sealVerified || !tempVerified;

  const handleUpdateUnits = (id: string, delta: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const newUnits = Math.max(0, item.receivedUnits + delta);
        let newCond = item.condition;
        if (newUnits < item.sentUnits && item.condition === "good") {
          newCond = "missing";
        } else if (newUnits === item.sentUnits && item.condition === "missing") {
          newCond = "good";
        }
        return { ...item, receivedUnits: newUnits, condition: newCond };
      })
    );
  };

  const handleSetCondition = (id: string, cond: "good" | "damaged" | "missing" | "incorrect") => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, condition: cond };
      })
    );
  };

  const handleUpdateIssueNote = (id: string, note: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, issueNote: note } : item))
    );
  };

  const handlePhotoUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const sizeStr = `${(file.size / (1024 * 1024)).toFixed(1)} MB • Captured today`;
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, photoUrl: url, photoName: file.name, photoSize: sizeStr }
            : item
        )
      );
    }
  };

  const handleRemovePhoto = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, photoUrl: undefined, photoName: undefined, photoSize: undefined }
          : item
      )
    );
  };

  const handleRejectPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRejectPhoto({
        name: file.name,
        url: URL.createObjectURL(file),
        size: `${(file.size / (1024 * 1024)).toFixed(1)} MB • Captured today`,
      });
    }
  };

  const handleConfirmReceipt = async () => {
    setIsSubmitting(true);

    // Save each flagged item issue to the issues repository
    items.forEach((item) => {
      if (item.condition !== "good" || item.receivedUnits !== item.sentUnits) {
        let issueType: "Damaged Goods" | "Missing Items" | "Quantity Mismatch" = "Damaged Goods";
        if (item.condition === "missing" || item.receivedUnits < item.sentUnits) {
          issueType = "Missing Items";
        } else if (item.condition === "incorrect" || item.receivedUnits > item.sentUnits) {
          issueType = "Quantity Mismatch";
        }

        saveIssue({
          orderId: orderNumber,
          type: issueType,
          title: `${item.name} (${item.sku}) - ${item.condition.toUpperCase()}`,
          affectedItem: item.name,
          sku: item.sku,
          expectedUnits: item.sentUnits,
          receivedUnits: item.receivedUnits,
          description:
            item.issueNote.trim() ||
            `${item.condition === "damaged" ? "Damaged goods reported during dock intake." : "Short delivery / discrepancy identified."} Sent ${item.sentUnits}, received ${item.receivedUnits}.`,
          photoUrl: item.photoUrl,
          photoName: item.photoName,
          photoSize: item.photoSize,
          driverName: driverName,
          vehicleId: vehicleId,
        });
      }
    });

    const payload: ReceiptCreatePayload = {
      order_id: "a1b2c3d4-0000-0000-0000-000000000001",
      outlet_id: "OUT005",
      units_received: totalReceived,
      weight_received_kg: 80.0,
      has_issues: hasItemIssues,
      issue_type: hasItemIssues ? (damagedCount > 0 ? "damaged" : "short_delivery") : undefined,
      issue_description: hasItemIssues
        ? generalRemarks || `Received ${totalReceived} of ${totalSent} units with discrepancies.`
        : undefined,
      confirmed_at: new Date().toISOString(),
    };

    try {
      const { isOffline } = await submitDeliveryReceipt(payload);
      if (isOffline) {
        setStatusFeedback({
          success: true,
          isOffline: true,
          message: "You are offline. Delivery receipt and logged issues have been cached locally and will sync when online.",
        });
      } else {
        setStatusFeedback({
          success: true,
          isOffline: false,
          message: hasItemIssues
            ? "Receipt confirmed with discrepancy report filed to dispatch & logged under Exceptions."
            : "Receipt confirmed successfully. Goods accepted into store inventory.",
        });
      }
      setTimeout(() => {
        router.push("/store/deliveries");
      }, 2400);
    } catch {
      setStatusFeedback({
        success: true,
        isOffline: true,
        message: "Receipt and logged issues saved to offline cache.",
      });
      setTimeout(() => {
        router.push("/store/deliveries");
      }, 2400);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    saveIssue({
      orderId: orderNumber,
      type: rejectReason === "temp_breach" ? "Temperature Breach" : "Wrong Consignment",
      title: `CONSIGNMENT REJECTED: ${rejectReason.replace("_", " ").toUpperCase()}`,
      affectedItem: "Entire Delivery Consignment",
      sku: "ALL-ITEMS",
      expectedUnits: totalSent,
      receivedUnits: 0,
      description: `Delivery turned away at dock. Reason: ${rejectReason}. Notes: ${rejectNotes}`,
      photoUrl: rejectPhoto?.url,
      photoName: rejectPhoto?.name,
      photoSize: rejectPhoto?.size,
      driverName: driverName,
      vehicleId: vehicleId,
    });

    const payload: ReceiptCreatePayload = {
      order_id: "a1b2c3d4-0000-0000-0000-000000000001",
      outlet_id: "OUT005",
      units_received: 0,
      has_issues: true,
      issue_type: "other",
      issue_description: `CONSIGNMENT REJECTED: ${rejectReason}. Notes: ${rejectNotes}`,
      confirmed_at: new Date().toISOString(),
    };

    try {
      await submitDeliveryReceipt(payload);
    } catch {
      // handled offline
    } finally {
      setIsSubmitting(false);
      setShowRejectModal(false);
      setStatusFeedback({
        success: true,
        message: "Delivery Consignment Rejected. Dispatcher and vehicle driver notified.",
      });
      setTimeout(() => {
        router.push("/store/deliveries");
      }, 2400);
    }
  };

  if (statusFeedback) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-6 text-center shadow-lg space-y-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
            {statusFeedback.isOffline ? <WifiOff className="size-8" /> : <CheckCircle2 className="size-8" />}
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {statusFeedback.isOffline ? "Saved Offline" : "Receipt Processed"}
          </h2>
          <p className="text-xs text-muted-foreground">{statusFeedback.message}</p>
          <p className="text-xs text-muted-foreground animate-pulse">Redirecting to deliveries...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="gap-2 text-foreground/80 hover:text-primary">
          <Link href="/store/deliveries">
            <ArrowLeft className="size-4" />
            <span>Incoming Deliveries</span>
          </Link>
        </Button>
        <span className="text-xs font-mono font-medium text-muted-foreground">
          {orderNumber} &bull; Fresh Colombo (OUT005)
        </span>
      </div>

      {/* Page Header (Figma 14:527 Header) */}
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">
                Delivery {orderNumber}
              </h1>
              <StorePill tone="warning">At Dock</StorePill>
              <StorePill tone="brand">Fresh</StorePill>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Goods request placed 24 Sep 2026 &bull; Destination: <strong>Fresh Colombo (OUT005)</strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowRejectModal(true)}
              className="text-destructive border-destructive/40 hover:bg-destructive-muted hover:text-destructive font-semibold text-xs"
            >
              <XCircle className="size-4 mr-1.5" />
              <span>Reject Delivery</span>
            </Button>
          </div>
        </div>

        {/* 6-Step Delivery Progress Stepper (Figma 14:619) */}
        <div className="pt-3 border-t border-border/60">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Delivery Progress
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="p-2.5 rounded-md bg-muted/50 border border-border/50 space-y-0.5">
              <div className="font-bold text-foreground">1. Planned</div>
              <div className="text-[11px] text-muted-foreground">24 Sep • Scheduled</div>
            </div>
            <div className="p-2.5 rounded-md bg-muted/50 border border-border/50 space-y-0.5">
              <div className="font-bold text-foreground">2. Assigned</div>
              <div className="text-[11px] text-muted-foreground">25 Sep • {vehicleId}</div>
            </div>
            <div className="p-2.5 rounded-md bg-muted/50 border border-border/50 space-y-0.5">
              <div className="font-bold text-foreground">3. In Transit</div>
              <div className="text-[11px] text-muted-foreground">Today, 05:15</div>
            </div>
            <div className="p-2.5 rounded-md bg-muted/50 border border-border/50 space-y-0.5">
              <div className="font-bold text-foreground">4. Arrived</div>
              <div className="text-[11px] text-muted-foreground">Today, 06:08 • Dock</div>
            </div>
            <div className="p-2.5 rounded-md bg-warning-muted border border-warning/30 space-y-0.5">
              <div className="font-bold text-warning-muted-foreground flex items-center justify-between">
                <span>5. Receiving</span>
                <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              </div>
              <div className="text-[11px] text-warning-muted-foreground font-medium">Intake in progress</div>
            </div>
            <div className="p-2.5 rounded-md bg-muted/30 border border-border/30 opacity-70 space-y-0.5">
              <div className="font-bold text-muted-foreground">6. Completed</div>
              <div className="text-[11px] text-muted-foreground">Awaiting sign-off</div>
            </div>
          </div>
        </div>

        {/* 3 Info Cards: Vehicle & Driver, Window & Location, Manifest & Cold Chain (Figma 14:652) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {/* Card 1: Vehicle & Driver */}
          <div className="p-3.5 bg-muted/40 border border-border/60 rounded-lg space-y-2 text-xs">
            <div className="font-bold text-foreground flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <Truck className="size-3.5 text-primary" />
              <span>Vehicle &amp; Driver</span>
            </div>
            <div className="space-y-1">
              <div>
                <span className="text-muted-foreground">Vehicle: </span>
                <strong className="text-foreground">{vehicleId}</strong>
                <p className="text-[11px] text-muted-foreground">{vehicleSpecs}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Driver: </span>
                <strong className="text-foreground">{driverName}</strong>
                <p className="text-[11px] text-muted-foreground">{driverPhone}</p>
              </div>
              <div className="text-[11px] text-muted-foreground pt-0.5">
                Home depot: <strong className="text-foreground">{homeDepot}</strong>
              </div>
            </div>
          </div>

          {/* Card 2: Window & Location */}
          <div className="p-3.5 bg-muted/40 border border-border/60 rounded-lg space-y-2 text-xs">
            <div className="font-bold text-foreground flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <MapPin className="size-3.5 text-primary" />
              <span>Window &amp; Location</span>
            </div>
            <div className="space-y-1">
              <div>
                <span className="text-muted-foreground">Location: </span>
                <strong className="text-foreground">OUT005 • Rear dock</strong>
                <p className="text-[11px] text-muted-foreground">Fresh Colombo</p>
              </div>
              <div>
                <span className="text-muted-foreground">Delivery window: </span>
                <strong className="text-foreground">{deliveryWindow}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Actual arrival: </span>
                <span className="text-success font-semibold">{actualArrival}</span>
              </div>
            </div>
          </div>

          {/* Card 3: Manifest & Cold Chain */}
          <div className="p-3.5 bg-muted/40 border border-border/60 rounded-lg space-y-2 text-xs">
            <div className="font-bold text-foreground flex items-center gap-1.5 border-b border-border/50 pb-1.5">
              <ShieldCheck className="size-3.5 text-primary" />
              <span>Manifest &amp; Security</span>
            </div>
            <div className="space-y-1.5">
              <div>
                <span className="text-muted-foreground">Dispatched: </span>
                <strong className="text-foreground">{totalSent} units</strong> ({items.length} lines)
                <p className="text-[11px] text-muted-foreground">{homeDepot} • {bolNumber}</p>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/40">
                <span className="text-muted-foreground">Seal {sealNumber}:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sealVerified}
                    onChange={(e) => setSealVerified(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span className={sealVerified ? "text-success font-semibold" : "text-destructive font-semibold"}>
                    {sealVerified ? "Matched" : "Broken"}
                  </span>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cold Chain:</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tempVerified}
                    onChange={(e) => setTempVerified(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span className={tempVerified ? "text-success font-semibold" : "text-destructive font-semibold"}>
                    {tempVerified ? `${tempReading} (OK)` : "Temp Exceeded"}
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Item Intake Verification Section (Figma 14:706) */}
      <section className="bg-card border border-border rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">Item Intake Verification</h2>
              <StorePill tone="brand">
                {items.filter((it) => it.receivedUnits > 0).length} of {items.length} Checked
              </StorePill>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Count each item against {orderNumber}, mark condition, and attach photo evidence for damages/shortages.
            </p>
          </div>
          <div className="text-xs font-bold self-start sm:self-auto">
            Received: <span className={totalReceived < totalSent ? "text-warning" : "text-foreground"}>{totalReceived}</span> / {totalSent} units
          </div>
        </div>

        {/* Item Rows */}
        <div className="space-y-4">
          {items.map((item) => {
            const hasDiscrepancy = item.condition !== "good" || item.receivedUnits !== item.sentUnits;

            return (
              <div
                key={item.id}
                className={`rounded-lg border transition-all p-4 space-y-3 ${
                  hasDiscrepancy
                    ? "border-warning/60 bg-warning-muted/20"
                    : "border-border bg-background/50"
                }`}
              >
                {/* Main Item Row */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{item.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-muted rounded text-muted-foreground font-semibold">
                        {item.sku}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        &bull; Sent: <strong className="text-foreground">{item.sentUnits} cases</strong>
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Category: {item.category}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end lg:self-auto flex-wrap">
                    {/* Received Quantity Stepper */}
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg p-1">
                      <span className="text-[11px] font-semibold text-muted-foreground px-2">Received:</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateUnits(item.id, -1)}
                        className="w-7 h-7 rounded bg-muted hover:bg-muted/80 flex items-center justify-center font-bold text-sm cursor-pointer"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={item.receivedUnits}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 0;
                          setItems((prev) =>
                            prev.map((it) => (it.id === item.id ? { ...it, receivedUnits: val } : it))
                          );
                        }}
                        className="w-10 text-center font-bold text-sm text-foreground bg-transparent border-0 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateUnits(item.id, 1)}
                        className="w-7 h-7 rounded bg-muted hover:bg-muted/80 flex items-center justify-center font-bold text-sm cursor-pointer"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>

                    {/* Segmented Condition Selector */}
                    <div className="flex items-center bg-card border border-border rounded-lg p-1 gap-1 text-xs">
                      {[
                        { key: "good", label: "Good" },
                        { key: "damaged", label: "Damaged" },
                        { key: "missing", label: "Missing" },
                        { key: "incorrect", label: "Incorrect" },
                      ].map((c) => {
                        const isSelected = item.condition === c.key;
                        let activeClass = "bg-primary text-primary-foreground";
                        if (c.key === "good") activeClass = "bg-success text-success-foreground font-bold";
                        if (c.key === "damaged") activeClass = "bg-destructive text-destructive-foreground font-bold";
                        if (c.key === "missing") activeClass = "bg-warning text-warning-foreground font-bold";
                        if (c.key === "incorrect") activeClass = "bg-info text-info-foreground font-bold";

                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => handleSetCondition(item.id, c.key as any)}
                            className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? activeClass
                                : "text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Inline Discrepancy & Photo Evidence Logger */}
                {hasDiscrepancy && (
                  <div className="pt-3 border-t border-warning/40 space-y-3 bg-card/60 p-3.5 rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-warning">
                        <AlertTriangle className="size-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Log Issue: {item.condition.toUpperCase()} ({item.name})
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {item.receivedUnits < item.sentUnits
                          ? `${item.sentUnits - item.receivedUnits} units short`
                          : item.condition === "damaged"
                          ? "Damage inspection required"
                          : "Item discrepancy"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Discrepancy Note */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-muted-foreground">
                          Issue Description / Defect Details
                        </label>
                        <textarea
                          rows={2}
                          value={item.issueNote}
                          onChange={(e) => handleUpdateIssueNote(item.id, e.target.value)}
                          placeholder="e.g. 2 boxes crushed in transit, outer seal ripped, contents spilled..."
                          className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        />
                      </div>

                      {/* Photo Evidence Attachment Box */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-muted-foreground flex items-center justify-between">
                          <span>Photo Evidence</span>
                          <span className="text-[10px] text-muted-foreground">Required for claims</span>
                        </label>

                        {item.photoUrl ? (
                          <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/40 text-xs">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={item.photoUrl}
                                alt="Damage evidence preview"
                                className="w-10 h-10 object-cover rounded border border-border shrink-0"
                              />
                              <div>
                                <div className="font-semibold text-foreground truncate max-w-[150px]">
                                  {item.photoName || "damage_photo.jpg"}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{item.photoSize}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(item.id)}
                              className="p-1 text-destructive hover:bg-destructive-muted rounded cursor-pointer"
                              title="Remove photo"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border hover:border-primary/60 bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors text-xs text-muted-foreground">
                            <Camera className="size-4 text-primary" />
                            <span className="font-semibold text-foreground">Attach Photo Evidence</span>
                            <span className="text-[10px] text-muted-foreground">(camera / browse)</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => handlePhotoUpload(item.id, e)}
                              className="hidden"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* General Receiving Remarks */}
        <div className="space-y-1.5 pt-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">
            General Receiving Remarks / Driver Signature Notes
          </label>
          <textarea
            rows={2}
            value={generalRemarks}
            onChange={(e) => setGeneralRemarks(e.target.value)}
            placeholder="Add any additional remarks regarding dock access, driver handover, or cold-chain condition..."
            className="w-full text-xs p-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
      </section>

      {/* Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowRejectModal(true)}
          className="w-full sm:w-auto text-destructive border-destructive/40 hover:bg-destructive-muted hover:text-destructive font-semibold text-xs"
        >
          <XCircle className="size-4 mr-1.5" />
          <span>Reject Consignment</span>
        </Button>

        <Button
          type="button"
          onClick={handleConfirmReceipt}
          disabled={isSubmitting}
          className="w-full sm:w-auto min-w-[240px] bg-primary text-primary-foreground font-bold hover:bg-primary/90 cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <RefreshCw className="size-4 animate-spin mr-2" />
              <span>Submitting Receipt...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4 mr-2" />
              <span>{hasItemIssues ? "Confirm with Discrepancies" : "Confirm Delivery Receipt"}</span>
            </>
          )}
        </Button>
      </div>

      {/* Reject Delivery Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-card border border-border rounded-xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3 text-destructive">
              <div className="w-11 h-11 rounded-lg bg-destructive-muted flex items-center justify-center shrink-0">
                <AlertTriangle className="size-6 text-destructive" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-foreground">
                  Reject Delivery {orderNumber}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Rejecting a whole consignment returns all goods back to the depot and alerts Central Dispatch immediately.
                </p>
              </div>
            </div>

            {/* Temperature Limit Highlight Banner */}
            <div className="p-3 rounded-lg bg-destructive-muted/30 border border-destructive/30 space-y-1 text-xs">
              <div className="font-bold text-destructive flex items-center gap-1.5">
                <ThermometerSnowflake className="size-4" />
                <span>Cold Chain Audit Flag</span>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Recorded telemetry: <strong className="text-foreground">{tempReading}</strong> vs Limit: <strong className="text-foreground">{tempLimit}</strong>.
              </p>
            </div>

            <form onSubmit={handleRejectDelivery} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Rejection Reason *</label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-none"
                >
                  <option value="temp_breach">Temperature / Cold Chain Breach</option>
                  <option value="seal_broken">Security Container Seal Broken / Tampered</option>
                  <option value="major_damage">Severe Goods Damage in Transit</option>
                  <option value="wrong_destination">Wrong Store Consignment Delivered</option>
                  <option value="late_arrival">Late Arrival (Beyond Operational Window)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Rejection Explanation *</label>
                <textarea
                  rows={3}
                  required
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="State the detailed reason the vehicle was turned away..."
                  className="w-full text-xs p-2.5 rounded-lg border border-border bg-background focus:outline-none resize-none"
                />
              </div>

              {/* Consignment Photo Evidence */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Photo Evidence</span>
                  <span className="text-[10px] text-muted-foreground">Attach photo of broken seal or temperature readout</span>
                </label>
                {rejectPhoto ? (
                  <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/40 text-xs">
                    <div className="flex items-center gap-2">
                      <img src={rejectPhoto.url} alt="Rejection preview" className="w-10 h-10 object-cover rounded border" />
                      <div>
                        <div className="font-semibold text-foreground">{rejectPhoto.name}</div>
                        <div className="text-[10px] text-muted-foreground">{rejectPhoto.size}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRejectPhoto(null)}
                      className="p-1 text-destructive hover:bg-destructive-muted rounded"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border hover:border-primary/60 bg-muted/20 cursor-pointer text-xs">
                    <Camera className="size-4 text-primary" />
                    <span className="font-semibold text-foreground">Upload Rejection Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleRejectPhotoUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button type="button" variant="outline" onClick={() => setShowRejectModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || rejectNotes.trim().length < 5}
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
                >
                  Confirm Consignment Rejection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
