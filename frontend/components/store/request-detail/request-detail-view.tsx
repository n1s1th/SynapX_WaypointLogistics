"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CircleAlert, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { StoreSectionCard } from "@/components/store/store-cards";
import { OrderStatusPill, PriorityPill, StorePill } from "@/components/store/status-pill";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import {
  brandLabels,
  type OrderShortfall,
  type StoreManager,
  type StoreOrder,
  type StoreOrderItem,
  type StoreOutlet,
} from "@/components/store/mock-data";
import { formatDeliveryWindow, formatUnitCount, windowFor } from "@/components/store/format";
import { cutoffFor, isPastCutoff } from "@/components/store/new-request/delivery-rules";
import { DispatcherNoteDialog } from "@/components/store/request-detail/dispatcher-note";
import { cancelStoreOrder } from "@/components/store/api/store-data";
import {
  allocationFor,
  currentStepIndex,
  deliveryMessage,
  PROGRESS_STEPS,
  sentQuantity,
  stepTime,
  type Allocation,
} from "@/components/store/request-detail/request-detail-data";

const allocationPill: Record<Allocation, React.ReactNode> = {
  full: <StorePill tone="success">Full allocation</StorePill>,
  partial: <StorePill tone="warning">Partial allocation</StorePill>,
  none: <StorePill tone="destructive">Not sent</StorePill>,
  pending: <StorePill tone="neutral">Awaiting picking</StorePill>,
};

const messageTone = {
  info: "bg-info-muted",
  success: "bg-success-muted",
  destructive: "bg-destructive-muted",
  neutral: "bg-background",
} as const;

