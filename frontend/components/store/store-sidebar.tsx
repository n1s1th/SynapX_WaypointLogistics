"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { isStoreNavActive, storeSidebarItems } from "@/components/store/store-nav";
import { brandLabels } from "@/components/store/mock-data";
import { useStoreManager, useStoreOutlet } from "@/components/store/outlet-context";

export function StoreSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const outlet = useStoreOutlet();
  const manager = useStoreManager();

  return (
    <Sidebar>
      {/* The mobile sidebar renders in a portal, so the Store Manager colour is set here rather than on the provider. */}
      <div className="flex h-full flex-col bg-primary text-primary-foreground">
        <SidebarHeader className="gap-2 px-6 pt-8 pb-0">
          <span className="text-xl font-semibold leading-tight">STORE OPS</span>
          <span className="text-sm text-primary-foreground/70">Store Manager Portal</span>
        </SidebarHeader>

        <SidebarContent className="px-4 pt-8">
          <nav aria-label="Store Manager">
            <SidebarMenu className="gap-2">
              {storeSidebarItems.map((item) => {
                const isActive = isStoreNavActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      // Only set the attribute when active so `data-active:` styles don't match inactive items.
                      data-active={isActive ? true : undefined}
                      className="h-11 gap-4 rounded-lg px-3 font-medium text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground active:bg-primary-foreground/10 active:text-primary-foreground data-active:bg-card data-active:text-primary data-active:hover:bg-card data-active:hover:text-primary [&_svg]:size-6"
                    >
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.title}</span>
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
            <span className="font-bold">{outlet?.code ?? "Outlet unavailable"}</span>
            {outlet && (
              <span className="text-primary-foreground/70">
                {brandLabels[outlet.brand]} · {outlet.district}
              </span>
            )}
            {manager && (
              <span className="text-primary-foreground/70">{manager.fullName} · Store Manager</span>
            )}
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
