"use client";

/**
 * Driver progress on a delivery run, from server-confirmed data only
 * (GET /delivery-runs/{id}/deliveries). Records still on a driver's phone are
 * not shown until they sync. Sync conflicts wait here for a dispatcher.
 */
import React, { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Camera, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/dispatcher/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";
const REFRESH_MS = 30_000;

interface DriverStopProgress {
  stop_id: number;
  sequence: number;
  customer_name: string;
  status: string;
  outcome_reason: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  pod_available: boolean;
  recipient_name: string | null;
  photo_count: number;
  pod_received_at: string | null;
  delivered_items: Record<string, number> | null;
  ordered_items: Record<string, number> | null;
}

interface SyncConflict {
  event_id: number;
  action_type: string;
  stop_id: number | null;
  code: string | null;
  message: string | null;
  driver_record: Record<string, unknown> | null;
  recorded_at: string | null;
  received_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

interface RunDeliveries {
  driver_trip_id: number | null;
  trip_status: string | null;
  stops: DriverStopProgress[];
  conflicts: SyncConflict[];
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  delivered: "success",
  partial: "warning",
  failed: "destructive",
  rescheduled: "neutral",
  arrived: "info",
  pending: "neutral",
};

function hhmm(iso: string | null) {
  return iso ? format(new Date(iso), "HH:mm") : "-";
}

function units(items: Record<string, number> | null) {
  return items ? Object.values(items).reduce((s, n) => s + n, 0) : null;
}

export function DriverDeliveriesSection({ runId }: { runId: number }) {
  const [data, setData] = useState<RunDeliveries | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/${runId}/deliveries`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // Keep the last good copy; the next refresh tries again
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function markReviewed(eventId: number) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/delivery-runs/${runId}/sync-conflicts/${eventId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes[eventId] || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Conflict marked as reviewed — the driver's phone will be told");
      load();
    } catch {
      toast.error("Couldn't save the review");
    }
  }

  if (!data || data.driver_trip_id === null) {
    return (
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-2">Driver deliveries</h3>
        <p className="text-sm text-slate-500 italic">{data ? "No driver trip linked to this run yet." : "Loading…"}</p>
      </div>
    );
  }

  const openConflicts = data.conflicts.filter((c) => !c.reviewed_at);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Driver deliveries</h3>
        <button onClick={load} className="text-slate-400 hover:text-slate-600" title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {openConflicts.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-md p-3 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-900">
                {openConflicts.length} sync conflict{openConflicts.length === 1 ? "" : "s"} to review
              </p>
              <p className="text-xs text-red-700 mt-0.5">Recorded offline against a plan that changed. Nothing was applied.</p>
            </div>
          </div>
          {openConflicts.map((c) => {
            const rec = c.driver_record ?? {};
            return (
              <div key={c.event_id} className="bg-white border border-red-100 rounded-md p-2.5 space-y-2">
                <p className="text-xs font-semibold text-slate-900">{c.message}</p>
                <p className="text-xs text-slate-600">
                  Driver recorded {String(rec.outcome ?? c.action_type)}
                  {rec.recipient_name ? ` · received by ${rec.recipient_name}` : ""}
                  {rec.photo_count ? ` · ${rec.photo_count} photo(s)` : ""}
                  {rec.reason ? ` · ${rec.reason}` : ""} at {hhmm(c.recorded_at)} (synced {hhmm(c.received_at)})
                </p>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Resolution note (optional)"
                    value={notes[c.event_id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [c.event_id]: e.target.value }))}
                  />
                  <Button size="sm" className="h-8 bg-[#18385F] hover:bg-[#12294a] text-white" onClick={() => markReviewed(c.event_id)}>
                    Mark reviewed
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        {data.stops.map((s) => {
          const delivered = units(s.delivered_items);
          const ordered = units(s.ordered_items);
          return (
            <div key={s.stop_id} className="bg-slate-50 border border-slate-100 rounded-md p-2.5 space-y-1">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-slate-600">{s.sequence}</span>
                </div>
                <span className="text-sm font-medium text-slate-700 flex-1 truncate">{s.customer_name}</span>
                <StatusBadge status={s.status.charAt(0).toUpperCase() + s.status.slice(1)} variant={STATUS_VARIANT[s.status] ?? "neutral"} />
              </div>
              <div className="pl-8 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                {s.arrived_at && <span>Arrived {hhmm(s.arrived_at)}</span>}
                {s.completed_at && <span>Done {hhmm(s.completed_at)}</span>}
                {delivered !== null && ordered !== null && (
                  <span className={delivered < ordered ? "text-amber-700 font-medium" : ""}>
                    {delivered}/{ordered} units
                  </span>
                )}
                {s.pod_available && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> POD · {s.recipient_name}
                    {s.photo_count > 0 && <><Camera className="h-3 w-3 ml-1" />{s.photo_count}</>}
                  </span>
                )}
                {s.outcome_reason && <span className="text-red-700">{s.outcome_reason}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
