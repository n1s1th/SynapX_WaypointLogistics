import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { StoreOutlet } from "@/components/store/mock-data";

type OutletWindow = Pick<StoreOutlet, "windowStart" | "windowEnd"> | null;

/** The order's own delivery window when it has one, otherwise the outlet's usual window. */
export function windowFor(order: { deliveryWindow?: { windowStart: string; windowEnd: string } }, outlet: OutletWindow) {
  return order.deliveryWindow ?? outlet;
}

// null when the outlet couldn't be loaded.
const windowLabel = (outlet: OutletWindow) => (outlet ? `${outlet.windowStart} – ${outlet.windowEnd}` : "window unavailable");

/** "Today, 04:00 – 07:45" / "Tomorrow, …" / "Mon 28 Sep, …" — for upcoming deliveries. */
export function formatRelativeWindow(orderDate: string, outlet: OutletWindow, now: Date) {
  const date = parseISO(orderDate);
  const days = differenceInCalendarDays(date, now);
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : format(date, "EEE d MMM");
  return `${day}, ${windowLabel(outlet)}`;
}

/** "26 Sep, 04:00 – 07:45" — for request lists. */
export function formatShortWindow(orderDate: string, outlet: OutletWindow) {
  return `${format(parseISO(orderDate), "d MMM")}, ${windowLabel(outlet)}`;
}

/** "06:10" */
export function formatTime(isoDateTime: string) {
  return format(parseISO(isoDateTime), "HH:mm");
}

/** "24 Sep 2026" */
export function formatLongDate(isoDate: string) {
  return format(parseISO(isoDate), "d MMM yyyy");
}

/** "09:15 AM" */
export function formatClockTime(isoDateTime: string) {
  return format(parseISO(isoDateTime), "hh:mm a");
}

export function formatDeliveryWindow(outlet: OutletWindow) {
  return windowLabel(outlet);
}

export function formatUnitCount(count: number) {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}

export function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
