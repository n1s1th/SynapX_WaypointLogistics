"use client";

import Link from "next/link";
import { LogOut, SlidersVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brandLabels, type StoreManager, type StoreOutlet } from "@/components/store/mock-data";
import { useAuth } from "@/lib/auth-context";

// The initials in the top bar open the account menu: who is signed in, their outlet, and sign out.
export function StoreUserMenu({ manager, outlet }: { manager: StoreManager; outlet: StoreOutlet | null }) {
  const { logout } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Account menu for ${manager.fullName}`}
      >
        <span aria-hidden="true">{manager.initials}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
          <span className="font-semibold text-foreground">{manager.fullName}</span>
          <span className="text-xs text-muted-foreground">
            Store Manager
            {outlet ? ` · ${outlet.code} ${brandLabels[outlet.brand]} ${outlet.district}` : ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/store/settings">
            <SlidersVertical aria-hidden="true" />
            Outlet settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void logout(true)}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
