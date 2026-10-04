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
  Command
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
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
  const [userName, setUserName] = React.useState<string>("Dispatcher");
  const [userRole, setUserRole] = React.useState<string>("DISPATCHER");
  const [depot, setDepot] = React.useState<DispatcherDepot>(getDispatcherDepot());
  const [isAssigned, setIsAssigned] = React.useState<boolean>(true);

  React.useEffect(() => {
    fetchWithFallback("/api/v1/auth/depot-scope", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data.user_name) setUserName(data.user_name);
        if (data.user_role) setUserRole(data.user_role);
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

  const getInitials = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getDepotLabel = () => {
    if (!isAssigned) return "Unassigned Hub";
    return depot === "kandy" ? "Kandy Regional DC" : "Peliyagoda Central DC";
  };

  return (
    <Sidebar variant="inset">
      <SidebarHeader className="p-4 flex items-center justify-start flex-row h-16 border-b border-sidebar-border">
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Command className="size-4" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight ml-3">
          <span className="truncate font-semibold text-sidebar-foreground">WAYPOINT</span>
          <span className="truncate text-xs text-sidebar-foreground/70">Dispatch Portal</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2 pt-4">
        <SidebarMenu>
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dispatcher" && pathname.startsWith(`${item.href}/`));
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton 
                  asChild 
                  isActive={isActive} 
                  tooltip={item.name}
                  className="font-medium text-[13px] h-9"
                >
                  <Link href={item.href} aria-current={isActive ? "page" : undefined}>
                    <item.icon className="size-4" />
                    <span>{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t border-sidebar-border">
        {/* Dynamic User Account Footer */}
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-semibold text-xs border border-border shrink-0">
            {getInitials(userName)}
          </div>
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <span className="text-xs font-semibold text-sidebar-foreground truncate">{userName}</span>
            <span className={`text-[11px] truncate font-medium ${!isAssigned ? "text-amber-600 font-semibold" : "text-sidebar-foreground/70"}`}>
              {getDepotLabel()}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
