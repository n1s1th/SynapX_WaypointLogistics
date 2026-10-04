"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  FileText, 
  Map, 
  Truck, 
  MapPin, 
  AlertCircle, 
  CarFront,
  Store, 
  LineChart, 
  PieChart, 
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

import { getDispatcherDepot, DEPOT_CHANGE_EVENT, type DispatcherDepot } from "@/lib/dispatcher-depot";
import { fetchWithFallback } from "@/lib/api";

const navItems = [
  { name: "Dashboard", href: "/dispatcher", icon: LayoutDashboard },
  { name: "Orders", href: "/dispatcher/orders", icon: FileText },
  { name: "Allocations", href: "/dispatcher/allocations", icon: Map },
  { name: "Delivery Runs", href: "/dispatcher/delivery-runs", icon: Truck },
  { name: "Live Tracking", href: "/dispatcher/live-tracking", icon: MapPin },
  { name: "Exceptions", href: "/dispatcher/exceptions", icon: AlertCircle },
  { name: "Fleet", href: "/dispatcher/fleet", icon: CarFront },
  { name: "Outlets", href: "/dispatcher/outlets", icon: Store },
  { name: "Forecasts", href: "/dispatcher/forecasts", icon: LineChart },
  { name: "Analytics", href: "/dispatcher/analytics", icon: PieChart },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { logout } = useAuth();
  const [userName, setUserName] = React.useState<string>("Dispatcher");
  const [depot, setDepot] = React.useState<DispatcherDepot>(getDispatcherDepot());
  const [isAssigned, setIsAssigned] = React.useState<boolean>(true);

  React.useEffect(() => {
    fetchWithFallback("/api/v1/auth/depot-scope", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data.user_name) setUserName(data.user_name);
        if (data.depot) setDepot(data.depot);
        if (data.is_assigned !== undefined) setIsAssigned(data.is_assigned);
      })
      .catch(() => {});

    const onDepotChange = (e: Event) => {
      const customEvent = e as CustomEvent<DispatcherDepot>;
      if (customEvent.detail) setDepot(customEvent.detail);
    };
    window.addEventListener(DEPOT_CHANGE_EVENT, onDepotChange);
    return () => window.removeEventListener(DEPOT_CHANGE_EVENT, onDepotChange);
  }, []);

  const getDepotLabel = () => {
    if (!isAssigned) return "Unassigned Hub";
    return depot === "kandy" ? "Kandy Regional DC" : "Peliyagoda Central DC";
  };

  return (
    <Sidebar>
      <div className="flex h-full flex-col bg-primary text-primary-foreground">
        <SidebarHeader className="gap-2 px-6 pt-8 pb-0">
          <span className="text-xl font-semibold leading-tight">WAYPOINT</span>
          <span className="text-sm text-primary-foreground/70">Dispatch Portal</span>
        </SidebarHeader>
        <SidebarContent className="px-4 pt-8">
          <nav aria-label="Dispatcher">
            <SidebarMenu className="gap-2">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/dispatcher" && pathname.startsWith(`${item.href}/`));
                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive ? true : undefined}
                      className="h-11 gap-4 rounded-lg px-3 font-medium text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground active:bg-primary-foreground/10 active:text-primary-foreground data-active:bg-card data-active:text-primary data-active:hover:bg-card data-active:hover:text-primary [&_svg]:size-6"
                    >
                      <Link href={item.href} aria-current={isActive ? "page" : undefined} onClick={() => setOpenMobile(false)}>
                        <item.icon aria-hidden="true" />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter className="px-4 pt-4 pb-6">
          <div className="flex flex-col gap-2 rounded-lg bg-primary-foreground/10 p-4 text-sm">
            <span className="font-bold">{userName}</span>
            <span className="text-primary-foreground/70">{getDepotLabel()}</span>
            <span className="text-primary-foreground/70">Dispatcher</span>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={() => void logout(true)}
                className="h-11 gap-4 rounded-lg px-3 font-medium text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground [&_svg]:size-6"
              >
                <LogOut aria-hidden="true" />
                <span>Log out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
