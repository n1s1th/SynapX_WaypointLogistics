import type { Metadata } from "next";
import { OUTLET_UNLOADING } from "@/components/store/mock-data";
import { storeNow } from "@/components/store/api/config";
import {
  getCatalogue,
  getHolidays,
  getStoreOrder,
  getStoreOrders,
  getStoreSession,
  getStoreStock,
} from "@/components/store/api/store-data";
import { NewRequestForm } from "@/components/store/new-request/new-request-form";

export const metadata: Metadata = {
  title: "New Goods Request | Waypoint Logistics",
};

// Figma: 03 New Goods Request, 03b Add Item, 03c Date Picker, 03d Submit Failed (desktop + mobile).
export default async function NewGoodsRequestPage({ searchParams }: PageProps<"/store/requests/new">) {
  const now = storeNow();
  // ?repeat=ORD0000003 starts the request with that order's items and quantities.
  const { repeat } = await searchParams;
  const [existingOrders, holidays, { outlet, manager }, catalogue, stock, repeatOrder] = await Promise.all([
    getStoreOrders(),
    getHolidays(now),
    getStoreSession(),
    getCatalogue(),
    // On-hand counts are a help, not a requirement: the form works without them.
    getStoreStock().catch(() => null),
    typeof repeat === "string" ? getStoreOrder(repeat) : null,
  ]);
  const inCatalogue = new Set(catalogue.map((item) => item.sku));
  const repeatFrom = repeatOrder
    ? {
        orderNumber: repeatOrder.orderNumber,
        items: repeatOrder.items
          .filter((item) => inCatalogue.has(item.sku))
          .map((item) => ({ sku: item.sku, quantity: item.quantity })),
        unavailable: repeatOrder.items.filter((item) => !inCatalogue.has(item.sku)).map((item) => item.itemName),
      }
    : undefined;
  return (
    <NewRequestForm
      // Only the outlet's own brand items, so a Fresh store never sees Style or Tech goods.
      catalogue={catalogue}
      existingOrders={existingOrders}
      stock={stock}
      repeatFrom={repeatFrom}
      holidays={holidays}
      outlet={outlet}
      manager={manager}
      unloading={OUTLET_UNLOADING}
      now={now}
    />
  );
}
