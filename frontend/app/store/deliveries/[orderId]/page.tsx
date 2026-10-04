import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderReceipt, getStoreOrder, getStoreSession } from "@/components/store/api/store-data";
import { ReceiveDeliveryView } from "@/components/store/deliveries/receive-delivery-view";

export async function generateMetadata({ params }: PageProps<"/store/deliveries/[orderId]">): Promise<Metadata> {
  const { orderId } = await params;
  return { title: `Receive ${orderId.toUpperCase()} | Waypoint Logistics` };
}

// Receiving a delivery: what the depot sent, who brought it, and the manager's count of what arrived.
// The route segment is the order number (e.g. /store/deliveries/ORD0000013).
export default async function ReceiveDeliveryPage({ params }: PageProps<"/store/deliveries/[orderId]">) {
  const { orderId } = await params;
  const [order, { outlet }] = await Promise.all([getStoreOrder(orderId), getStoreSession()]);
  if (!order) notFound();
  const receipt = order.status === "completed" ? await getOrderReceipt(order.id) : null;
  return <ReceiveDeliveryView order={order} outlet={outlet} receipt={receipt} />;
}
