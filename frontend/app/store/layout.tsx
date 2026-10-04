import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { StoreSidebar } from "@/components/store/store-sidebar";
import { StoreTopBar } from "@/components/store/store-top-bar";
import { StoreMobileAppBar } from "@/components/store/store-mobile-app-bar";
import { StoreBottomNav } from "@/components/store/store-bottom-nav";
import { ServiceWorkerCleanup } from "@/components/store/sw-cleanup";
import { StoreOutletProvider } from "@/components/store/outlet-context";
import { ApiError } from "@/components/store/api/client";
import { getStoreSession, type StoreSession } from "@/components/store/api/store-data";
import { StoreAccessNotice } from "@/components/store/store-access-notice";

// Store pages read live data when NEXT_PUBLIC_STORE_DATA_SOURCE=api, so render them per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Store Manager | Waypoint Logistics",
};

export default async function StoreLayout({ children }: LayoutProps<"/store">) {
  // The login decides the outlet. A missing or wrong login gets a sign-in screen, not the store; if the server
  // is just unreachable the shell still renders and pages show their own error.
  let session: StoreSession | null = null;
  try {
    session = await getStoreSession();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      const unassigned = error.message.includes("isn't linked to an outlet");
      return (
        <StoreAccessNotice
          title={unassigned ? "Your store isn't set up yet" : "Store Manager sign-in needed"}
          message={
            unassigned
              ? "Your account isn't linked to an outlet yet. Ask your administrator to assign you to your store, then sign in again."
              : "These screens are for store managers. Sign in with your store manager account."
          }
        />
      );
    }
  }
  const outlet = session?.outlet ?? null;
  const manager = session?.manager ?? null;
  return (
    <StoreOutletProvider outlet={outlet} manager={manager}>
      {/* 15rem instead of Figma's 220px so "Incoming Deliveries" and "Exceptions & Issues" fit without truncating. */}
      <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
        <ServiceWorkerCleanup />
        <StoreSidebar />
        <SidebarInset className="min-w-0 bg-background">
          <StoreMobileAppBar />
          <StoreTopBar outlet={outlet} manager={manager} />
          {/* Bottom padding on mobile keeps content clear of the fixed bottom nav. */}
          <div className="flex-1 px-4 pt-4 pb-24 md:px-14 md:py-8">{children}</div>
          <StoreBottomNav />
          <Toaster position="top-center" />
        </SidebarInset>
      </SidebarProvider>
    </StoreOutletProvider>
  );
}
