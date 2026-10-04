import { apiFetch } from "@/lib/api";
import type { RouteComparison } from "@/types/allocation";

export const previewRoute = (runId: number, stopOrder?: string[]) =>
  apiFetch<RouteComparison>(`/delivery-runs/${runId}/route-preview`, {
    method: "POST", body: JSON.stringify({ stop_order: stopOrder }),
  });

export const applyRoute = (runId: number, comparison: RouteComparison, actionId: string) =>
  apiFetch(`/delivery-runs/${runId}/plan`, {
    method: "POST",
    body: JSON.stringify({
      plan: { client_action_id: actionId, base_version: comparison.base_version,
        stop_order: comparison.proposed.ordered_outlet_codes, dispatcher: "Dispatcher" },
      route_fingerprint: comparison.proposed.route_fingerprint,
      current_route_fingerprint: comparison.current_route_fingerprint,
    }),
  });
