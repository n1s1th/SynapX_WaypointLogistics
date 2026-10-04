import { apiFetch } from "@/lib/api";
import type { AllocationRecommendation, OrderGroupSuggestion } from "@/types/allocation";

export const getSuggestedGroups = () =>
  apiFetch<OrderGroupSuggestion[]>("/allocation-recommendations/groups");

export const getAllocationRecommendation = (orderIds: number[], departureTime: string) =>
  apiFetch<AllocationRecommendation>("/allocation-recommendations", {
    method: "POST",
    body: JSON.stringify({ order_ids: orderIds, departure_time: departureTime }),
  });

export const confirmAllocation = (orderIds: number[], vehicleId: number, departureTime: string, routeFingerprint: string) =>
  apiFetch<unknown>("/allocations/confirm", {
    method: "POST",
    body: JSON.stringify({ order_ids: orderIds, vehicle_id: vehicleId, departure_time: departureTime, route_fingerprint: routeFingerprint }),
  });
