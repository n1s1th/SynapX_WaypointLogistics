export const DISPATCHER_DEPOTS = ["peliyagoda", "kandy"] as const;
export type DispatcherDepot = (typeof DISPATCHER_DEPOTS)[number];

const DEPOT_STORAGE_KEY = "waypoint_dispatcher_depot";
export const DEPOT_CHANGE_EVENT = "waypoint-dispatcher-depot-change";

export function getDispatcherDepot(): DispatcherDepot {
  if (typeof window === "undefined") return "peliyagoda";
  const value = localStorage.getItem(DEPOT_STORAGE_KEY)?.toLowerCase();
  return value === "kandy" ? "kandy" : "peliyagoda";
}

export function setDispatcherDepot(depot: DispatcherDepot): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEPOT_STORAGE_KEY, depot);
  window.dispatchEvent(new CustomEvent<DispatcherDepot>(DEPOT_CHANGE_EVENT, { detail: depot }));
}

export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem("waypoint_access_token") ||
    localStorage.getItem("admin_token") ||
    localStorage.getItem("driver_token") ||
    null
  );
}

export function dispatcherDepotHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (!result.has("X-Waypoint-Depot")) {
    result.set("X-Waypoint-Depot", getDispatcherDepot());
  }
  if (!result.has("Authorization")) {
    const token = getStoredAuthToken();
    if (token) {
      result.set("Authorization", `Bearer ${token}`);
    }
  }
  return result;
}

