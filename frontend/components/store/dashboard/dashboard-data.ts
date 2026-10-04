import type { OrderStatus, StoreIssue, StoreOrder } from "@/components/store/mock-data";
import { isOrderDeferred } from "@/components/store/requests/request-filters";

// Statuses where the depot is still working on the request (Figma "Active Requests").
const ACTIVE_STATUSES: OrderStatus[] = [
  "submitted",
  "confirmed",
  "allocated",
  "processing",
  "ready_for_dispatch",
  "dispatched",
];

// Statuses shown in "Upcoming Deliveries": leaving soon, on the way, or waiting at the dock.
const UPCOMING_DELIVERY_STATUSES: OrderStatus[] = ["ready_for_dispatch", "dispatched", "delivered"];

export type AttentionItem =
  | { kind: "arrival"; order: StoreOrder }
  | { kind: "issue"; issue: StoreIssue }
  | { kind: "deferred"; order: StoreOrder };

export function getDashboardData(orders: StoreOrder[], issues: StoreIssue[]) {
  const active = orders.filter((order) => ACTIVE_STATUSES.includes(order.status));
  const upcomingDeliveries = orders
    .filter((order) => UPCOMING_DELIVERY_STATUSES.includes(order.status))
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.id - b.id);
  const inTransit = upcomingDeliveries.filter((order) => order.status !== "delivered");
  const awaitingConfirmation = orders.filter((order) => order.status === "delivered");
  const deferredOrders = orders.filter(isOrderDeferred);
  const openIssues = issues.filter((issue) => issue.isOpen);
  const nextDelivery = inTransit.find((order) => order.eta);
  const recentRequests = orders
    .filter((order) => order.status !== "draft")
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 3);
  const attentionItems: AttentionItem[] = [
    ...awaitingConfirmation.map((order) => ({ kind: "arrival" as const, order })),
    ...deferredOrders.map((order) => ({ kind: "deferred" as const, order })),
    ...openIssues.map((issue) => ({ kind: "issue" as const, issue })),
  ];

  return {
    active,
    inTransit,
    upcomingDeliveries,
    awaitingConfirmation,
    deferredOrders,
    openIssues,
    nextDelivery,
    recentRequests,
    attentionItems,
  };
}
