import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { StoreArrowLink, StoreSectionCard } from "@/components/store/store-cards";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { OrderStatusPill, PriorityPill } from "@/components/store/status-pill";
import { formatItemCount, formatRelativeWindow, formatTime, windowFor } from "@/components/store/format";
import type { StoreOrder, StoreOutlet } from "@/components/store/mock-data";
import { MobileSectionTitle } from "@/components/store/dashboard/mobile-section-title";

// Delivery details and receiving (Figma 06) belong to Dev B's flow.
const deliveryHref = (order: StoreOrder) => `/store/deliveries/${order.orderNumber}`;
const requestHref = (order: StoreOrder) => `/store/requests/${order.orderNumber}`;

function windowText(order: StoreOrder, outlet: StoreOutlet | null, now: Date) {
  if (order.status === "delivered" && order.arrivedAt) {
    return `Arrived today, ${formatTime(order.arrivedAt)}`;
  }
  return formatRelativeWindow(order.orderDate, windowFor(order, outlet), now);
}

function DeliveryAction({ order }: { order: StoreOrder }) {
  if (order.status === "delivered") {
    return (
      <Button asChild size="sm" className="h-8 px-3 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90">
        <Link href={deliveryHref(order)}>Confirm Delivery</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm" className="h-8 px-2.5 text-xs font-bold text-primary hover:text-primary hover:bg-secondary">
      <Link href={deliveryHref(order)}>
        View Details
        <span className="sr-only"> for {order.orderNumber}</span>
      </Link>
    </Button>
  );
}

export function UpcomingDeliveries({
  orders,
  outlet,
  now,
}: {
  orders: StoreOrder[];
  outlet: StoreOutlet | null;
  now: Date;
}) {
  return (
    <>
      {/* Desktop: table (Figma 01 Dashboard) */}
      <StoreSectionCard
        className="hidden xl:flex"
        title="Upcoming Deliveries"
        description="Deliveries expected at your store"
        action={<StoreArrowLink href="/store/deliveries">View all deliveries</StoreArrowLink>}
      >
        {orders.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No deliveries scheduled.</p>
        ) : (
          <Table>
            <StoreTableHeader
              columns={[
                { label: "Order ID" },
                { label: "Delivery Window" },
                { label: "Items" },
                { label: "Priority" },
                { label: "Status" },
                { label: "Action" },
              ]}
            />
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <StoreTableCell>
                    <Link href={requestHref(order)} className="font-bold text-primary underline-offset-4 hover:underline">
                      {order.orderNumber}
                    </Link>
                  </StoreTableCell>
                  <StoreTableCell className="min-w-36 whitespace-normal">{windowText(order, outlet, now)}</StoreTableCell>
                  <StoreTableCell>{formatItemCount(order.items.length)}</StoreTableCell>
                  <StoreTableCell>
                    <PriorityPill isHighPriority={order.isHighPriority} />
                  </StoreTableCell>
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
        )}
      </StoreSectionCard>

      {/* Mobile: stacked cards (Figma Mobile / 01 Dashboard) */}
      <section className="flex flex-col gap-4 xl:hidden" aria-labelledby="upcoming-deliveries-mobile">
        <MobileSectionTitle id="upcoming-deliveries-mobile" title="Upcoming Deliveries" viewAllHref="/store/deliveries" />
        {orders
          .filter((order) => order.status !== "delivered")
          .map((order) => (
            <Card key={order.id} className="gap-2 rounded-lg p-4 ring-border">
              <div className="flex items-center justify-between gap-2">
                <Link href={requestHref(order)} className="text-sm font-bold text-primary">
                  {order.orderNumber}
                </Link>
                <OrderStatusPill order={order} context="delivery" />
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Window</dt>
                  <dd className="text-right font-medium">{windowText(order, outlet, now)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="font-medium">{formatItemCount(order.items.length)}</dd>
                </div>
                {order.isHighPriority && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd>
                      <PriorityPill isHighPriority />
                    </dd>
                  </div>
                )}
              </dl>
              <div className="pt-2 flex items-center justify-between">
                {order.deliveryAlert === "vehicle_unavailable" ? (
                  <StoreArrowLink href={deliveryHref(order)}>Choose what happens</StoreArrowLink>
                ) : <span />}
                <Button asChild size="sm" variant="outline" className="text-xs font-bold text-primary border-primary hover:bg-secondary">
                  <Link href={deliveryHref(order)}>View Details</Link>
                </Button>
              </div>
            </Card>
          ))}
      </section>
    </>
  );
}
