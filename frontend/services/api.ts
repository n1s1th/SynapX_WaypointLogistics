export interface DeliveryReceipt {
  id: string;
  order_id: string;
  outlet_id: string;
  units_received?: number | null;
  weight_received_kg?: number | null;
  has_issues: boolean;
  issue_type?: string | null;
  issue_description?: string | null;
  confirmed_at?: string | null;
  synced_from_offline: boolean;
}

export interface ReceiptCreatePayload {
  order_id: string;
  outlet_id: string;
  units_received?: number | null;
  weight_received_kg?: number | null;
  has_issues: boolean;
  issue_type?: string | null;
  issue_description?: string | null;
  confirmed_at: string;
  synced_from_offline?: boolean;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// --- Receipts API & Offline Helpers ---

export async function submitDeliveryReceipt(payload: ReceiptCreatePayload): Promise<{ receipt?: DeliveryReceipt; isOffline?: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      throw new Error("Receipt already submitted for this order");
    }

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }

    const receipt = await res.json();
    return { receipt, isOffline: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("already submitted")) {
      throw err;
    }
    // Queue in localStorage for offline sync
    saveOfflineReceipt({ ...payload, synced_from_offline: true });
    return { isOffline: true };
  }
}

export async function syncOfflineReceipts(receipts: ReceiptCreatePayload[]): Promise<{ synced: number; skipped: number }> {
  const res = await fetch(`${API_BASE_URL}/api/receipts/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receipts }),
  });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

export async function getDeliveryReceipt(orderId: string): Promise<DeliveryReceipt | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/receipts/${orderId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Failed to fetch receipt");
    return res.json();
  } catch {
    return null;
  }
}

// Local Storage Queue helpers

const OFFLINE_RECEIPTS_KEY = "offline_receipts";

export function getOfflineReceipts(): ReceiptCreatePayload[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(OFFLINE_RECEIPTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveOfflineReceipt(receipt: ReceiptCreatePayload): void {
  if (typeof window === "undefined") return;
  const current = getOfflineReceipts();
  // Avoid duplicate queueing for the same order
  const filtered = current.filter((r) => r.order_id !== receipt.order_id);
  filtered.push(receipt);
  localStorage.setItem(OFFLINE_RECEIPTS_KEY, JSON.stringify(filtered));
}

export function clearOfflineReceipts(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(OFFLINE_RECEIPTS_KEY);
}
