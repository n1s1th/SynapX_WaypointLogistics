import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { StoreArrowLink, StoreSectionCard } from "@/components/store/store-cards";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { OrderStatusPill, PriorityPill } from "@/components/store/status-pill";
import { formatShortWindow, windowFor } from "@/components/store/format";
import type { StoreOrder, StoreOutlet } from "@/components/store/mock-data";
import { MobileSectionTitle } from "@/components/store/dashboard/mobile-section-title";

const requestHref = (order: StoreOrder) => `/store/requests/${order.orderNumber}`;

export function RecentRequests({
  orders,
  outlet,
  className,
}: {
  orders: StoreOrder[];
  outlet: StoreOutlet | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <StoreSectionCard
        className="hidden h-full xl:flex"
        title="Recent Goods Requests"
        description="Your latest requests"
        action={<StoreArrowLink href="/store/requests">View all</StoreArrowLink>}
      >
        {orders.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">You haven&apos;t placed any requests yet.</p>
        ) : (
          <Table>
            <StoreTableHeader
              columns={[
                { label: "Request ID" },
                { label: "Delivery Window" },
                { label: "Items" },
                { label: "Priority" },
                { label: "Status" },
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
                  <StoreTableCell className="min-w-28 whitespace-normal">
                    {formatShortWindow(order.orderDate, windowFor(order, outlet))}
                  </StoreTableCell>
                  <StoreTableCell>{order.items.length}</StoreTableCell>
                  <StoreTableCell>
                    <PriorityPill isHighPriority={order.isHighPriority} />
                  </StoreTableCell>
                  <StoreTableCell>
                    <OrderStatusPill order={order} />
                  </StoreTableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </StoreSectionCard>

      <section className="flex flex-col gap-4 xl:hidden" aria-labelledby="recent-requests-mobile">
        <MobileSectionTitle id="recent-requests-mobile" title="Recent Requests" viewAllHref="/store/requests" />
        {orders.map((order) => (
          <Card key={order.id} className="gap-2 rounded-lg p-4 ring-border">
            <div className="flex items-center justify-between gap-2">
              <Link href={requestHref(order)} className="text-sm font-bold text-primary">
                {order.orderNumber}
              </Link>
              <OrderStatusPill order={order} />
            </div>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Required by</dt>
                <dd className="text-right font-medium">{formatShortWindow(order.orderDate, windowFor(order, outlet))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Items</dt>
                <dd className="font-medium">{order.items.length}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </section>
    </div>
  );
}
