import { redirect } from "next/navigation";

// Older receipt link: receiving lives at /store/deliveries/[orderNumber].
export default async function ReceiptRedirect({ params }: PageProps<"/store/receipt/[orderId]">) {
  const { orderId } = await params;
  redirect(`/store/deliveries/${encodeURIComponent(orderId)}`);
}
