"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { getStorePageTitle } from "@/components/store/store-nav";
import { useStoreOutlet } from "@/components/store/outlet-context";
import { NotificationBell } from "@/components/store/notifications/notification-bell";

// Mobile app bar (Figma: Components / Mobile App Bar). Hidden from md up.
export function StoreMobileAppBar() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();
  const outlet = useStoreOutlet();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between bg-primary px-2 text-primary-foreground md:hidden">
      <Button
        variant="ghost"
        className="size-11 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={toggleSidebar}
        aria-label="Open navigation menu"
      >
        <Menu className="size-6" aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-col items-center">
        <p className="truncate text-base font-bold">{getStorePageTitle(pathname)}</p>
        {outlet && (
          <p className="truncate text-sm font-medium text-primary-foreground/70">
            {outlet.code} · {outlet.name}
          </p>
        )}
      </div>

      <NotificationBell tone="inverse" />
    </header>
  );
}
