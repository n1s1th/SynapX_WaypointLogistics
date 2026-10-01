"use client";

// Loads the Leaflet map in the browser only (Leaflet needs window), sized per
// variant. `isolate` keeps Leaflet's own z-indexes inside the map so they never
// cover the header or the bottom navigation.

import dynamic from "next/dynamic";
import { CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDriver } from "./driver-provider";
import type { RouteMapProps } from "./route-map";

const LeafletMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-muted" aria-hidden />,
});

const HEIGHTS = {
  full: "h-72",
  preview: "h-48",
  strip: "h-32",
} as const;

export type { MapStop, MapStopStatus } from "./route-map";

export function RouteMap({
  variant = "full",
  className,
  ...props
}: Omit<RouteMapProps, "interactive"> & { variant?: keyof typeof HEIGHTS; className?: string }) {
  const { online } = useDriver();
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-xl border border-border bg-muted",
        HEIGHTS[variant],
        className,
      )}
    >
      <LeafletMap interactive={variant === "full"} {...props} />
      {!online && (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-1000 flex items-center gap-1.5 rounded-lg bg-warning-muted px-2 py-1 text-[11px] font-semibold text-warning">
          <CloudOff className="size-3.5" aria-hidden />
          Offline · map tiles may be missing; stops still show
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1 left-1 z-1000 rounded bg-card/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        ≈ Approximate outlet positions
      </div>
    </div>
  );
}