export function RequestDetailView({
  order: initialOrder,
  outlet,
  manager,
  unloading,
  now,
  initialNoteSku,
}: {
  order: StoreOrder;
  outlet: StoreOutlet;
  manager: StoreManager;
  unloading: string;
  now: Date;
  /** Opens this item's dispatcher note on load. */
  initialNoteSku?: string;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [noteItem, setNoteItem] = useState<StoreOrderItem | null>(
    () => initialOrder.items.find((item) => item.sku === initialNoteSku && item.dispatcherNote) ?? null
  );
  const [cancelOpen, setCancelOpen] = useState(false);

  const deliveryDate = parseISO(order.orderDate);
  const stepIndex = currentStepIndex(order);
  const canCancel = (order.status === "submitted" || order.status === "confirmed") && !isPastCutoff(deliveryDate, now);
  const totalRequested = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const sentValues = order.items.map((item) => sentQuantity(order, item));
  const allPicked = sentValues.every((value) => value !== undefined);
  const totalSent = sentValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const partialCount = order.items.filter((item) => allocationFor(order, item) !== "full" && allocationFor(order, item) !== "pending").length;
  const message = deliveryMessage(order, now);
  const activity = order.activity ?? [{ at: order.submittedAt, text: `Request submitted by ${manager.fullName}` }];
  const unit = (_item: StoreOrderItem, count: number) => `${count} ${count === 1 ? "item" : "items"}`;

  const stepTimeLabel = (index: number) => {
    const step = PROGRESS_STEPS[index];
    const at = order.statusTimes?.[step.key] ?? (step.key === "submitted" ? order.submittedAt : undefined);
    if (at) return stepTime(at, now);
    if (step.key === "arriving" && order.eta) return `ETA ${stepTime(order.eta, now).replace("Today", "today")}`;
    if (step.key === "delivered" && (order.arrivedAt || order.delivery?.actualArrival)) {
      return stepTime(order.arrivedAt ?? order.delivery!.actualArrival!, now);
    }
    if (step.key === "delivered" && order.eta) return `Est. ${stepTime(order.eta, now).replace("Today", "today")}`;
    if (step.key === "completed") return "After store check";
    return "—";
  };

  const cancel = async () => {
    try {
      await cancelStoreOrder(order.id);
      setOrder((current) => ({ ...current, status: "cancelled" }));
      toast.success(`${order.orderNumber} cancelled.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't cancel the request. Try again.");
    } finally {
      setCancelOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <Breadcrumb>
            <BreadcrumbList className="text-base">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/store/requests">Goods Requests</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-primary">{order.orderNumber}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-4">
            <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
              Goods Request {order.orderNumber}
            </h1>
            <div className="flex flex-wrap gap-2">
              {order.isHighPriority && <PriorityPill isHighPriority />}
              <OrderStatusPill order={order} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Submitted {format(parseISO(order.submittedAt), "d MMM yyyy")} by {manager.fullName}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:flex-row md:gap-4 print:hidden">
          {canCancel && (
            <Button
              variant="ghost"
              onClick={() => setCancelOpen(true)}
              className="h-11 px-4 text-base font-bold text-destructive hover:bg-destructive-muted hover:text-destructive md:h-10"
            >
              Cancel request
            </Button>
          )}
          {/* Stores reorder the same goods often: start a new request with these items and quantities. */}
          <Button
            asChild
            variant="outline"
            className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
          >
            <Link href={`/store/requests/new?repeat=${order.orderNumber}`}>
              <RotateCcw aria-hidden="true" />
              Repeat order
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => window.print()}
            className="hidden h-10 border-2 border-primary px-4 text-base font-bold md:inline-flex"
          >
            <Printer aria-hidden="true" />
            Print Manifest
          </Button>
          <Button asChild className="h-11 bg-destructive px-4 text-base font-bold text-white hover:bg-destructive/90 md:h-10">
            {/* Issue reporting (Figma 07) is Dev B's flow. */}
            <Link href={`/store/issues/new?order=${order.orderNumber}`}>Report Issue</Link>
          </Button>
        </div>
      </div>

      {order.status === "deferred" ? (
        <Alert className="border-warning/30 bg-warning-muted" role="status">
          <CircleAlert className="text-warning" aria-hidden="true" />
          <AlertTitle className="font-bold text-warning-muted-foreground">This request was deferred</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {order.deferralReason ?? "The depot couldn't fit this request into the delivery plan. You'll get a notification with the new date."}
          </AlertDescription>
        </Alert>
      ) : order.deferralReason ? (
        <Alert className="border-warning/30 bg-warning-muted" role="status">
          <CircleAlert className="text-warning" aria-hidden="true" />
          <AlertTitle className="font-bold text-warning-muted-foreground">Partial Deferral by Depot</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {order.deferralReason}
          </AlertDescription>
        </Alert>
      ) : null}
      {order.shortfall && <ShortfallNotice shortfall={order.shortfall} />}
      {order.status === "cancelled" && (
        <Alert role="status">
          <AlertTitle className="font-bold">This request was cancelled</AlertTitle>
          <AlertDescription>Nothing will be delivered for {order.orderNumber}.</AlertDescription>
        </Alert>
      )}

      {/* Request info */}
      <Card className="rounded-lg p-4 ring-border md:p-6">
        <dl className="grid gap-3 text-sm md:grid-cols-4 md:gap-6">
          <InfoBlock
            label="Request date"
            value={format(parseISO(order.submittedAt), "d MMM yyyy")}
            sub={format(parseISO(order.submittedAt), "hh:mm a")}
            compact={format(parseISO(order.submittedAt), "d MMM yyyy, hh:mm a")}
          />
          <InfoBlock
            label="Delivery window"
            value={format(deliveryDate, "d MMM yyyy")}
            sub={formatDeliveryWindow(windowFor(order, outlet))}
            compact={`${format(deliveryDate, "d MMM")}, ${formatDeliveryWindow(windowFor(order, outlet))}`}
            className="md:order-3"
          />
          <InfoBlock
            label="Store"
            value={outlet.code}
            sub={`${brandLabels[outlet.brand]} · ${outlet.district} · ${unloading}`}
            compact={`${outlet.code} · ${unloading}`}
            className="md:order-2"
          />
          <InfoBlock
            label="Requested by"
            value={manager.fullName}
            sub="Store Manager"
            compact={manager.fullName}
            className="md:order-4"
          />
        </dl>
      </Card>

      {/* Progress */}
      {stepIndex !== null && (
        <StoreSectionCard
          title="Request Progress"
          action={
            <span className="text-sm font-medium text-muted-foreground">
              {order.status === "completed" ? "All steps done" : `Step ${stepIndex + 1} of ${PROGRESS_STEPS.length}`}
            </span>
          }
        >
          <ol className="flex flex-col gap-4 md:flex-row">
            {PROGRESS_STEPS.map((step, index) => {
              const done = index < stepIndex || order.status === "completed";
              const current = index === stepIndex && order.status !== "completed";
              return (
                <li
                  key={step.key}
                  aria-current={current ? "step" : undefined}
                  className="flex flex-1 items-start gap-3 md:flex-col md:gap-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 size-3 shrink-0 rounded-full md:mt-0 md:h-1 md:w-full md:rounded-full",
                      done ? "bg-primary" : current ? "bg-info" : "bg-border"
                    )}
                  />
                  <span className="flex flex-col gap-1 md:gap-2">
                    <span className={cn("flex flex-wrap items-center gap-2 text-sm font-bold", done || current ? "text-foreground" : "text-muted-foreground")}>
                      <span>
                        <span className="hidden md:inline">{index + 1}. </span>
                        {step.label}
                      </span>
                      {current && <StorePill tone="info">Current</StorePill>}
                      <span className="sr-only">{done ? "(done)" : current ? "" : "(not yet)"}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">{stepTimeLabel(index)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </StoreSectionCard>
      )}

      {/* Delivery */}
      <StoreSectionCard
        title="Delivery"
        description={`Vehicle and dock for ${order.orderNumber}`}
        action={
          <Button asChild variant="outline" className="hidden h-10 border-2 border-primary px-4 text-base font-bold md:inline-flex print:hidden">
            {/* Delivery Details & Receiving (Figma 06) is Dev B's flow. */}
            <Link href={`/store/deliveries/${order.orderNumber}`}>Open Delivery Details</Link>
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className={cn("rounded-lg p-4 text-sm text-foreground/80", messageTone[message.tone])} role="status">
            {message.text}
          </p>
          <dl className="grid gap-4 text-sm md:grid-cols-3 md:gap-6">
            <InfoBlock
              label="Vehicle & driver"
              value={order.vehicle ? `${order.vehicle.code} · ${order.vehicle.description}` : "Not assigned yet"}
              sub={order.vehicle ? `${order.vehicle.driverName} · ${order.vehicle.driverCode}` : "Assigned by dispatch"}
            />
            <InfoBlock
              label="Origin"
              value={order.vehicle?.origin ?? "Peliyagoda Depot"}
              sub={order.vehicle ? `Manifest #${order.vehicle.manifestNumber}` : "Manifest pending"}
            />
            <InfoBlock label="Unloading" value={unloading} sub="From Outlet Settings" />
          </dl>
          <Button asChild variant="outline" className="h-11 w-full border-2 border-primary text-base font-bold md:hidden">
            <Link href={`/store/deliveries/${order.orderNumber}`}>Open Delivery Details</Link>
          </Button>
        </div>
      </StoreSectionCard>

      {/* Requested items */}
      <StoreSectionCard
        title="Requested Items"
        description="What you requested vs. what the depot sent"
        action={
          partialCount > 0 && (
            <StorePill tone="warning">
              Partial allocation · {partialCount} {partialCount === 1 ? "item" : "items"}
            </StorePill>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <div className="hidden xl:block">
            <Table>
              <StoreTableHeader
                columns={[
                  { label: "Item", className: "w-full" },
                  { label: "SKU" },
                  { label: "Requested" },
                  { label: "Sent" },
                  { label: "Difference" },
                  { label: "Status" },
                  { label: "Dispatcher Note" },
                ]}
              />
              <TableBody>
                {order.items.map((item, index) => {
                  const sent = sentValues[index];
                  const difference = sent === undefined ? undefined : sent - item.quantity;
                  return (
                    <TableRow key={item.sku} className="hover:bg-transparent">
                      <StoreTableCell className="whitespace-normal">{item.itemName}</StoreTableCell>
                      <StoreTableCell>{item.sku}</StoreTableCell>
                      <StoreTableCell>{unit(item, item.quantity)}</StoreTableCell>
                      <StoreTableCell>{sent === undefined ? "—" : unit(item, sent)}</StoreTableCell>
                      <StoreTableCell className={cn(difference !== undefined && difference < 0 && "font-medium text-destructive")}>
                        {difference === undefined ? "—" : difference < 0 ? `−${unit(item, Math.abs(difference))}` : "0"}
                      </StoreTableCell>
                      <StoreTableCell>{allocationPill[allocationFor(order, item)]}</StoreTableCell>
                      <StoreTableCell>
                        {item.dispatcherNote ? (
                          <button
                            type="button"
                            onClick={() => setNoteItem(item)}
                            className="font-bold text-primary underline-offset-4 hover:underline"
                          >
                            View note<span className="sr-only"> for {item.itemName}</span>
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </StoreTableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col divide-y divide-border xl:hidden">
            {order.items.map((item, index) => {
              const sent = sentValues[index];
              return (
                <li key={item.sku} className="flex flex-col gap-2 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground">{item.itemName}</span>
                    {allocationPill[allocationFor(order, item)]}
                  </div>
                  <span className="text-muted-foreground">{item.sku}</span>
                  <span className="text-foreground">
                    Requested {unit(item, item.quantity)} · Sent {sent === undefined ? "—" : unit(item, sent)}
                  </span>
                  {item.dispatcherNote && (
                    <button
                      type="button"
                      onClick={() => setNoteItem(item)}
                      className="min-h-11 w-fit text-left font-bold text-primary"
                    >
                      View dispatcher note<span className="sr-only"> for {item.itemName}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-sm text-muted-foreground">
            {allPicked
              ? `Total: ${totalSent} of ${formatUnitCount(totalRequested)} dispatched${order.vehicle ? ` on ${order.vehicle.code}` : ""}.`
              : `Total requested: ${formatUnitCount(totalRequested)}. Sent quantities appear once the depot has picked your order.`}
          </p>
        </div>
      </StoreSectionCard>

      {/* Note + activity */}
      <div className="grid gap-4 md:gap-6 xl:grid-cols-2 xl:gap-[30px]">
        <StoreSectionCard title="Manager Note" description="Shared with the depot and driver">
          <div className="flex flex-col gap-4 text-sm">
            <p className={order.notes ? "text-foreground/80" : "text-muted-foreground"}>
              {order.notes ?? "No note was added to this request."}
            </p>
            {order.notes && (
              <p className="text-muted-foreground">
                {manager.fullName} · {format(parseISO(order.submittedAt), "d MMM yyyy, hh:mm a")}
              </p>
            )}
          </div>
        </StoreSectionCard>
        <StoreSectionCard title="Activity Log" description={`${activity.length} ${activity.length === 1 ? "event" : "events"}`}>
          <ol className="flex flex-col gap-4 text-sm">
            {activity.map((event) => (
              <li key={`${event.at}-${event.text}`} className="flex gap-4">
                <time dateTime={event.at} className="w-24 shrink-0 font-medium text-muted-foreground">
                  {format(parseISO(event.at), "d MMM, HH:mm")}
                </time>
                <span className="text-foreground">{event.text}</span>
              </li>
            ))}
          </ol>
        </StoreSectionCard>
      </div>

      <DispatcherNoteDialog
        item={noteItem}
        sent={noteItem ? sentQuantity(order, noteItem) : undefined}
        orderNumber={order.orderNumber}
        onOpenChange={(open) => !open && setNoteItem(null)}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.orderNumber}?</DialogTitle>
            <DialogDescription>
              You can cancel until {format(cutoffFor(deliveryDate), "h:mm a, EEE d MMM")}. The depot won&apos;t prepare
              or deliver this request.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-11 md:h-9">
                Keep request
              </Button>
            </DialogClose>
            <Button onClick={cancel} className="h-11 bg-destructive text-white hover:bg-destructive/90 md:h-9">
              Cancel request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The loader flags shortfalls per order, so this never names an item.
function ShortfallNotice({ shortfall }: { shortfall: OrderShortfall }) {
  if (shortfall.state === "under_review") {
    return (
      <Alert className="border-warning/30 bg-warning-muted" role="status">
        <CircleAlert className="text-warning" aria-hidden="true" />
        <AlertTitle className="font-bold text-warning-muted-foreground">Shortfall under review</AlertTitle>
        <AlertDescription className="text-foreground/80">
          The depot reported this request may be short. The dispatcher is deciding what to send. You&apos;ll see the
          final count here.
        </AlertDescription>
      </Alert>
    );
  }
  const { unitsShort, unitsTotal } = shortfall;
  const summary =
    unitsShort !== undefined && unitsTotal !== undefined
      ? `${unitsTotal - unitsShort} of ${unitsTotal} units sent (${unitsShort} short).`
      : unitsShort !== undefined
        ? `${unitsShort} ${unitsShort === 1 ? "unit" : "units"} short.`
        : "Some units couldn't be sent.";
  return (
    <Alert className="border-warning/30 bg-warning-muted" role="status">
      <CircleAlert className="text-warning" aria-hidden="true" />
      <AlertTitle className="font-bold text-warning-muted-foreground">This request was sent short</AlertTitle>
      <AlertDescription className="text-foreground/80">
        {summary} Report an issue if what arrives doesn&apos;t match.
      </AlertDescription>
    </Alert>
  );
}

function InfoBlock({
  label,
  value,
  sub,
  compact,
  className,
}: {
  label: string;
  value: string;
  sub: string;
  /** One-line value for the mobile label/value row (Figma Mobile / 04). Without it the block stays stacked. */
  compact?: string;
  className?: string;
}) {
  return (
    <>
      {compact && (
        <div className={cn("flex items-start justify-between gap-3 md:hidden", className)}>
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium text-foreground">{compact}</dd>
        </div>
      )}
      <div className={cn("flex-col gap-1 md:gap-2", compact ? "hidden md:flex" : "flex", className)}>
        <dt className="font-medium text-muted-foreground uppercase">{label}</dt>
        <dd className="font-bold text-foreground">{value}</dd>
        <dd className="text-muted-foreground">{sub}</dd>
      </div>
    </>
  );
}
