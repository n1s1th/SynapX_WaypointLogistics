import React, { type CSSProperties } from "react";
import { AppSidebar } from "@/components/dispatcher/AppSidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { DispatcherNavbar } from "@/components/dispatcher/DispatcherNavbar";

export default function DispatcherLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
        <AppSidebar />
        <SidebarInset className="bg-background overflow-hidden flex flex-col h-screen">
          <DispatcherNavbar />
          <main className="flex-1 overflow-auto p-6 sm:p-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
