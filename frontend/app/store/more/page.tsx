"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStoreOutlet } from "@/components/store/outlet-context";
import { UnreadCountText } from "@/components/store/notifications/notification-bell";
import { useAuth } from "@/lib/auth-context";

// Mobile "More" tab (Figma: Mobile / 12 More): pages that don't fit in the bottom nav.
const moreLinks = (outletCode: string | undefined) => [
  {
    title: "Shortfalls & Back-orders",
    description: "Items not sent or received in full",
    href: "/store/requests/shortfalls",
  },
  {
    title: "Store Stock",
    description: "On-hand counts and CSV import",
    href: "/store/stock",
  },
  {
    title: "Delivery History",
    description: "Completed deliveries",
    href: "/store/history",
  },
  {
    title: "Outlet Settings",
    description: `${outletCode ?? "Outlet"} details and delivery setup`,
    href: "/store/settings",
  },
  {
    title: "Notifications",
    description: <UnreadCountText />,
    href: "/store/notifications",
  },
];

export default function StoreMorePage() {
  const { logout } = useAuth();
  const outlet = useStoreOutlet();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">More</h1>
      <Card className="gap-0 py-0">
        <ul className="divide-y divide-border">
          {moreLinks(outlet?.code).map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-11 items-center justify-between gap-3 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-base font-semibold text-foreground">{link.title}</span>
                  <span className="text-sm text-muted-foreground">{link.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {/* Real Keycloak sign-out */}
      <button
        type="button"
        onClick={() => logout(true)}
        className="flex min-h-11 w-fit items-center text-sm font-semibold text-destructive underline-offset-4 hover:underline cursor-pointer"
      >
        Sign out
      </button>
    </div>
  );
}
