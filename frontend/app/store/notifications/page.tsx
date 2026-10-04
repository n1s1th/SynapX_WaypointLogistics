import type { Metadata } from "next";
import { storeNow } from "@/components/store/api/config";
import { getCurrentOutlet } from "@/components/store/api/store-data";
import { NotificationsView } from "@/components/store/notifications/notifications-view";

export const metadata: Metadata = {
  title: "Notifications | Waypoint Logistics",
};

// Figma: Desktop / 10 Notifications and Mobile / 10 Notifications.
export default async function NotificationsPage() {
  const outlet = await getCurrentOutlet().catch(() => null);
  return <NotificationsView outlet={outlet} now={storeNow()} />;
}
