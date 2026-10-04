import type { Metadata } from "next";
import { getCatalogue, getStoreStock } from "@/components/store/api/store-data";
import { StoreStockView } from "@/components/store/stock/store-stock-view";

export const metadata: Metadata = {
  title: "Store Stock | Waypoint Logistics",
};

// The store's on-hand list, imported from a CSV stock count. New Request shows these counts in Add Item.
export default async function StoreStockPage() {
  const [stock, catalogue] = await Promise.all([getStoreStock(), getCatalogue()]);
  return <StoreStockView stock={stock} catalogue={catalogue} />;
}
