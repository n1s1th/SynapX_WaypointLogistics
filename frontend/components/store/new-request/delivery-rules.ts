import { addDays, format, formatDistanceStrict, isBefore, parseISO, setHours, startOfDay, subDays } from "date-fns";
import type { Brand, StoreOrder, TemperatureClass } from "@/components/store/mock-data";

// Business rules from docs/reference/store-manager-contract.md §6 and the kickoff answers (Q1–Q3).
// The backend's OrderService will enforce the same rules; these give instant feedback in the form.

const CUTOFF_HOUR = 16; // 4 PM, Asia/Colombo

const toKey = (date: Date) => format(date, "yyyy-MM-dd");

export function isOperatingDay(date: Date, holidays: { date: string }[]) {
  if (date.getDay() === 0) return false; // No deliveries on Sundays
  return !holidays.some((holiday) => holiday.date === toKey(date));
}

export function holidayName(date: Date, holidays: { date: string; name: string }[]) {
  if (date.getDay() === 0) return "Sunday";
  return holidays.find((holiday) => holiday.date === toKey(date))?.name;
}

/** Orders for a delivery date close at 4 PM the day before (Q2). */
export function cutoffFor(deliveryDate: Date) {
  return setHours(startOfDay(subDays(deliveryDate, 1)), CUTOFF_HOUR);
}

/** Cutoff is strict: exactly 16:00:00 is already too late. */
export function isPastCutoff(deliveryDate: Date, now: Date) {
  return !isBefore(now, cutoffFor(deliveryDate));
}

function nthOperatingDayAfter(from: Date, n: number, holidays: { date: string }[]) {
  let date = startOfDay(from);
  let found = 0;
  while (found < n) {
    date = addDays(date, 1);
    if (isOperatingDay(date, holidays)) found += 1;
  }
  return date;
}

/** Default = 2 operating days out, High Priority = next operating day, both after the cutoff (Q3). */
export function earliestDeliveryDate(now: Date, isHighPriority: boolean, holidays: { date: string }[]) {
  let date = nthOperatingDayAfter(now, isHighPriority ? 1 : 2, holidays);
  while (isPastCutoff(date, now)) date = nthOperatingDayAfter(date, 1, holidays);
  return date;
}

export function isSelectableDeliveryDate(
  date: Date,
  now: Date,
  isHighPriority: boolean,
  holidays: { date: string }[]
) {
  return (
    isOperatingDay(date, holidays) &&
    !isBefore(startOfDay(date), earliestDeliveryDate(now, isHighPriority, holidays))
  );
}

/** "1d 10h" style countdown to the cutoff for the chosen date. */
export function timeUntilCutoff(deliveryDate: Date, now: Date) {
  return formatDistanceStrict(now, cutoffFor(deliveryDate));
}

/**
 * Fresh outlets may have one chilled and one ambient order per delivery date; Style and Tech one order per date.
 * Returns the temperature classes that clash with an existing order, if any.
 */
export function findDuplicateOrders(
  existing: StoreOrder[],
  brand: Brand,
  deliveryDate: Date,
  temperatureClasses: TemperatureClass[]
) {
  const dateKey = toKey(deliveryDate);
  const sameDay = existing.filter(
    (order) => order.orderDate === dateKey && order.status !== "cancelled" && order.status !== "draft"
  );
  if (brand !== "fresh") return sameDay.length > 0 ? sameDay : [];
  return sameDay.filter((order) => temperatureClasses.includes(order.temperatureClass));
}

/** Next order numbers after the highest existing one, e.g. ORD0000023. */
export function nextOrderNumbers(existing: StoreOrder[], count: number) {
  const highest = Math.max(0, ...existing.map((order) => Number(order.orderNumber.replace(/\D/g, "")) || 0));
  return Array.from({ length: count }, (_, i) => `ORD${String(highest + 1 + i).padStart(7, "0")}`);
}

export const parseDateKey = (key: string) => parseISO(key);
export const dateKey = toKey;
