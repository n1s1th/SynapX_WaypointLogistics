export interface OutletContact { id?: number; name: string; role: string | null; phone: string | null; email: string | null }
export interface ReceivingWindow { id?: number; weekday: number; opens_at: string; closes_at: string }
export interface OutletRecord {
  id: number; code: string; name: string; address: string | null; district: string; brand: string; depot: string; dock_type: string; van_only: boolean; active: boolean | null;
  window_start: string | null; window_end: string | null; parking_constraint: string | null; mall_window: string | null;
  delivery_restrictions: string | null; contacts: OutletContact[]; receiving_windows: ReceivingWindow[];
  created_at: string | null; updated_at: string | null;
}
export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
export async function fetchOutlets(signal: AbortSignal): Promise<OutletRecord[]> {
  const records = new Map<number, OutletRecord>();
  for (let skip = 0; ; skip += 100) {
    const response = await fetch(`${apiBase}/api/v1/outlets/?skip=${skip}&limit=100`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Outlets could not be loaded (${response.status}). The outlet migration and API may not be deployed yet.`);
    const page: unknown = await response.json();
    if (!Array.isArray(page) || !page.every((item) => item && typeof item.id === "number" && typeof item.code === "string" && typeof item.name === "string" && (item.address === null || typeof item.address === "string") && (item.active === null || typeof item.active === "boolean") && (item.updated_at === null || typeof item.updated_at === "string") && Array.isArray(item.contacts) && Array.isArray(item.receiving_windows))) {
      throw new Error("The outlet response contains invalid records.");
    }
    const before = records.size;
    for (const item of page as OutletRecord[]) records.set(item.id, item);
    if (page.length < 100) break;
    if (before === records.size) throw new Error("Outlet pagination did not advance. Please retry.");
  }
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}
