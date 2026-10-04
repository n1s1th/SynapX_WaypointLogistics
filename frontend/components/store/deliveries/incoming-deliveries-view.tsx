"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Phone, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { StoreMetricCard } from "@/components/store/store-cards";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { OrderStatusPill } from "@/components/store/status-pill";
import { TemperaturePill } from "@/components/store/new-request/add-item-picker";
import { formatDeliveryWindow, formatLongDate, formatUnitCount, windowFor } from "@/components/store/format";
import { useStoreOutlet } from "@/components/store/outlet-context";
import type { OrderStatus, StoreOrder } from "@/components/store/mock-data";

type Stage = "at_dock" | "on_the_way" | "preparing";

const STAGE_OF: Partial<Record<OrderStatus, Stage>> = {
  delivered: "at_dock",
  dispatched: "on_the_way",
  allocated: "preparing",
  processing: "preparing",
  ready_for_dispatch: "preparing",
};

const filters: { value: "all" | Stage; label: string }[] = [
  { value: "all", label: "All" },
  { value: "at_dock", label: "At your dock" },
  { value: "on_the_way", label: "On the way" },
  { value: "preparing", label: "Being prepared" },
];

const units = (order: StoreOrder) => order.items.reduce((sum, item) => sum + (item.quantitySent ?? item.quantity), 0);
const time = (iso?: string) => (iso ? format(parseISO(iso), "HH:mm") : null);

/** What the store knows about arrival, without guessing. */
function arrivalText(order: StoreOrder) {
  const delivery = order.delivery;
  if (order.status === "delivered") {
    return delivery?.actualArrival ? `Arrived ${time(delivery.actualArrival)}` : "Arrived";
  }
  if (order.status === "dispatched") {
    return delivery?.estimatedArrival ? `ETA ${time(delivery.estimatedArrival)}` : "On the way · no ETA yet";
  }
  if (delivery?.departureTime) return `Leaves depot ${format(parseISO(delivery.departureTime), "d MMM, HH:mm")}`;
  return "Departure not scheduled yet";
}

