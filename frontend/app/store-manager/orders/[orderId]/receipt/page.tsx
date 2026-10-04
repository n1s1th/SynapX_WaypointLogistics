import { redirect } from "next/navigation";

// Receiving lives at /store/deliveries/[orderNumber] (inside the Store Manager shell, scoped to the login).
export default async function ReceiptRedirect({ params }: PageProps<"/store-manager/orders/[orderId]/receipt">) {
  const { orderId } = await params;
  redirect(`/store/deliveries/${encodeURIComponent(orderId)}`);
}
