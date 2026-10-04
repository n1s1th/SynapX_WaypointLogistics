import {
  Bell,
  ClipboardList,
  Ellipsis,
  History,
  House,
  LayoutGrid,
  Package,
  SlidersVertical,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";

export interface StoreNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const STORE_HOME = "/store";

// Desktop sidebar (Figma: Components / Sidebar).
export const storeSidebarItems: StoreNavItem[] = [
  { title: "Dashboard", href: STORE_HOME, icon: LayoutGrid },
  { title: "Goods Requests", href: "/store/requests", icon: ClipboardList },
  { title: "Store Stock", href: "/store/stock", icon: Package },
  { title: "Incoming Deliveries", href: "/store/deliveries", icon: Truck },
  { title: "Delivery History", href: "/store/history", icon: History },
  { title: "Exceptions & Issues", href: "/store/issues", icon: TriangleAlert },
  { title: "Outlet Settings", href: "/store/settings", icon: SlidersVertical },
  { title: "Notifications", href: "/store/notifications", icon: Bell },
];

// Mobile bottom navigation (Figma: Components / Mobile Bottom Nav).
export const storeBottomNavItems: StoreNavItem[] = [
  { title: "Home", href: STORE_HOME, icon: House },
  { title: "Orders", href: "/store/requests", icon: ClipboardList },
  { title: "Arrivals", href: "/store/deliveries", icon: Truck },
  { title: "Issues", href: "/store/issues", icon: TriangleAlert },
  { title: "More", href: "/store/more", icon: Ellipsis },
];

// Pages reached through the mobile "More" tab.
export const storeMoreHrefs = [
  "/store/more",
  "/store/stock",
  "/store/history",
  "/store/settings",
  "/store/notifications",
];

export function isStoreNavActive(pathname: string, href: string) {
  if (href === STORE_HOME) return pathname === STORE_HOME;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const pageTitles: { href: string; title: string }[] = [
  { href: "/store/requests/new", title: "New Request" },
  { href: "/store/requests", title: "Goods Requests" },
  { href: "/store/stock", title: "Store Stock" },
  { href: "/store/deliveries", title: "Incoming Deliveries" },
  { href: "/store/history", title: "Delivery History" },
  { href: "/store/issues", title: "Exceptions & Issues" },
  { href: "/store/settings", title: "Outlet Settings" },
  { href: "/store/notifications", title: "Notifications" },
  { href: "/store/more", title: "More" },
];

export function getStorePageTitle(pathname: string) {
  // Request Details shows the order number in the mobile app bar (Figma Mobile / 04).
  const orderMatch = pathname.match(/^\/store\/requests\/(ORD\d+)$/i);
  if (orderMatch) return orderMatch[1].toUpperCase();
  return (
    pageTitles.find((page) => isStoreNavActive(pathname, page.href))?.title ??
    "Dashboard"
  );
}
