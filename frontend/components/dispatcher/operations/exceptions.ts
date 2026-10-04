import { getAccessToken } from "@/lib/auth";

export interface ShipmentRecord {
  id: number;
  tracking_number: string;
  order_id: number;
  status: string;
  current_location: string | null;
  last_updated: string;
  dispatch_trip?: {
    trip_code: string;
    vehicle_number: string;
    driver_name: string;
    destination: string;
    estimated_arrival: string | null;
    actual_arrival: string | null;
  } | null;
}

export interface OperationException {
  id: string;
  source: "loader" | "driver" | "tracking" | "store";
  kind: string;
  title: string;
  detail: string;
  status: string;
  reported_at: string | null;
  trip_code: string | null;
  driver_name: string | null;
  reference: string | null;
  severity: "critical" | "warning";
  issue_code?: string;
  outlet_code?: string | null;
  outlet_name?: string | null;
  reported_by?: string | null;
  affected_item?: string | null;
  /** The photo a driver attached to an SOS or a problem report. */
  photo_url?: string | null;
}

/** A Cloudflare R2 link as it is; an older photo kept in the API's uploads folder gets the API's address. */
export function photoSrc(url: string) {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  return /^https?:\/\//.test(url) ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function fetchOperationExceptions(signal: AbortSignal): Promise<OperationException[]> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  const token = getAccessToken();
  const response = await fetch(`${base}/api/v1/operations/exceptions`, {
    signal,
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`Exceptions could not be loaded (${response.status}).`);
  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.every((row) => row && typeof row.id === "string" && ["loader", "driver", "tracking", "store"].includes(row.source) && typeof row.kind === "string" && typeof row.title === "string" && typeof row.detail === "string" && typeof row.status === "string" && ["critical", "warning"].includes(row.severity))) {
    throw new Error("The exceptions response contains invalid records.");
  }
  return data as OperationException[];
}

export function timestamp(value: string | null | undefined) {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}

export function exceptionDate(value: string | null | undefined) {
  const time = timestamp(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }).format(time) : "Not recorded";
}

export function shipmentExceptions(shipments: ShipmentRecord[], now: number) {
  return shipments.flatMap((shipment) => {
    // Failed shipments take precedence; one row per shipment, never an invented incident.
    if (shipment.status === "failed") return [{ shipment, kind: "failed", label: "Failed shipment", reason: "The recorded shipment status is failed. A failure reason is not available." }];
    const trip = shipment.dispatch_trip;
    if (["pending", "in_transit", "out_for_delivery"].includes(shipment.status) && trip && !trip.actual_arrival && timestamp(trip.estimated_arrival) < now) {
      return [{ shipment, kind: "eta", label: "Trip ETA passed", reason: "The linked trip ETA has passed and no actual trip arrival is recorded. Confirm with the driver; this does not prove a missed outlet delivery window." }];
    }
    return [];
  }).sort((a, b) => (a.kind === b.kind ? a.shipment.tracking_number.localeCompare(b.shipment.tracking_number) : a.kind === "failed" ? -1 : 1));
}

export async function fetchShipments(signal: AbortSignal): Promise<ShipmentRecord[]> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  const records = new Map<number, ShipmentRecord>();
  for (let skip = 0; ; skip += 100) {
    const response = await fetch(`${base}/api/v1/tracking/?skip=${skip}&limit=100`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Shipments could not be loaded (${response.status}).`);
    const page: unknown = await response.json();
    if (!Array.isArray(page) || !page.every((item) => item && typeof item.id === "number" && typeof item.tracking_number === "string" && typeof item.order_id === "number" && ["pending", "in_transit", "out_for_delivery", "delivered", "failed"].includes(item.status) && typeof item.last_updated === "string" && Number.isFinite(timestamp(item.last_updated)) && (item.current_location == null || typeof item.current_location === "string") && (item.dispatch_trip == null || (["trip_code", "vehicle_number", "driver_name", "destination"].every((key) => typeof item.dispatch_trip[key] === "string") && ["estimated_arrival", "actual_arrival"].every((key) => item.dispatch_trip[key] == null || (typeof item.dispatch_trip[key] === "string" && Number.isFinite(timestamp(item.dispatch_trip[key])))))))) {
      throw new Error("The shipments response contains invalid records.");
    }
    const before = records.size;
    for (const item of page as ShipmentRecord[]) records.set(item.id, item);
    if (page.length < 100) break;
    if (before === records.size) throw new Error("Shipment pagination did not advance. Please retry.");
  }
  return [...records.values()];
}
