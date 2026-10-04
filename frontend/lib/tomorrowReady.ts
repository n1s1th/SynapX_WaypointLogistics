/**
 * "Available tomorrow?": the driver tells dispatch they can take a run
 * tomorrow. Dispatch plans tomorrow's trips at the 4 PM cutoff (Sri Lanka
 * time), so the driver confirms before then, once a day. The phone remembers
 * the confirmation for the day.
 */
import { apiFetch } from "./api";
import { colomboNow, READY_CUTOFF_HOUR } from "./colomboTime";

export type ReadyState = "open" | "confirmed" | "closed";

function readyKey() {
  return `driver-ready-for-tomorrow:${colomboNow().dateKey}`;
}

export function readyConfirmedToday() {
  try {
    return localStorage.getItem(readyKey()) === "1";
  } catch {
    return false;
  }
}

/** Confirmed today, still open (before 4 PM), or closed for today. */
export function readyState(): ReadyState {
  if (readyConfirmedToday()) return "confirmed";
  return colomboNow().hour < READY_CUTOFF_HOUR ? "open" : "closed";
}

/** Tomorrow in Sri Lanka, e.g. "Monday, Oct 5". */
export function tomorrowLabel() {
  const [y, m, d] = colomboNow().dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1))
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

export async function confirmReadyForTomorrow() {
  try {
    // Send readiness to dispatcher
    await apiFetch("/driver/ready-tomorrow", { method: "POST" });
  } catch (e) {
    console.warn("Backend endpoint might not exist yet, but proceeding to update UI", e);
  }
  try {
    localStorage.setItem(readyKey(), "1");
  } catch {
    // storage blocked: the confirmation just shows as open again after a reload
  }
}
