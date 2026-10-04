import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brandLabels, type StoreManager, type StoreOutlet } from "@/components/store/mock-data";
import { NotificationBell } from "@/components/store/notifications/notification-bell";
import { StoreUserMenu } from "@/components/store/store-user-menu";

// Desktop top bar (Figma: Components / Top Bar). Hidden on mobile, where StoreMobileAppBar takes over.
export function StoreTopBar({ outlet, manager }: { outlet: StoreOutlet | null; manager: StoreManager | null }) {
  return (
    <header className="hidden shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-6 py-4 md:flex lg:gap-6 lg:px-10">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <p className="truncate text-sm font-bold text-foreground">
          {outlet ? `${outlet.code} — ${brandLabels[outlet.brand]} · ${outlet.district}` : "Outlet unavailable"}
        </p>
        {outlet && (
          <span className="hidden shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground xl:inline">
            Delivery window · {outlet.windowStart} – {outlet.windowEnd}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div role="search" className="relative w-52 lg:w-72">
          <Label htmlFor="store-search" className="sr-only">
            Search orders and deliveries
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="store-search"
            type="search"
            placeholder="Search orders, deliveries…"
            className="h-11 pl-10"
          />
        </div>

        <NotificationBell />

        {manager && <StoreUserMenu manager={manager} outlet={outlet} />}
      </div>
    </header>
  );
}
