"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DateRange } from "react-day-picker";
import { Download, Plus, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoreArrowLink, StoreMetricCard } from "@/components/store/store-cards";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { OrderStatusPill, PriorityPill } from "@/components/store/status-pill";
import {
  formatClockTime,
  formatDeliveryWindow,
  formatItemCount,
  formatLongDate,
  formatShortWindow,
  windowFor,
  formatTime,
  formatUnitCount,
} from "@/components/store/format";
import { downloadCsv } from "@/components/store/csv";
import { type StoreOrder } from "@/components/store/mock-data";
import { useStoreOutlet } from "@/components/store/outlet-context";
import { DateRangeFilter } from "@/components/store/requests/date-range-filter";
import {
  applyRequestFilters,
  getRequestSummary,
  isOrderDeferred,
  ordersInTab,
  requestTabs,
  totalUnits,
  type PriorityFilter,
  type RequestTab,
} from "@/components/store/requests/request-filters";

const PAGE_SIZE = 8;

const requestHref = (order: StoreOrder) => `/store/requests/${order.orderNumber}`;

export function GoodsRequestsView({
  orders,
  shortfallOrderNumbers,
  initialTab,
  summary,
}: {
  orders: StoreOrder[];
  shortfallOrderNumbers: string[];
  initialTab: RequestTab;
  summary: ReturnType<typeof getRequestSummary>;
}) {
  const outlet = useStoreOutlet();
  const [tab, setTab] = useState<RequestTab>(initialTab);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [page, setPage] = useState(1);

  const shortfalls = useMemo(() => new Set(shortfallOrderNumbers), [shortfallOrderNumbers]);
  const sorted = useMemo(
    () => [...orders].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [orders]
  );
  const tabCounts = useMemo(
    () => Object.fromEntries(requestTabs.map((t) => [t.value, ordersInTab(sorted, t.value, shortfalls).length])),
    [sorted, shortfalls]
  );
  const filtered = useMemo(
    () =>
      applyRequestFilters(ordersInTab(sorted, tab, shortfalls), {
        search,
        priority,
        from: dateRange?.from,
        to: dateRange?.to,
      }),
    [sorted, tab, shortfalls, search, priority, dateRange]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = search !== "" || priority !== "all" || dateRange?.from !== undefined;

  const changeTab = (value: string) => {
    setTab(value as RequestTab);
    setPage(1);
    // Keep the tab in the URL so links like /store/requests?tab=shortfalls work and refresh keeps the view.
    window.history.replaceState(null, "", value === "active" ? "/store/requests" : `?tab=${value}`);
  };

  const clearFilters = () => {
    setSearch("");
    setPriority("all");
    setDateRange(undefined);
    setPage(1);
  };

  const exportCsv = () =>
    downloadCsv(
      `goods-requests-${outlet?.code ?? "outlet"}-${tab}.csv`,
      ["Request ID", "Request date", "Delivery date", "Delivery window", "Items", "Units", "Priority", "Status"],
      filtered.map((order) => [
        order.orderNumber,
        order.submittedAt,
        order.orderDate,
        formatDeliveryWindow(windowFor(order, outlet)),
        order.items.length,
        totalUnits(order),
        order.isHighPriority ? "High" : "Default",
        order.status,
      ])
    );

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">Goods Requests</h1>
          <p className="text-sm text-muted-foreground">
            Request goods from the central depot and track fulfillment progress.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 pt-2 md:flex-row md:gap-4 md:pt-0">
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="hidden h-10 border-2 border-primary px-4 text-base font-bold md:inline-flex"
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
          <Button asChild className="h-11 px-4 text-base font-bold md:h-10">
            <Link href="/store/requests/new">
              <Plus aria-hidden="true" />
              New Goods Request
            </Link>
          </Button>
        </div>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 xl:gap-[30px]">
        <StoreMetricCard label="Active Requests" value={summary.active} caption="In progress" />
        <StoreMetricCard
          className="hidden md:flex"
          label="Arrived"
          value={summary.arrived}
          caption="Awaiting your receiving"
        />
        <StoreMetricCard
          className="hidden md:flex"
          label="In Preparation"
          value={summary.inPreparation}
          caption="On the depot floor"
        />
        <StoreMetricCard
          className="hidden md:flex"
          label="In Transit"
          value={summary.inTransit}
          caption={
            summary.nextInTransit?.eta
              ? `${summary.nextInTransit.orderNumber} · ETA ${formatTime(summary.nextInTransit.eta)}`
              : "None on the road"
          }
        />
        <StoreMetricCard
          label="Completed (30d)"
          value={summary.completed30d}
          caption="Received at store"
          mobileCaption="Received"
        />
      </section>

      {/* Mobile shows the list directly on the page background; from md it sits in a card. */}
      <Card className="gap-4 overflow-visible rounded-lg bg-transparent p-0 ring-0 md:overflow-hidden md:bg-card md:p-6 md:ring-1 md:ring-border">
        <Tabs value={tab} onValueChange={changeTab} className="gap-4">
          {/* Mobile: scrollable chips. md+: underlined tabs (Figma 02). */}
          <TabsList
            aria-label="Request stage"
            className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent p-0 pb-1 group-data-horizontal/tabs:h-auto md:w-fit md:max-w-full md:gap-0 md:pb-0"
          >
            {requestTabs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="h-auto min-h-11 flex-none rounded-md border-input bg-card px-4 py-2 text-sm text-muted-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none data-active:border-primary data-active:bg-primary data-active:font-bold data-active:text-primary-foreground md:min-h-0 md:min-w-[100px] md:rounded-none md:border-0 md:border-b-4 md:border-border md:bg-transparent md:text-base md:font-normal md:data-active:border-primary md:data-active:bg-transparent md:data-active:font-bold md:data-active:text-foreground"
              >
                {t.label} ({tabCounts[t.value]})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {tab === "shortfalls" && (
          <Alert className="border-warning/30 bg-warning-muted text-warning-muted-foreground">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-warning-muted-foreground">
              <span>These requests have items the depot couldn&apos;t send in full, or that arrived short.</span>
              <StoreArrowLink href="/store/requests/shortfalls">See shortfalls &amp; back-orders</StoreArrowLink>
            </AlertDescription>
          </Alert>
        )}

        {tab === "deferred" && (
          <Alert className="border-warning/30 bg-warning-muted text-warning-muted-foreground">
            <AlertDescription className="text-warning-muted-foreground">
              These requests could not be dispatched as originally scheduled and have been deferred by the depot. Review the updated delivery schedule and reasons below.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
          <div className="relative md:w-80">
            <Label htmlFor="request-search" className="sr-only">
              Search request ID or item
            </Label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="request-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search request ID or item…"
              className="h-11 bg-card pl-10 text-base md:text-base"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
            <Select
              value={priority}
              onValueChange={(value) => {
                setPriority(value as PriorityFilter);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Priority" className="h-11! w-full bg-card text-base md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Priority: All</SelectItem>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="default">Default</SelectItem>
              </SelectContent>
            </Select>
            <DateRangeFilter
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
              className="w-full md:w-60"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" onClick={clearFilters} className="h-11 w-fit px-3 text-primary">
              Clear filters
            </Button>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "request" : "requests"} found
        </p>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
            <p className="text-base font-semibold text-foreground">No requests found</p>
            <p className="text-sm text-muted-foreground">
              {hasFilters ? "Try a different search or clear the filters." : "Nothing in this stage right now."}
            </p>
            {hasFilters && (
              <Button variant="outline" onClick={clearFilters} className="h-11 md:h-10">
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden xl:block">
              <Table>
                <StoreTableHeader
                  columns={[
                    { label: "Request ID" },
                    { label: "Request Date" },
                    { label: "Delivery Window" },
                    { label: "Items" },
                    { label: "Priority" },
                    { label: "Status" },
                    { label: "Action" },
                  ]}
                />
                <TableBody>
                  {pageRows.map((order) => (
                    <TableRow key={order.id}>
                      <StoreTableCell>
                        <Link
                          href={requestHref(order)}
                          className="font-bold text-primary underline-offset-4 hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </StoreTableCell>
                      <StoreTableCell>
                        <span className="block font-medium">{formatLongDate(order.submittedAt)}</span>
                        <span className="mt-2 block text-muted-foreground">{formatClockTime(order.submittedAt)}</span>
                      </StoreTableCell>
                      <StoreTableCell>
                        <span className="block font-medium">{formatLongDate(order.orderDate)}</span>
                        <span className="mt-2 block text-muted-foreground">{formatDeliveryWindow(windowFor(order, outlet))}</span>
                      </StoreTableCell>
                      <StoreTableCell>
                        <span className="block font-medium">{formatItemCount(order.items.length)}</span>
                        <span className="mt-2 block text-muted-foreground">{formatUnitCount(totalUnits(order))}</span>
                      </StoreTableCell>
                      <StoreTableCell>
                        <PriorityPill isHighPriority={order.isHighPriority} />
                      </StoreTableCell>
                      <StoreTableCell>
                        <OrderStatusPill order={order} />
                        {isOrderDeferred(order) && (
                          <span className="mt-1 block max-w-xs truncate text-xs text-warning-muted-foreground" title={order.deferralReason ?? "Deferred / partial fulfillment by depot"}>
                            {order.deferralCount && order.deferralCount > 1 ? `(${order.deferralCount}×) ` : ""}
                            {order.deferralReason ?? "Partial fulfillment / deferral"}
                          </span>
                        )}
                      </StoreTableCell>
                      <StoreTableCell>
                        <Link
                          href={requestHref(order)}
                          className="font-bold text-primary underline-offset-4 hover:underline"
                        >
                          View<span className="sr-only"> {order.orderNumber}</span>
                        </Link>
                      </StoreTableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile / tablet cards */}
            <ul className="flex flex-col gap-4 xl:hidden">
              {pageRows.map((order) => (
                <li key={order.id}>
                  <Card className="gap-2 rounded-lg p-4 ring-border">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={requestHref(order)} className="text-sm font-bold text-primary">
                        {order.orderNumber}
                      </Link>
                      <OrderStatusPill order={order} />
                    </div>
                    {isOrderDeferred(order) && (
                      <div className="flex flex-col gap-0.5 rounded bg-warning-muted/50 p-2 text-xs text-warning-muted-foreground">
                        <span className="font-semibold">
                          {order.status === "deferred" ? "Deferred" : "Partial Deferral"} {order.deferralCount && order.deferralCount > 1 ? `(${order.deferralCount}×)` : ""}
                        </span>
                        {order.deferralReason && <span>{order.deferralReason}</span>}
                      </div>
                    )}
                    <dl className="flex flex-col gap-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Delivery window</dt>
                        <dd className="text-right font-medium">{formatShortWindow(order.orderDate, windowFor(order, outlet))}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Items</dt>
                        <dd className="text-right font-medium">
                          {formatItemCount(order.items.length)} · {formatUnitCount(totalUnits(order))}
                        </dd>
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
                    <StoreArrowLink href={requestHref(order)} className="w-fit">
                      View Details<span className="sr-only"> for {order.orderNumber}</span>
                    </StoreArrowLink>
                  </Card>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {pageRows.length} of {filtered.length} {filtered.length === 1 ? "request" : "requests"}
              </p>
              {pageCount > 1 && (
                <nav aria-label="Pagination" className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <Button
                      key={n}
                      variant={n === currentPage ? "default" : "outline"}
                      aria-label={`Page ${n}`}
                      aria-current={n === currentPage ? "page" : undefined}
                      onClick={() => setPage(n)}
                      className="hidden size-11 rounded-md text-base font-bold md:inline-flex"
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
