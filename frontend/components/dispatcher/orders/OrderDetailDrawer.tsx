"use client";

import React, { useState, useEffect } from "react";
import { type Order, type OrderItem } from "@/types/order";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Package,
  Snowflake,
  Sun,
  Clock,
  MapPin,
  Calendar,
  Layers,
  X,
  ShieldCheck,
  AlertTriangle,
  FileSpreadsheet,
  Ban,
  CheckCircle2,
  AlertCircle,
  Minus,
  Plus,
} from "lucide-react";
import { fetchWithFallback } from "@/lib/api";

interface OrderDetailDrawerProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onAllocate?: (order: Order) => void;
  onOrderUpdated?: () => void;
}

export function OrderDetailDrawer({
  order,
  isOpen,
  onClose,
  onAllocate,
  onOrderUpdated,
}: OrderDetailDrawerProps) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isDeferModalOpen, setIsDeferModalOpen] = useState(false);
  const [deferringItem, setDeferringItem] = useState<OrderItem | null>(null);
  const [deferMode, setDeferMode] = useState<"partial" | "full">("partial");
  const [assignedQuantity, setAssignedQuantity] = useState<number>(1);
  const [deferReason, setDeferReason] = useState<string>("Depot stock shortage · insufficient inventory");
  const [isSubmittingDefer, setIsSubmittingDefer] = useState(false);
  const [deferSuccessMsg, setDeferSuccessMsg] = useState<string | null>(null);

  // Sync or fetch items when order changes
  useEffect(() => {
    if (!order || !isOpen) {
      setItems([]);
      setDeferSuccessMsg(null);
      return;
    }

    if (order.items && order.items.length > 0) {
      setItems(order.items);
      return;
    }

    // Fallback: Fetch order by ID if items weren't present in the list payload
    let ignore = false;
    async function fetchFullOrder() {
      setIsLoadingItems(true);
      try {
        const res = await fetchWithFallback(`/api/v1/orders/${order?.id}`);
        if (res.ok && !ignore) {
          const data: Order = await res.json();
          if (data.items) {
            setItems(data.items);
          }
        }
      } catch (err) {
        console.error("Failed to fetch order items:", err);
      } finally {
        if (!ignore) setIsLoadingItems(false);
      }
    }

    fetchFullOrder();

    return () => {
      ignore = true;
    };
  }, [order, isOpen]);

  if (!order) return null;

  const orderUnits =
    order.order_units ??
    order.units ??
    items.reduce((acc, it) => acc + (it.quantity || 0), 0);

  const orderWeight = order.order_weight_kg ?? order.weight_kg ?? 0;
  const orderVolume =
    order.order_volume_m3 ??
    order.volume_m3 ??
    (orderUnits > 0 ? Number((orderUnits * 0.02).toFixed(2)) : 0);

  const tempReq = (order.temp_requirement ?? order.temperature_zone ?? "Ambient").toLowerCase();
  const isChilled = tempReq.includes("chill") || tempReq.includes("reefer");

  const getBrandBadge = (brand?: string | null) => {
    switch (brand?.toLowerCase()) {
      case "fresh":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Fresh Chain
          </span>
        );
      case "style":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            Style Chain
          </span>
        );
      case "tech":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            Tech Chain
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            {order.brand || "General"}
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toUpperCase()) {
      case "CONFIRMED":
      case "SUBMITTED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            {status}
          </span>
        );
      case "ALLOCATED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            Allocated
          </span>
        );
      case "DEFERRED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            Deferred
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  const handleOpenDeferItem = (item: OrderItem) => {
    setDeferringItem(item);
    const initialAssigned = item.quantity > 1 ? Math.floor(item.quantity / 2) : 0;
    setAssignedQuantity(initialAssigned);
    if (initialAssigned === 0) {
      setDeferMode("full");
      setDeferReason(`Depot stock shortage on ${item.item_name} (${item.sku}): 0 of ${item.quantity} units available; all deferred.`);
    } else {
      setDeferMode("partial");
      setDeferReason(`Depot stock limitation: only ${initialAssigned} of ${item.quantity} units available in depot; remaining ${item.quantity - initialAssigned} units deferred.`);
    }
    setIsDeferModalOpen(true);
  };

  const handleQuantityChange = (qty: number) => {
    if (!deferringItem) return;
    const clamped = Math.max(0, Math.min(deferringItem.quantity, qty));
    setAssignedQuantity(clamped);
    if (clamped === 0) {
      setDeferMode("full");
      setDeferReason(`Depot stock shortage on ${deferringItem.item_name} (${deferringItem.sku}): 0 of ${deferringItem.quantity} units available; all deferred.`);
    } else if (clamped < deferringItem.quantity) {
      setDeferMode("partial");
      setDeferReason(`Depot stock limitation: only ${clamped} of ${deferringItem.quantity} units available in depot; remaining ${deferringItem.quantity - clamped} units deferred.`);
    } else {
      setDeferMode("partial");
      setDeferReason(`Full fulfillment: all ${clamped} units allocated from depot stock.`);
    }
  };

  const handleConfirmDefer = async () => {
    if (!order) return;
    setIsSubmittingDefer(true);
    try {
      const payload: {
        reason: string;
        item_id?: number;
        item_sku?: string;
        quantity_sent?: number;
      } = {
        reason: deferReason,
      };

      if (deferringItem) {
        payload.item_id = deferringItem.id;
        payload.item_sku = deferringItem.sku;
        payload.quantity_sent = deferMode === "partial" ? assignedQuantity : 0;
      }

      const res = await fetchWithFallback(`/api/v1/orders/${order.id}/defer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setDeferSuccessMsg(
          deferringItem && deferMode === "partial" && assignedQuantity > 0
            ? `Assigned ${assignedQuantity} of ${deferringItem.quantity} units. Store Manager notified of partial shortfall.`
            : "Order deferral recorded. The Store Manager has been notified."
        );
        setIsDeferModalOpen(false);
        setDeferringItem(null);
        onOrderUpdated?.();
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to process deferral");
      }
    } catch (e) {
      console.error("Deferral failed:", e);
      alert("Network error while processing deferral");
    } finally {
      setIsSubmittingDefer(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-[700px] w-full max-h-[90vh] flex flex-col p-0 rounded-[20px] bg-white border border-[#E5E5E2] shadow-2xl text-[#171A1F] overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#E5E5E2] bg-gradient-to-r from-slate-50 via-white to-slate-50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-lg font-bold text-[#18385F] tracking-tight">
                    {order.order_number}
                  </span>
                  {getBrandBadge(order.brand)}
                  {getStatusBadge(order.status)}
                  {order.is_priority && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      High Priority
                    </span>
                  )}
                </div>
                <DialogTitle className="sr-only">Order Details for {order.order_number}</DialogTitle>
                <DialogDescription className="text-xs text-[#6B7280] mt-1 font-normal">
                  Destination: <span className="font-semibold text-slate-800">{order.client_name}</span> · {order.destination_address}
                </DialogDescription>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Metrics Banner */}
            <div className="grid grid-cols-4 gap-2.5 mt-4 pt-3.5 border-t border-slate-200/70">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  Total Units
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Package className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="text-sm font-bold text-slate-800">
                    {orderUnits.toLocaleString()} pcs
                  </span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  Weight
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Layers className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-sm font-bold text-slate-800">
                    {orderWeight.toLocaleString()} kg
                  </span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  Volume
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-600" />
                  <span className="text-sm font-bold text-slate-800">
                    {orderVolume.toFixed(2)} m³
                  </span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  Thermal Zone
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isChilled ? (
                    <>
                      <Snowflake className="w-3.5 h-3.5 text-sky-500" />
                      <span className="text-sm font-bold text-sky-700">Chilled</span>
                    </>
                  ) : (
                    <>
                      <Sun className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-sm font-bold text-slate-700">Ambient</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Content Body: Scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {deferSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{deferSuccessMsg}</span>
              </div>
            )}

            {/* Outlet & Delivery Logistics Info */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>Delivery Destination</span>
                </div>
                <p className="font-semibold text-slate-800 pl-5">
                  {order.client_name}
                </p>
                <p className="text-slate-600 pl-5 text-[11px] leading-relaxed">
                  {order.destination_address}
                  {order.district ? ` (${order.district})` : ""}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                  <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>Fulfillment Window</span>
                </div>
                <p className="font-semibold text-slate-800 pl-5">
                  {order.delivery_window || "Standard Logistics Window (08:00 - 16:00)"}
                </p>
                <p className="text-slate-600 pl-5 text-[11px] flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <span>Date: {order.operating_date || "Current Operations"}</span>
                </p>
              </div>
            </div>

            {/* Store Manager Notes */}
            {order.notes && (
              <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200/50 text-xs mt-3">
                <div className="flex items-center gap-1.5 text-amber-700 font-medium mb-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Store Manager Note</span>
                </div>
                <p className="text-amber-900 pl-5 leading-relaxed">
                  {order.notes}
                </p>
              </div>
            )}

            {/* Line Items Table without pricing */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#18385F]" />
                  <h3 className="text-sm font-bold text-slate-800">
                    Order Items &amp; Depot Stock Allocations
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">
                    {items.length} {items.length === 1 ? "SKU" : "SKUs"}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Depot Stock Fulfillment Queue
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3.5 w-10 text-center text-[11px]">#</th>
                      <th className="py-2.5 px-3.5 text-[11px]">SKU</th>
                      <th className="py-2.5 px-3.5 text-[11px]">Item Description</th>
                      <th className="py-2.5 px-3.5 text-right text-[11px]">Quantities</th>
                      <th className="py-2.5 px-3.5 text-right text-[11px]">Fulfillment Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {isLoadingItems ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                          Loading order line items...
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                          No individual line items registered for this order.
                        </td>
                      </tr>
                    ) : (
                      items.map((item, index) => {
                        const hasSentVal = item.quantity_sent !== null && item.quantity_sent !== undefined;
                        const isPartial = hasSentVal && item.quantity_sent! < item.quantity && item.quantity_sent! > 0;
                        const isZeroSent = hasSentVal && item.quantity_sent === 0;

                        return (
                          <tr
                            key={item.id || `${item.sku}-${index}`}
                            className="hover:bg-slate-50/60 transition-colors"
                          >
                            <td className="py-2.5 px-3.5 text-center text-slate-400 font-mono text-[11px]">
                              {index + 1}
                            </td>
                            <td className="py-2.5 px-3.5 font-mono font-medium text-[#18385F] text-[11px] whitespace-nowrap">
                              {item.sku}
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-800">
                              <div className="font-medium text-slate-800">{item.item_name}</div>
                              {item.dispatcher_note && (
                                <div className="text-[10px] text-amber-700 italic mt-0.5 flex items-center gap-1">
                                  <AlertCircle className="size-2.5 shrink-0" />
                                  <span>{item.dispatcher_note}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-bold text-slate-900 whitespace-nowrap">
                              {hasSentVal ? (
                                <div className="flex flex-col items-end">
                                  <span>
                                    {item.quantity_sent} of {item.quantity} pcs
                                  </span>
                                  {item.quantity_sent! < item.quantity && (
                                    <span className="text-[10px] text-amber-600 font-normal">
                                      {item.quantity - item.quantity_sent!} pcs deferred
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span>{item.quantity.toLocaleString()} pcs</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                              {isZeroSent ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  Deferred (0/{item.quantity})
                                </span>
                              ) : isPartial ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                    Partial ({item.quantity_sent}/{item.quantity})
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenDeferItem(item)}
                                    className="h-6 px-1.5 text-[10px] text-slate-500 hover:text-slate-800"
                                  >
                                    Edit
                                  </Button>
                                </div>
                              ) : order.status === "DEFERRED" ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  Deferred
                                </span>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenDeferItem(item)}
                                  className="h-6 px-2 text-[10px] font-semibold text-amber-800 border-amber-200 hover:bg-amber-50 hover:border-amber-300"
                                  title="Adjust allocation or defer shortage on this item"
                                >
                                  <Ban className="size-2.5 mr-1 text-amber-600" />
                                  Defer / Partial
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {items.length > 0 && (
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3.5 font-semibold text-slate-700">
                          Total Order Quantity
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-bold text-slate-900">
                          {items
                            .reduce((sum, it) => sum + (it.quantity || 0), 0)
                            .toLocaleString()} pcs
                        </td>
                        <td className="py-2.5 px-3.5 text-right text-slate-400 text-[11px]">
                          —
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Allocation or Deferral Context Note if applicable */}
            {order.allocation_id && (
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Allocated to Delivery Run:</span> This order is assigned to Run ID #{order.allocation_id} and scheduled for dispatch loading.
                </div>
              </div>
            )}

            {order.deferral_reason && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Deferral / Shortfall Audit Note:</span> {order.deferral_reason}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[#E5E5E2] bg-slate-50/70 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Order ID: <span className="font-mono font-medium text-slate-700">#{order.id}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs border-slate-300 hover:bg-slate-100"
              >
                Close
              </Button>
              {order.status !== "DEFERRED" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeferringItem(null);
                    setDeferReason("Depot stock shortage · insufficient inventory across requested items");
                    setIsDeferModalOpen(true);
                  }}
                  className="text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                >
                  <Ban className="size-3 mr-1 text-amber-600" />
                  Defer Entire Order
                </Button>
              )}
              {onAllocate && (order.status === "CONFIRMED" || order.status === "SUBMITTED") && !order.allocation_id && (
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    onAllocate(order);
                  }}
                  className="text-xs bg-[#18385F] hover:bg-[#142f50] text-white"
                >
                  Allocate to Vehicle
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Deferral / Partial Allocation Modal */}
      <Dialog open={isDeferModalOpen} onOpenChange={setIsDeferModalOpen}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-[480px] p-6 rounded-2xl bg-white border border-[#E5E5E2] shadow-2xl text-[#171A1F]"
        >
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-base font-bold text-slate-900">
                {deferringItem ? "Adjust Stock Allocation & Defer Shortage" : "Defer Order (Depot Shortage)"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-0.5">
                {deferringItem
                  ? "Assign the available units from depot stock and defer the remaining balance."
                  : "This will mark the order as Deferred and notify the Store Manager on their portal."}
              </DialogDescription>
            </div>
            <button
              onClick={() => setIsDeferModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="my-3 space-y-3.5">
            {deferringItem && (
              <>
                <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-semibold text-amber-900 block">Item SKU:</span>
                      <span className="font-mono text-amber-800 font-bold">{deferringItem.sku}</span> · {deferringItem.item_name}
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]">
                      Requested: {deferringItem.quantity} pcs
                    </span>
                  </div>

                  {/* Quantity adjustment stepper */}
                  <div className="pt-2 border-t border-amber-200/70">
                    <label className="text-[11px] font-semibold text-amber-900 block mb-1.5">
                      Units Available in Depot to Assign:
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="inline-flex items-center border border-amber-300 rounded-lg bg-white overflow-hidden shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(assignedQuantity - 1)}
                          disabled={assignedQuantity <= 0}
                          className="p-2 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                          <Minus className="size-3 text-slate-700" />
                        </button>
                        <input
                          type="number"
                          value={assignedQuantity}
                          onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 0)}
                          min={0}
                          max={deferringItem.quantity}
                          className="w-14 text-center font-bold text-xs py-1 border-x border-amber-200 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(assignedQuantity + 1)}
                          disabled={assignedQuantity >= deferringItem.quantity}
                          className="p-2 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                          <Plus className="size-3 text-slate-700" />
                        </button>
                      </div>

                      <div className="text-xs">
                        <span className="text-slate-600 block">
                          Deferred balance:{" "}
                          <span className="font-bold text-rose-700">
                            {deferringItem.quantity - assignedQuantity} pcs
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {assignedQuantity === 0
                            ? "All units deferred to next delivery"
                            : assignedQuantity < deferringItem.quantity
                            ? `Partial: ${assignedQuantity} pcs allocated for delivery`
                            : "Full quantity will be delivered"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Reason / Note for Store Manager:
              </label>
              <textarea
                value={deferReason}
                onChange={(e) => setDeferReason(e.target.value)}
                rows={3}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#18385F]"
                placeholder="Describe the stock limitation..."
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeferModalOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmDefer}
              disabled={isSubmittingDefer}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium"
            >
              {isSubmittingDefer
                ? "Updating..."
                : deferringItem && assignedQuantity > 0
                ? `Confirm ${assignedQuantity} of ${deferringItem.quantity} & Notify Store`
                : "Confirm Deferral & Notify Store"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