export function IncomingDeliveriesView({ orders }: { orders: StoreOrder[] }) {
  const outlet = useStoreOutlet();
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [search, setSearch] = useState("");

  const incoming = useMemo(
    () =>
      orders
        .filter((order) => STAGE_OF[order.status])
        // At the dock first, then the soonest delivery date.
        .sort(
          (a, b) =>
            Number(b.status === "delivered") - Number(a.status === "delivered") ||
            a.orderDate.localeCompare(b.orderDate)
        ),
    [orders]
  );
  const count = (stage: Stage) => incoming.filter((order) => STAGE_OF[order.status] === stage).length;

  const visible = incoming.filter((order) => {
    if (filter !== "all" && STAGE_OF[order.status] !== filter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [order.orderNumber, order.delivery?.driverName, order.delivery?.vehicleCode].some((value) =>
      value?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">Incoming Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Orders the depot is preparing or bringing to {outlet ? `${outlet.code} ${outlet.name}` : "your store"}, and
          deliveries waiting for you to confirm what arrived.
        </p>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 xl:grid-cols-3 xl:gap-[30px]">
        <StoreMetricCard label="At your dock" value={count("at_dock")} caption="Waiting for you to receive" />
        <StoreMetricCard label="On the way" value={count("on_the_way")} caption="Left the depot" />
        <StoreMetricCard
          className="col-span-2 xl:col-span-1"
          label="Being prepared"
          value={count("preparing")}
          caption="Allocated or loading at the depot"
        />
      </section>

      <Card className="gap-4 rounded-lg p-4 ring-border md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div role="group" aria-label="Delivery stage" className="flex gap-2 overflow-x-auto">
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "min-h-11 shrink-0 rounded-md border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9",
                  filter === option.value
                    ? "border-primary bg-primary font-bold text-primary-foreground"
                    : "border-input bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label} ({option.value === "all" ? incoming.length : count(option.value)})
              </button>
            ))}
          </div>
          <div className="relative md:w-72">
            <Label htmlFor="delivery-search" className="sr-only">
              Search order, driver or vehicle
            </Label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="delivery-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order, driver or vehicle"
              className="h-11 bg-card pl-10"
            />
          </div>
        </div>

        {incoming.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing on its way yet. Orders show here once the depot allocates them to a vehicle.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No deliveries match.</p>
        ) : (
          <>
            <Table className="hidden md:table">
              <StoreTableHeader
                columns={[
                  { label: "Order" },
                  { label: "Delivery" },
                  { label: "Vehicle & driver" },
                  { label: "Arrival" },
                  { label: "Status" },
                  { label: "Action", className: "text-transparent select-none" },
                ]}
              />
              <TableBody>
                {visible.map((order) => (
                  <TableRow key={order.orderNumber} className="hover:bg-transparent">
                    <StoreTableCell>
                      <Link href={`/store/requests/${order.orderNumber}`} className="block font-bold text-primary">
                        {order.orderNumber}
                      </Link>
                      <span className="mt-2 flex items-center gap-2 text-muted-foreground">
                        <TemperaturePill value={order.temperatureClass} />
                        {formatUnitCount(units(order))}
                      </span>
                    </StoreTableCell>
                    <StoreTableCell>
                      <span className="block font-medium">{formatLongDate(order.orderDate)}</span>
                      <span className="mt-2 block text-muted-foreground">
                        {formatDeliveryWindow(windowFor(order, outlet))}
                      </span>
                    </StoreTableCell>
                    <StoreTableCell className="whitespace-normal">
                      <VehicleAndDriver order={order} />
                    </StoreTableCell>
                    <StoreTableCell>{arrivalText(order)}</StoreTableCell>
                    <StoreTableCell>
                      <OrderStatusPill order={order} context="delivery" />
                    </StoreTableCell>
                    <StoreTableCell>
                      <DeliveryAction order={order} />
                    </StoreTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ul className="flex flex-col divide-y divide-border md:hidden">
              {visible.map((order) => (
                <li key={order.orderNumber} className="flex flex-col gap-3 py-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/store/requests/${order.orderNumber}`} className="font-bold text-primary">
                      {order.orderNumber}
                    </Link>
                    <OrderStatusPill order={order} context="delivery" />
                  </div>
                  <dl className="flex flex-col gap-2">
                    <Row label="Delivery">
                      {format(parseISO(order.orderDate), "d MMM")}, {formatDeliveryWindow(windowFor(order, outlet))}
                    </Row>
                    <Row label="Arrival">{arrivalText(order)}</Row>
                    <Row label="Vehicle">
                      <VehicleAndDriver order={order} />
                    </Row>
                  </dl>
                  <DeliveryAction order={order} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function VehicleAndDriver({ order }: { order: StoreOrder }) {
  const delivery = order.delivery;
  if (!delivery?.vehicleCode && !delivery?.driverName) {
    return <span className="text-muted-foreground">Not assigned yet</span>;
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">
        {delivery.vehicleCode ?? "Vehicle not set"}
        {delivery.temperatureMode === "reefer" ? " · reefer" : ""}
      </span>
      <span className="text-muted-foreground">{delivery.driverName ?? "Driver not assigned"}</span>
      {delivery.driverPhone && (
        <a
          href={`tel:${delivery.driverPhone}`}
          className="flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline md:min-h-0"
        >
          <Phone className="size-4" aria-hidden="true" />
          {delivery.driverPhone}
        </a>
      )}
    </span>
  );
}

// Receiving is open once the goods have left the depot: the truck may reach the dock before the driver marks
// the stop delivered.
function DeliveryAction({ order }: { order: StoreOrder }) {
  if (order.status === "delivered" || order.status === "dispatched") {
    return (
      <Button asChild className="h-11 px-4 text-base font-bold md:h-10">
        <Link href={`/store/deliveries/${order.orderNumber}`}>Receive delivery</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10">
      <Link href={`/store/requests/${order.orderNumber}`}>View order</Link>
    </Button>
  );
}
