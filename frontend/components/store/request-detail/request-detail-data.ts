import { differenceInMinutes, format, isSameDay, parseISO } from "date-fns";
import type { OrderStatus, OrderStatusTimes, StoreOrder, StoreOrderItem } from "@/components/store/mock-data";

// Progress steps shown on Request Details (Figma 04), mapped from the contract statuses (§1).
export const PROGRESS_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "processing", label: "Being Prepared" },
  { key: "ready_for_dispatch", label: "Ready for Dispatch" },
  { key: "dispatched", label: "Dispatched" },
  { key: "arriving", label: "Arriving" },
  { key: "delivered", label: "Delivered" },
  { key: "completed", label: "Completed" },
] as const satisfies readonly { key: keyof OrderStatusTimes; label: string }[];

const STEP_INDEX: Partial<Record<OrderStatus, number>> = {
  submitted: 0,
  confirmed: 0,
  allocated: 0,
  processing: 1,
  ready_for_dispatch: 2,
  dispatched: 3,
  delivered: 5,
  completed: 6,
};

/** Checks if a dispatched order has an ETA indicating it is actively approaching/arriving. */
export function isArriving(order: StoreOrder): boolean {
  return order.status === "dispatched" && Boolean(order.eta || order.delivery?.estimatedArrival);
}

/** Index of the current step, or null for statuses outside the normal flow (draft, deferred, cancelled). */
export function currentStepIndex(orderOrStatus: StoreOrder | OrderStatus) {
  if (typeof orderOrStatus === "string") {
    return STEP_INDEX[orderOrStatus] ?? null;
  }
  const order = orderOrStatus;
  if (isArriving(order)) {
    return 4; // "arriving" step index
  }
  return STEP_INDEX[order.status] ?? null;
}

const PICKED_STATUSES: OrderStatus[] = ["ready_for_dispatch", "dispatched", "delivered", "completed"];

/** Sent quantity, or undefined while the depot hasn't picked the order yet. */
export function sentQuantity(order: StoreOrder, item: StoreOrderItem) {
  if (item.quantitySent !== undefined) return item.quantitySent;
  return PICKED_STATUSES.includes(order.status) ? item.quantity : undefined;
}

export type Allocation = "full" | "partial" | "none" | "pending";

export function allocationFor(order: StoreOrder, item: StoreOrderItem): Allocation {
  const sent = sentQuantity(order, item);
  if (sent === undefined) return "pending";
  if (sent === 0) return "none";
  return sent < item.quantity ? "partial" : "full";
}

/** "24 Sep, 09:15", or "Today, 05:15" on the mock "today". */
export function stepTime(iso: string, now: Date) {
  const date = parseISO(iso);
  return isSameDay(date, now) ? `Today, ${format(date, "HH:mm")}` : format(date, "d MMM, HH:mm");
}

/** Message for the Delivery card, depending on where the order is. */
export function deliveryMessage(order: StoreOrder, now: Date): { tone: "info" | "success" | "destructive" | "neutral"; text: string } {
  if (order.deliveryAlert === "vehicle_unavailable") {
    return {
      tone: "destructive",
      text: "The planned vehicle is unavailable. The depot is arranging another one — you'll get a notification with the new time.",
    };
  }
  if (order.status === "dispatched" && order.eta) {
    const minutes = Math.max(0, differenceInMinutes(parseISO(order.eta), now));
    return {
      tone: "info",
      text: `Vehicle in transit — arriving in about ${minutes} minutes (${format(parseISO(order.eta), "HH:mm")}).`,
    };
  }
  if (order.status === "delivered") {
    const at = order.arrivedAt ? ` at ${format(parseISO(order.arrivedAt), "HH:mm")}` : "";
    return { tone: "success", text: `Arrived at your rear dock${at}. Count the items and confirm the delivery.` };
  }
  if (order.status === "completed") return { tone: "neutral", text: "Delivered and checked in at your store." };
  return { tone: "neutral", text: "A vehicle is assigned once the depot has prepared your order." };
}
