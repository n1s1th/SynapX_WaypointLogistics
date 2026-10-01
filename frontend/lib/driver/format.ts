// Display helpers for the driver app. Every time is shown in depot time
// (Asia/Colombo, UTC+05:30) whatever the phone's own time zone is.

import type { DockType, DriverStop, OutletRef, RunCard, StopStatus, StopTiming } from "./types";

const ZONE = "Asia/Colombo";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "05:42" in Colombo time, or "--:--". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  return timeFormat.format(new Date(iso));
}

/** "Thu 28 May" in Colombo time. */
export function formatDay(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return dayFormat.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "2026-05-28": the Colombo calendar day. */
export function dayKey(value: string | Date): string {
  return dateKeyFormat.format(typeof value === "string" ? new Date(value) : value);
}

/** "Mon 5 Oct" for a plain YYYY-MM-DD date. */
export function formatDateOnly(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return dayFormat.format(new Date(Date.UTC(year, month - 1, date, 6)));
}

/** Minutes since midnight in Colombo for a moment, or for "HH:MM". */
function colomboMinutes(value: Date): number {
  const [hours, minutes] = timeFormat.format(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function windowLabel(outlet: OutletRef | null | undefined): string | null {
  if (!outlet?.window_start || !outlet.window_end) return null;
  return `${outlet.window_start}–${outlet.window_end}`;
}

export type WindowState =
  | { kind: "opens"; minutes: number }
  | { kind: "open"; minutesLeft: number }
  | { kind: "closed"; minutesAgo: number };

/** Where "now" sits against an outlet's window (Colombo wall clock, same day). */
export function windowState(outlet: OutletRef | null | undefined, now = new Date()): WindowState | null {
  if (!outlet?.window_start || !outlet.window_end) return null;
  const current = colomboMinutes(now);
  const opens = clockMinutes(outlet.window_start);
  const closes = clockMinutes(outlet.window_end);
  if (current < opens) return { kind: "opens", minutes: opens - current };
  if (current <= closes) return { kind: "open", minutesLeft: closes - current };
  return { kind: "closed", minutesAgo: current - closes };
}

/** Arrival against the window (brief p15): early waits for it to open; after it
 * closes is late. Mirrors the server's rule so offline records show the same. */
export function arrivalTiming(arrivedIso: string, outlet: OutletRef | null | undefined): StopTiming | null {
  if (!outlet?.window_start && !outlet?.window_end) return null;
  const arrival = colomboMinutes(new Date(arrivedIso));
  if (outlet.window_end && arrival > clockMinutes(outlet.window_end)) {
    return { status: "late", minutes: arrival - clockMinutes(outlet.window_end) };
  }
  if (outlet.window_start && arrival < clockMinutes(outlet.window_start)) {
    return { status: "early", minutes: clockMinutes(outlet.window_start) - arrival };
  }
  return { status: "on_time", minutes: 0 };
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const DOCKS: Record<DockType, string> = {
  rear_dock: "Rear dock",
  street: "Curbside (street)",
  mall_bay: "Shared mall bay",
};

export function dockLabel(dock: DockType | string | null | undefined): string {
  return (dock && DOCKS[dock as DockType]) || "Dock not set";
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const STOP_STATUS: Record<StopStatus, string> = {
  pending: "To deliver",
  arrived: "Arrived",
  delivered: "Delivered",
  partial: "Partly delivered",
  failed: "Not delivered",
  rescheduled: "Removed by dispatch",
};

export function stopStatusLabel(status: StopStatus): string {
  return STOP_STATUS[status] ?? status;
}

/** Finished from the driver's side: removed, or an outcome closed by POD (or failed). */
export function isStopDone(stop: Pick<DriverStop, "status" | "completed_at">): boolean {
  if (stop.status === "rescheduled") return true;
  return ["delivered", "partial", "failed"].includes(stop.status) && Boolean(stop.completed_at);
}

/** The stop to drive to next: the first one not finished. */
export function nextStop<T extends Pick<DriverStop, "status" | "completed_at">>(stops: T[]): T | undefined {
  return stops.find((stop) => !isStopDone(stop));
}

export function runTitle(card: Pick<RunCard, "brand" | "district">): string {
  return [titleCase(card.brand), card.district].filter(Boolean).join(" · ");
}

export function kg(value: number | null | undefined): string {
  if (value == null) return "";
  return `${Math.round(value).toLocaleString("en-GB")} kg`;
}

export function m3(value: number | null | undefined): string {
  if (value == null) return "";
  return `${value.toFixed(1)} m³`;
}
