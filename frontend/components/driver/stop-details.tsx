"use client";

// What a stop gets and how to unload there: shared by the route and arrival screens.

import { PackageX } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { dockLabel, formatTime, kg } from "@/lib/driver/format";
import type { DriverStop, StopOrder } from "@/lib/driver/types";
import { Pill, StopStatusBadge, TemperatureChip, WindowChip } from "./badges";

export function OrderList({ orders }: { orders: StopOrder[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No order details for this stop.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {orders.map((order) => (
        <li key={order.order_number} className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={order.on_truck ? "text-sm font-semibold" : "text-sm font-semibold text-muted-foreground line-through"}>
              {order.order_number}
            </span>
            <span className="text-xs text-muted-foreground">
              {order.units != null ? `${order.units} units` : ""}
              {order.weight_kg != null ? ` · ${kg(order.weight_kg)}` : ""}
            </span>
          </div>
          {order.on_truck ? (
            <TemperatureChip chilled={order.temperature === "chilled"} />
          ) : (
            <Pill tone="warning" icon={PackageX}>
              Not on truck
            </Pill>
          )}
        </li>
      ))}
    </ul>
  );
}

/** How to get the goods off at this outlet (brief p5: rear dock, curb or mall bay). */
export function AccessFacts({ stop }: { stop: DriverStop }) {
  const outlet = stop.outlet;
  return (
    <div className="flex flex-wrap gap-1.5">
      <WindowChip outlet={outlet} />
      <Pill>{dockLabel(outlet?.dock_type)}</Pill>
      {outlet?.van_only && <Pill tone="warning">Van only</Pill>}
      {outlet?.dock_type === "mall_bay" && <Pill tone="info">Mall access window</Pill>}
    </div>
  );
}

export function StopDetailsSheet({
  stop,
  open,
  onOpenChange,
}: {
  stop: DriverStop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
        {stop && (
          <>
            <SheetHeader className="pb-0">
              <SheetTitle className="text-lg">
                Stop {stop.sequence} · {stop.name}
              </SheetTitle>
              <SheetDescription>
                {stop.outlet ? `${stop.outlet.code} · ${stop.outlet.district}` : stop.address}
                {stop.eta ? ` · ETA ${formatTime(stop.eta)}` : ""}
                {stop.handling_minutes ? ` · ${stop.handling_minutes} min to unload` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-1.5">
                <StopStatusBadge status={stop.status} />
              </div>
              <AccessFacts stop={stop} />
              {stop.removed_reason && (
                <p className="rounded-lg bg-destructive-muted px-3 py-2 text-sm text-destructive">{stop.removed_reason}</p>
              )}
              {stop.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{stop.note}</p>}
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">Orders</h3>
                <OrderList orders={stop.orders} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
