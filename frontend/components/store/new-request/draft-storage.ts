// Keeps an unsent goods request in this browser, so a failed submit or "Save as Draft" loses nothing
// (Figma 03d: "Your request is saved as a draft on this device"). Replaced by the draft API later.

export interface RequestDraft {
  items: { sku: string; quantity: number }[];
  isHighPriority: boolean;
  deliveryDate?: string;
  notes: string;
  /** Set when the manager narrowed the delivery window. */
  window?: { start: string; end: string };
  savedAt: string;
}

const KEY = "waypoint.store.goods-request-draft";

export function loadDraft(): RequestDraft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RequestDraft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Omit<RequestDraft, "savedAt">) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode); nothing to clear.
  }
}
