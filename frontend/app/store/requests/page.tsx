import { mockShortfalls } from "@/components/store/mock-data";
import { STORE_DATA_SOURCE, storeNow } from "@/components/store/api/config";
import { getStoreOrders } from "@/components/store/api/store-data";
import { GoodsRequestsView } from "@/components/store/requests/goods-requests-view";
import { getRequestSummary, isRequestTab } from "@/components/store/requests/request-filters";

// Figma: Desktop / 02 Goods Requests and Mobile / 02 Goods Requests.
export default async function GoodsRequestsPage({ searchParams }: PageProps<"/store/requests">) {
  const { tab } = await searchParams;
  const initialTab = isRequestTab(tab) ? tab : "active";

  const orders = (await getStoreOrders()).filter((order) => order.status !== "draft");
  // Live: the order-level shortfall the API derives from the loader's issues. Mock: the per-item mock list.
  const shortfallOrderNumbers =
    STORE_DATA_SOURCE === "api"
      ? orders.filter((order) => order.shortfall).map((order) => order.orderNumber)
      : [...new Set(mockShortfalls.filter((s) => s.status !== "resolved").map((s) => s.orderNumber))];

  return (
    <GoodsRequestsView
      orders={orders}
      shortfallOrderNumbers={shortfallOrderNumbers}
      initialTab={initialTab}
      summary={getRequestSummary(orders, storeNow())}
    />
  );
}
