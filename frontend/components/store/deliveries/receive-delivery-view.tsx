"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CircleAlert, CircleCheck, Phone } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StoreSectionCard } from "@/components/store/store-cards";
import { OrderStatusPill } from "@/components/store/status-pill";
import { TemperaturePill } from "@/components/store/new-request/add-item-picker";
import { QuantityStepper } from "@/components/store/new-request/quantity-stepper";
import { formatDeliveryWindow, formatLongDate, formatUnitCount, windowFor } from "@/components/store/format";
import type { StoreReceipt } from "@/components/store/api/store-data";
import type { StoreOrder, StoreOutlet } from "@/components/store/mock-data";
import { ReceiptRejectedError, submitDeliveryReceipt } from "@/services/api";

type Condition = "good" | "damaged" | "wrong_item";

interface Line {
  sku: string;
  itemName: string;
  packLabel: string;
  sent: number;
  received: number;
  condition: Condition;
  note: string;
}

const conditionLabel: Record<Condition, string> = { good: "Good", damaged: "Damaged", wrong_item: "Wrong item" };

const time = (iso?: string) => (iso ? format(parseISO(iso), "d MMM, HH:mm") : null);

export function ReceiveDeliveryView({
  order,
  outlet,
  receipt,
}: {
  order: StoreOrder;
  outlet: StoreOutlet;
  receipt: StoreReceipt | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() =>
    order.items.map((item) => ({
      sku: item.sku,
      itemName: item.itemName,
      packLabel: item.category,
      // What the depot actually loaded (a short shipment sends fewer than ordered).
      sent: item.quantitySent ?? item.quantity,
      received: item.quantitySent ?? item.quantity,
      condition: "good",
      note: "",
    }))
  );
  const [sealIntact, setSealIntact] = useState(true);
  const [arrivedCold, setArrivedCold] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);

  const isChilled = order.temperatureClass === "chilled";
  const canReceive = order.status === "dispatched" || order.status === "delivered";
  const flagged = lines.filter((line) => line.received !== line.sent || line.condition !== "good");
  const hasIssues = flagged.length > 0 || !sealIntact || (isChilled && !arrivedCold);
  const totalReceived = lines.reduce((sum, line) => sum + line.received, 0);
  const totalSent = lines.reduce((sum, line) => sum + line.sent, 0);

  const update = (sku: string, change: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.sku === sku ? { ...line, ...change } : line)));

  const describeIssues = () => {
    const parts = flagged.map((line) => {
      const count = line.received !== line.sent ? `${line.received} of ${line.sent} received` : `${line.received} received`;
      const condition = line.condition !== "good" ? `, ${conditionLabel[line.condition].toLowerCase()}` : "";
      return `${line.sku} ${line.itemName}: ${count}${condition}${line.note ? ` (${line.note})` : ""}`;
    });
    if (!sealIntact) parts.push("Seal was broken or missing");
    if (isChilled && !arrivedCold) parts.push("Chilled goods arrived warm");
    if (remarks.trim()) parts.push(remarks.trim());
    return parts.join(". ");
  };

  const issueType = () => {
    if (flagged.some((line) => line.condition === "damaged")) return "damaged";
    if (flagged.some((line) => line.condition === "wrong_item")) return "wrong_items";
    if (flagged.some((line) => line.received < line.sent)) return "short_delivery";
    return "other";
  };

  const submit = async () => {
    if (!outlet.id) return;
    setState("submitting");
    setError(null);
    try {
      const { isOffline } = await submitDeliveryReceipt({
        order_id: order.id,
        outlet_id: outlet.id,
        units_received: totalReceived,
        has_issues: hasIssues,
        issue_type: hasIssues ? issueType() : undefined,
        issue_description: hasIssues ? describeIssues() : remarks.trim() || undefined,
        confirmed_at: new Date().toISOString(),
        synced_from_offline: false,
      });
      setState(isOffline ? "queued" : "done");
      if (!isOffline) router.refresh();
    } catch (err) {
      setError(err instanceof ReceiptRejectedError ? err.message : "Couldn't confirm the receipt. Try again.");
      setState("idle");
    }
  };

  const delivery = order.delivery;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2">
        <Breadcrumb>
          <BreadcrumbList className="text-base">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/store/deliveries">Incoming Deliveries</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-primary">{order.orderNumber}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">Receive {order.orderNumber}</h1>
          <OrderStatusPill order={order} context="delivery" />
          <TemperaturePill value={order.temperatureClass} />
        </div>
        <p className="text-sm text-muted-foreground">
          For {outlet.code} {outlet.name} · {formatLongDate(order.orderDate)},{" "}
          {formatDeliveryWindow(windowFor(order, outlet))}
        </p>
      </div>

      <Card className="rounded-lg p-4 ring-border md:p-6">
        <dl className="grid gap-4 text-sm md:grid-cols-4">
          <Info label="Vehicle">
            {delivery?.vehicleCode ?? "Not assigned"}
            {delivery?.temperatureMode === "reefer" ? " · reefer" : ""}
          </Info>
          <Info label="Driver">
            <span className="flex flex-col gap-1">
              {delivery?.driverName ?? "Not assigned"}
              {delivery?.driverPhone && (
                <a
                  href={`tel:${delivery.driverPhone}`}
                  className="flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline md:min-h-0"
                >
                  <Phone className="size-4" aria-hidden="true" />
                  {delivery.driverPhone}
                </a>
              )}
            </span>
          </Info>
          <Info label="Trip">{delivery?.tripCode ?? "Not created yet"}</Info>
          <Info label={delivery?.actualArrival ? "Arrived" : "Expected"}>
            {time(delivery?.actualArrival) ?? time(delivery?.estimatedArrival) ?? "No ETA yet"}
          </Info>
        </dl>
      </Card>

      {order.status === "completed" ? (
        <Alert className={hasReceiptIssues(receipt) ? "border-warning/30 bg-warning-muted" : "border-success/30 bg-success-muted"} role="status">
          <CircleCheck className={hasReceiptIssues(receipt) ? "text-warning" : "text-success"} aria-hidden="true" />
          <AlertTitle className="font-bold">Received</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {receipt
              ? `${receipt.unitsReceived ?? "—"} units confirmed${receipt.confirmedAt ? ` on ${time(receipt.confirmedAt)}` : ""}.${receipt.hasIssues ? ` Issue logged: ${receipt.issueDescription ?? receipt.issueType}.` : " No issues."}`
              : "This delivery has been received."}
          </AlertDescription>
        </Alert>
      ) : !canReceive ? (
        <Alert role="status">
          <CircleAlert aria-hidden="true" />
          <AlertTitle className="font-bold">Not on its way yet</AlertTitle>
          <AlertDescription>
            You can receive {order.orderNumber} once it leaves the depot. It&apos;s{" "}
            {order.status.replace(/_/g, " ")} now.
          </AlertDescription>
        </Alert>
      ) : state === "done" || state === "queued" ? (
        <Alert className="border-success/30 bg-success-muted" role="status">
          <CircleCheck className="text-success" aria-hidden="true" />
          <AlertTitle className="font-bold">{state === "done" ? "Delivery received" : "Saved on this device"}</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {state === "done"
              ? hasIssues
                ? "The order is closed and the issue was sent to the depot. You can follow it in Exceptions & Issues."
                : "The order is closed. Thanks for confirming."
              : "You're offline. The receipt will be sent automatically when the connection is back."}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {order.status === "dispatched" && Boolean(order.eta || delivery?.estimatedArrival) && state === "idle" && (
            <Alert className="border-info/30 bg-info-muted" role="status">
              <CircleAlert className="text-info" aria-hidden="true" />
              <AlertTitle className="font-bold text-info-muted-foreground">Delivery is Arriving</AlertTitle>
              <AlertDescription className="text-foreground/80">
                Vehicle {delivery?.vehicleCode ?? "assigned"} is en route with an estimated arrival at{" "}
                {time(delivery?.estimatedArrival ?? order.eta)}. Prepare your dock to receive and verify items.
              </AlertDescription>
            </Alert>
          )}
          {order.status === "delivered" && state === "idle" && (
            <Alert className="border-success/30 bg-success-muted" role="status">
              <CircleCheck className="text-success" aria-hidden="true" />
              <AlertTitle className="font-bold text-success-muted-foreground">Vehicle at your dock</AlertTitle>
              <AlertDescription className="text-foreground/80">
                The vehicle has reached your rear dock. Count what was unloaded and verify below.
              </AlertDescription>
            </Alert>
          )}

          <StoreSectionCard
            title="Count what arrived"
            description={`The depot sent ${formatUnitCount(totalSent)}. Change anything that doesn't match.`}
          >
            <ul className="flex flex-col divide-y divide-border">
              {lines.map((line) => {
                const isFlagged = line.received !== line.sent || line.condition !== "good";
                return (
                  <li key={line.sku} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="font-medium text-foreground">{line.itemName}</span>
                      <span className="text-muted-foreground">
                        {line.sku}
                        {line.packLabel ? ` · ${line.packLabel}` : ""} · sent {line.sent}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-muted-foreground">Received</span>
                        <QuantityStepper
                          label={`Received for ${line.itemName}`}
                          value={line.received}
                          max={line.sent * 2}
                          onChange={(value) => update(line.sku, { received: value })}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`condition-${line.sku}`} className="text-xs text-muted-foreground">
                          Condition
                        </Label>
                        <Select
                          value={line.condition}
                          onValueChange={(value) => update(line.sku, { condition: value as Condition })}
                        >
                          <SelectTrigger id={`condition-${line.sku}`} className="h-11 w-36 bg-card md:h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(conditionLabel) as Condition[]).map((condition) => (
                              <SelectItem key={condition} value={condition}>
                                {conditionLabel[condition]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {isFlagged && (
                        <div className="flex w-full flex-col gap-2 md:w-64">
                          <Label htmlFor={`note-${line.sku}`} className="text-xs text-muted-foreground">
                            What happened? (optional)
                          </Label>
                          <Textarea
                            id={`note-${line.sku}`}
                            value={line.note}
                            maxLength={200}
                            onChange={(event) => update(line.sku, { note: event.target.value })}
                            className="min-h-11"
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </StoreSectionCard>

          <StoreSectionCard title="Checks" description="Tick what's true. Anything unticked is reported to the depot.">
            <div className="flex flex-col gap-4 text-sm">
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox checked={sealIntact} onCheckedChange={(checked) => setSealIntact(checked === true)} />
                The vehicle seal was intact
              </label>
              {isChilled && (
                <label className="flex min-h-11 items-center gap-3">
                  <Checkbox checked={arrivedCold} onCheckedChange={(checked) => setArrivedCold(checked === true)} />
                  Chilled goods arrived cold
                </label>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="receipt-remarks">Remarks (optional)</Label>
                <Textarea
                  id="receipt-remarks"
                  value={remarks}
                  maxLength={500}
                  onChange={(event) => setRemarks(event.target.value)}
                />
              </div>
            </div>
          </StoreSectionCard>

          {error && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden="true" />
              <AlertTitle className="font-bold">Receipt not confirmed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              {hasIssues
                ? "This will close the order and send the depot an issue with what you've noted."
                : `Everything matches: ${formatUnitCount(totalReceived)} received in good condition.`}
            </p>
            <Button
              onClick={submit}
              disabled={state === "submitting" || !outlet.id}
              className="h-11 px-6 text-base font-bold md:h-10"
            >
              {state === "submitting" ? "Confirming…" : hasIssues ? "Confirm and report issue" : "Confirm receipt"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function hasReceiptIssues(receipt: StoreReceipt | null) {
  return receipt?.hasIssues ?? false;
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="font-bold text-foreground">{children}</dd>
    </div>
  );
}
