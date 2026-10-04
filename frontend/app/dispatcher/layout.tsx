import React from "react";
import { AppSidebar } from "@/components/dispatcher/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

import { DispatcherNavbar } from "@/components/dispatcher/DispatcherNavbar";

export default function DispatcherLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
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
