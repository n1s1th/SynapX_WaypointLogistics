import { differenceInCalendarDays, endOfDay, isWithinInterval, parseISO, startOfDay } from "date-fns";
import type { OrderStatus, StoreOrder } from "@/components/store/mock-data";

export type RequestTab =
  | "active"
  | "arrived"
  | "in_progress"
  | "completed"
  | "deferred"
  | "cancelled"
  | "shortfalls"
  | "all";

export type PriorityFilter = "all" | "high" | "default";

const TAB_STATUSES: Partial<Record<RequestTab, OrderStatus[]>> = {
  active: ["submitted", "confirmed", "allocated", "processing", "ready_for_dispatch", "dispatched"],
  arrived: ["delivered"],
  in_progress: ["processing", "ready_for_dispatch"],
  completed: ["completed"],
  deferred: ["deferred"],
  cancelled: ["cancelled"],
};

// Desktop tab order (Figma 02). Mobile chips put Shortfalls second.
export const requestTabs: { value: RequestTab; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "arrived", label: "Arrived" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "deferred", label: "Deferred" },
  { value: "cancelled", label: "Cancelled" },
  { value: "shortfalls", label: "Shortfalls" },
  { value: "all", label: "All" },
];

export function isRequestTab(value: unknown): value is RequestTab {
  return requestTabs.some((tab) => tab.value === value);
}

/** An order is deferred if fully deferred, has a deferral reason, or has line-item partial deferral. */
export function isOrderDeferred(order: StoreOrder): boolean {
  if (order.status === "deferred") return true;
  if (Boolean(order.deferralReason)) return true;
  if (order.items.some((item) => item.quantitySent !== undefined && item.quantitySent < item.quantity)) return true;
  if (order.items.some((item) => Boolean(item.dispatcherNote || item.depotNote))) return true;
  return false;
}

export function ordersInTab(
  orders: StoreOrder[],
  tab: RequestTab,
  shortfallOrderNumbers: Set<string>
) {
  if (tab === "all") return orders.filter((order) => order.status !== "draft");
  if (tab === "shortfalls") return orders.filter((order) => shortfallOrderNumbers.has(order.orderNumber));
  if (tab === "deferred") return orders.filter(isOrderDeferred);
  const statuses = TAB_STATUSES[tab] ?? [];
  return orders.filter((order) => statuses.includes(order.status));
}

export interface RequestFilters {
  search: string;
  priority: PriorityFilter;
  from?: Date;
  to?: Date;
}

export function applyRequestFilters(orders: StoreOrder[], filters: RequestFilters) {
  const query = filters.search.trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.priority === "high" && !order.isHighPriority) return false;
    if (filters.priority === "default" && order.isHighPriority) return false;
    if (filters.from) {
      const submitted = parseISO(order.submittedAt);
      const interval = { start: startOfDay(filters.from), end: endOfDay(filters.to ?? filters.from) };
      if (!isWithinInterval(submitted, interval)) return false;
    }
    if (!query) return true;
    return (
      order.orderNumber.toLowerCase().includes(query) ||
      order.items.some(
        (item) => item.itemName.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query)
      )
    );
  });
}

export const totalUnits = (order: StoreOrder) => order.items.reduce((sum, item) => sum + item.quantity, 0);

/** Numbers for the Goods Requests summary cards (Figma 02). */
export function getRequestSummary(orders: StoreOrder[], now: Date) {
  const noShortfalls = new Set<string>();
  const inTransit = orders.filter((order) => order.status === "dispatched");
  return {
    active: ordersInTab(orders, "active", noShortfalls).length,
    arrived: ordersInTab(orders, "arrived", noShortfalls).length,
    inPreparation: orders.filter((order) => order.status === "processing").length,
    inTransit: inTransit.length,
    nextInTransit: inTransit.find((order) => order.eta),
    deferred: orders.filter(isOrderDeferred).length,
    completed30d: orders.filter(
      (order) => order.status === "completed" && differenceInCalendarDays(now, parseISO(order.orderDate)) <= 30
    ).length,
  };
}
