"use client";
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Package, MapPin, Printer, ChevronDown, ChevronRight } from "lucide-react";

import { DeliveryRun, DeliveryRunStop } from "@/app/dispatcher/delivery-runs/page";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

interface ManifestOrder {
  id: number;
  order_number: string;
  client_name: string;
  destination_address: string;
  status: string;

    items: { sku: string; item_name: string; quantity: number }[];
}

interface ManifestData {
  run_id: number;
  trip_code: string;
  vehicle_number: string;
  driver_name: string;
  departure_time: string | null;
  orders: ManifestOrder[];
  total_weight_kg: number;
  total_volume_m3: number;
  stop_sequence: (DeliveryRunStop | string)[];
}

interface ManifestDialogProps {
  run: DeliveryRun;
  onClose: () => void;
}

export function ManifestDialog({ run, onClose }: ManifestDialogProps) {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/v1/delivery-runs/${run.id}/manifest`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ManifestData = await res.json();
        setManifest(data);
        setExpandedOrders(new Set(data.orders.map(o => o.id)));
      } catch (e) {
        setError("Failed to load manifest. Please try again.");
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [run.id]);

  const toggleOrder = (id: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stops = ((manifest?.stop_sequence ?? run.stop_sequence) || [])
    .map((s, i) => ({
      idx: i + 1,
      name: typeof s === "string" ? s : (s as DeliveryRunStop).name,
      id: typeof s === "string" ? s : (s as DeliveryRunStop).id,
      eta: typeof s === "string" ? null : (s as DeliveryRunStop).eta,
      sla_ok: typeof s === "string" ? true : (s as DeliveryRunStop).sla_ok,
    }));

  const departureStr = manifest?.departure_time
    ? format(new Date(manifest.departure_time), "dd MMM yyyy, HH:mm")
    : run.departure_time
    ? format(new Date(run.departure_time), "dd MMM yyyy, HH:mm")
    : "—";

  const totalItems = manifest?.orders.reduce((acc, o) => acc + o.items.reduce((a, i) => a + i.quantity, 0), 0) ?? 0;


  const statusColor = (s: string) => {
    const lower = s.toLowerCase();
    if (lower === "dispatched" || lower === "allocated") return "text-blue-600 bg-blue-50 border-blue-200";
    if (lower === "delivered") return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (lower === "cancelled") return "text-red-600 bg-red-50 border-red-200";
    return "text-slate-600 bg-slate-50 border-slate-200";
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-2xl bg-white border-0 p-0 rounded-[10px] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 mb-1">Trip Manifest</DialogTitle>
              <DialogDescription className="text-slate-500">
                All orders and line items assigned to this delivery run.
              </DialogDescription>
            </div>
            <Button onClick={() => window.print()} variant="outline" size="sm" className="border-slate-200 text-slate-700 gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="bg-[#18385F] text-white text-xs font-bold px-2 py-0.5 rounded-[4px]">{run.trip_code}</span>
              <span className="text-sm text-slate-600 font-medium">{run.vehicle_number}</span>
            </div>
            <div className="text-sm text-slate-600">
              <span className="text-slate-400 mr-1">Driver:</span>
              <span className="font-semibold text-slate-800">{run.driver_name}</span>
            </div>
            <div className="text-sm text-slate-600">
              <span className="text-slate-400 mr-1">Departure:</span>
              <span className="font-semibold text-slate-800">{departureStr}</span>
            </div>
            <div className="text-sm text-slate-600">
              <span className="text-slate-400 mr-1">Depot:</span>
              <span className="font-semibold text-slate-800">{run.depot_name || "—"}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs font-semibold text-slate-500">
            <span><span className="text-slate-900 font-bold">{manifest?.orders.length ?? "—"}</span> orders</span>
            <span className="text-slate-200">|</span>
            <span><span className="text-slate-900 font-bold">{totalItems}</span> items</span>
            <span className="text-slate-200">|</span>
            <span><span className="text-slate-900 font-bold">{run.total_weight_kg.toFixed(0)} kg</span> weight</span>
            <span className="text-slate-200">|</span>
            <span><span className="text-slate-900 font-bold">{run.total_volume_m3.toFixed(1)} m³</span> volume</span>

          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-10 text-center text-slate-400 text-sm">Loading manifest…</div>
          )}
          {error && (
            <div className="p-10 text-center text-red-600 text-sm">{error}</div>
          )}
          {!isLoading && !error && manifest && (
            <div className="p-6 space-y-6">
              {/* Stop sequence summary */}
              {stops.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" /> Stop sequence ({stops.length} stops)
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {stops.map((stop) => (
                      <div key={stop.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${stop.sla_ok ? "border-slate-200 text-slate-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                        <span className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">{stop.idx}</span>
                        {stop.name}
                        {stop.eta && <span className="text-slate-400 font-normal">· {stop.eta}</span>}
                        {!stop.sla_ok && <span className="text-red-500">⚠</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Orders */}
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Package className="h-3 w-3" /> Orders ({manifest.orders.length})
                </h3>
                {manifest.orders.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm italic border border-dashed border-slate-200 rounded-lg">
                    No orders are linked to this delivery run yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {manifest.orders.map((order) => {
                      const isExpanded = expandedOrders.has(order.id);
                      return (
                        <div key={order.id} className="border border-slate-200 rounded-[8px] overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors text-left"
                            onClick={() => toggleOrder(order.id)}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">{order.order_number}</span>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusColor(order.status)}`}>
                                  {order.status}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">{order.client_name}</p>
                              <p className="text-xs text-slate-400">{order.destination_address}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">

                              <span className="text-xs text-slate-400">{order.items.length} items</span>
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                            </div>
                          </button>
                          {isExpanded && order.items.length > 0 && (
                            <div className="border-t border-slate-100 bg-slate-50/60">
                              <div className="grid grid-cols-9 gap-2 px-4 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <span className="col-span-2">SKU</span>
                                <span className="col-span-5">Item</span>
                                <span className="col-span-2 text-right">Qty</span>
                              </div>
                              {order.items.map((item, i) => (
                                <div key={i} className="grid grid-cols-9 gap-2 px-4 py-2 text-xs border-t border-slate-100 hover:bg-slate-50">
                                  <span className="col-span-2 font-mono text-slate-500">{item.sku}</span>
                                  <span className="col-span-5 text-slate-800 font-medium">{item.item_name}</span>
                                  <span className="col-span-2 text-right font-bold text-slate-900">{item.quantity}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {isExpanded && order.items.length === 0 && (
                            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 italic">No line items recorded.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
          <Button variant="outline" onClick={onClose} className="h-9 px-6 border-slate-200 text-slate-700">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
