import type { Metadata } from "next";
import { getStoreOrders } from "@/components/store/api/store-data";
import { IncomingDeliveriesView } from "@/components/store/deliveries/incoming-deliveries-view";

export const metadata: Metadata = {
  title: "Incoming Deliveries | Waypoint Logistics",
};

// Orders the depot has taken on and not yet handed over: being prepared, on the way, or at the dock waiting
// for the manager to confirm receipt. Vehicle, driver and ETA come from the Dispatcher's allocation and run.
export default async function IncomingDeliveriesPage() {
  const orders = await getStoreOrders();
  return <IncomingDeliveriesView orders={orders} />;
}
