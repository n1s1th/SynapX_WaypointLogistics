"use client";

// The frame every driver screen shares: a header with the real connection and
// sync state, the page, the bottom navigation and the SOS button. Phone first,
// touch targets at least 44 px (frontend/AGENTS.md).

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Home, Layers, Map as MapIcon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/driver/format";
import { useNow } from "@/lib/driver/hooks";
import { useDriver } from "./driver-provider";
import { SyncChip } from "./sync-chip";

export type DriverTab = "home" | "route" | "report" | "queue";

interface DriverShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Where the back arrow goes; no arrow when omitted. */
  backHref?: string;
  /** Right side of the title bar (e.g. the profile button). */
  action?: React.ReactNode;
  /** Highlighted tab; omit to hide the bottom navigation (focused task screens). */
  tab?: DriverTab | null;
  /** The floating SOS button (on by default). */
  sos?: boolean;
  /** Sticky footer for the screen's main action. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DriverShell({
  title,
  subtitle,
  backHref,
  action,
  tab = null,
  sos = true,
  footer,
  children,
  className,
}: DriverShellProps) {
  const now = useNow();
  const showNav = tab !== null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="flex h-8 items-center justify-between px-4 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums" aria-label="Depot time">
            {now ? formatTime(now.toISOString()) : "--:--"} · Colombo
          </span>
          <SyncChip />
        </div>
        <div className="flex min-h-14 items-center gap-2 px-4 pb-2">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Back"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronLeft className="size-6" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-bold">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      </header>

      <main
        className={cn(
          "flex flex-1 flex-col gap-4 px-4 pt-4",
          showNav ? "pb-28" : footer ? "pb-32" : "pb-8",
          className,
        )}
      >
        {children}
      </main>

      {footer && (
        <div
          className={cn(
            "fixed inset-x-0 z-30 border-t border-border bg-card px-4 py-3",
            showNav ? "bottom-17" : "bottom-0",
          )}
        >
          {/* Above the footer's top edge, whatever its height: never over its buttons. */}
          {sos && <SosButton className="absolute right-4 -top-17" />}
          <div className="mx-auto flex max-w-lg flex-col gap-2">{footer}</div>
        </div>
      )}

      {sos && !footer && <SosButton className={cn("fixed right-4", showNav ? "bottom-20" : "bottom-5")} />}
      {showNav && <BottomNav tab={tab} />}
    </div>
  );
}

function SosButton({ className }: { className: string }) {
  return (
    <Link
      href="/driver/sos"
      aria-label="SOS emergency"
      className={cn(
        "z-40 flex size-14 items-center justify-center rounded-full bg-destructive text-sm font-extrabold text-white shadow-lg",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px",
        className,
      )}
    >
      SOS
    </Link>
  );
}

const TABS: { tab: DriverTab; href: string; label: string; icon: typeof Home }[] = [
  { tab: "home", href: "/driver", label: "Home", icon: Home },
  { tab: "route", href: "/driver/trip", label: "Route", icon: MapIcon },
  { tab: "report", href: "/driver/report", label: "Report", icon: TriangleAlert },
  { tab: "queue", href: "/driver/queue", label: "Queue", icon: Layers },
];

function BottomNav({ tab }: { tab: DriverTab }) {
  const { pendingCount, conflictCount } = useDriver();
  const queueBadge = conflictCount + pendingCount;
  return (
    <nav
      aria-label="Driver"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-17 max-w-lg items-stretch justify-around">
        {TABS.map((item) => {
          const active = item.tab === tab;
          const Icon = item.icon;
          return (
            <li key={item.tab} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5.5" aria-hidden />
                <span className={active ? "font-bold" : undefined}>{item.label}</span>
                {item.tab === "queue" && queueBadge > 0 && (
                  <span
                    className={cn(
                      "absolute top-2 left-1/2 ml-2 min-w-5 rounded-full px-1.5 text-center text-[10px] leading-5 font-bold text-white",
                      conflictCount > 0 ? "bg-destructive" : "bg-warning",
                    )}
                    aria-label={`${queueBadge} records waiting`}
                  >
                    {queueBadge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
