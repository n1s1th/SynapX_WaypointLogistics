"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarDays, CircleAlert, CircleCheck, Plus, RotateCcw } from "lucide-react";
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
import { Calendar } from "@/components/ui/calendar";
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
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { StoreSectionCard } from "@/components/store/store-cards";
import { StorePill } from "@/components/store/status-pill";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { formatDeliveryWindow, formatItemCount, formatUnitCount } from "@/components/store/format";
import type {
  CatalogueItem,
  StoreManager,
  StoreOrder,
  StoreOutlet,
  StoreStock,
  TemperatureClass,
} from "@/components/store/mock-data";
import { AddItemPicker, TemperaturePill, temperatureLabel } from "@/components/store/new-request/add-item-picker";
import { QuantityStepper } from "@/components/store/new-request/quantity-stepper";
import { clearDraft, saveDraft, type RequestDraft } from "@/components/store/new-request/draft-storage";
import { ApiError } from "@/components/store/api/client";
import { placeGoodsRequest } from "@/components/store/api/store-data";
import { STORE_DATA_SOURCE } from "@/components/store/api/config";
import {
  cutoffFor,
  dateKey,
  earliestDeliveryDate,
  findDuplicateOrders,
  isPastCutoff,
  isSelectableDeliveryDate,
  nextOrderNumbers,
  timeUntilCutoff,
} from "@/components/store/new-request/delivery-rules";

const NOTES_LIMIT = 500;
const DRAFT_KEY = "waypoint.store.goods-request-draft";

type SubmitState = "idle" | "submitting" | "failed" | "submitted";

interface LineItem {
  sku: string;
  quantity: number;
}

/** "04:00", "04:15", … "07:45": the 15-minute steps a delivery window can start or end on. */
function windowSlots(start: string, end: string) {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const slots: string[] = [];
  for (let minute = toMinutes(start); minute <= toMinutes(end); minute += 15) {
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return slots;
}

// Reads the saved draft without a server/client mismatch (the server always sees "no draft").
function useSavedDraftRaw() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    () => {
      try {
        return window.localStorage.getItem(DRAFT_KEY);
      } catch {
        return null;
      }
    },
    () => null
  );
}

const longDate = (date: Date) => format(date, "d MMM yyyy (EEEE)");
const shortDay = (date: Date) => format(date, "EEE d MMM");

export function NewRequestForm({
  catalogue,
  existingOrders,
  stock,
  repeatFrom,
  holidays,
  outlet,
  manager,
  unloading,
  now,
}: {
  catalogue: CatalogueItem[];
  existingOrders: StoreOrder[];
  /** The store's on-hand counts from its last CSV import, shown in the item picker. */
  stock: StoreStock | null;
  /** Set when repeating an earlier order: its items (already limited to the catalogue) and what was left out. */
  repeatFrom?: { orderNumber: string; items: LineItem[]; unavailable: string[] };
  holidays: { date: string; name: string }[];
  outlet: StoreOutlet;
  manager: StoreManager;
  unloading: string;
  now: Date;
}) {
  const router = useRouter();
  const [items, setItems] = useState<LineItem[]>(() => repeatFrom?.items ?? []);
  // Defaults to the outlet's whole receiving window; the manager can narrow it for this delivery.
  const [windowStart, setWindowStart] = useState(outlet.windowStart);
  const [windowEnd, setWindowEnd] = useState(outlet.windowEnd);
  const [isHighPriority, setIsHighPriority] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submittedNumbers, setSubmittedNumbers] = useState<string[]>([]);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const savedDraftRaw = useSavedDraftRaw();
  const savedDraft = useMemo(() => {
    if (!savedDraftRaw) return null;
    try {
      return JSON.parse(savedDraftRaw) as RequestDraft;
    } catch {
      return null;
    }
  }, [savedDraftRaw]);

  const catalogueBySku = useMemo(() => new Map(catalogue.map((item) => [item.sku, item])), [catalogue]);
  const onHand = useMemo(
    () => (stock ? Object.fromEntries(stock.items.map((item) => [item.sku, item.quantityOnHand])) : undefined),
    [stock]
  );
  const slots = windowSlots(outlet.windowStart, outlet.windowEnd);
  const chosenWindow = { windowStart, windowEnd };
  const isCustomWindow = windowStart !== outlet.windowStart || windowEnd !== outlet.windowEnd;
  const lines = items
    .map((line) => ({ ...line, item: catalogueBySku.get(line.sku) }))
    .filter((line): line is LineItem & { item: CatalogueItem } => line.item !== undefined);
  const groups = (["chilled", "ambient"] as TemperatureClass[])
    .map((temperature) => ({ temperature, lines: lines.filter((line) => line.item.temperatureClass === temperature) }))
    .filter((group) => group.lines.length > 0);
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  // Mock mode predicts the numbers; live numbers are assigned by the server on submit (one sequence for all
  // outlets), so the screen doesn't guess them.
  const orderNumbers = nextOrderNumbers(existingOrders, Math.max(1, groups.length));
  const numbersPreview = STORE_DATA_SOURCE === "api" ? null : orderNumbers;
  const earliest = earliestDeliveryDate(now, isHighPriority, holidays);

  // Days that already have an active order (shown with a dot), and whether this request may still use a day:
  // Fresh outlets get one chilled and one ambient order per day, other brands one order per day.
  const bookedDays = useMemo(
    () =>
      existingOrders
        .filter((order) => order.status !== "cancelled" && order.status !== "draft")
        .map((order) => parseISO(order.orderDate)),
    [existingOrders]
  );
  const requestZones: TemperatureClass[] = groups.length
    ? groups.map((group) => group.temperature)
    : ["chilled", "ambient"];
  const isFullyBooked = (date: Date) => {
    const taken = findDuplicateOrders(existingOrders, outlet.brand, date, requestZones);
    // With no items yet, a Fresh day is only full once both zones are taken.
    return outlet.brand === "fresh" && groups.length === 0 ? taken.length >= 2 : taken.length > 0;
  };

  // ── Validation (contract §6) ──
  const errors: { field: "items" | "date"; message: string }[] = [];
  if (lines.length === 0) errors.push({ field: "items", message: "Add at least one item to the request." });
  if (!deliveryDate) {
    errors.push({ field: "date", message: "Choose a delivery date." });
  } else {
    if (!isSelectableDeliveryDate(deliveryDate, now, isHighPriority, holidays)) {
      errors.push({
        field: "date",
        message: `${isHighPriority ? "High priority" : "Default"} orders can be delivered from ${shortDay(earliest)} at the earliest. Choose another date.`,
      });
    } else if (isPastCutoff(deliveryDate, now)) {
      errors.push({ field: "date", message: `Ordering for ${shortDay(deliveryDate)} closed at 4:00 PM the day before.` });
    }
    const duplicates = findDuplicateOrders(
      existingOrders,
      outlet.brand,
      deliveryDate,
      groups.map((group) => group.temperature)
    );
    if (duplicates.length > 0) {
      const list = duplicates
        .map((order) => `${order.orderNumber} (${temperatureLabel[order.temperatureClass].toLowerCase()})`)
        .join(", ");
      errors.push({
        field: "date",
        message:
          outlet.brand === "fresh"
            ? `You already have ${list} for ${shortDay(deliveryDate)}. Fresh outlets can place one chilled and one ambient order per day.`
            : `You already have ${list} for ${shortDay(deliveryDate)}. Only one order per day is allowed.`,
      });
    }
  }
  const visibleErrors = showErrors ? errors : [];
  const itemsError = visibleErrors.find((error) => error.field === "items");
  const dateError = visibleErrors.find((error) => error.field === "date");

  const selectedMap = Object.fromEntries(items.map((line) => [line.sku, line.quantity]));
  const hasContent = items.length > 0 || deliveryDate !== undefined || notes !== "";

  const setQuantity = (sku: string, quantity: number) =>
    setItems((current) => current.map((line) => (line.sku === sku ? { ...line, quantity } : line)));
  const removeItem = (sku: string) => setItems((current) => current.filter((line) => line.sku !== sku));

  const persistDraft = () =>
    saveDraft({
      items,
      isHighPriority,
      deliveryDate: deliveryDate ? dateKey(deliveryDate) : undefined,
      notes,
      window: isCustomWindow ? { start: windowStart, end: windowEnd } : undefined,
    });

  const handleSaveDraft = () => {
    if (!hasContent) {
      toast("Nothing to save yet. Add an item first.");
      return;
    }
    if (persistDraft()) {
      setDraftDismissed(true);
      toast.success("Draft saved on this device.");
    } else {
      toast.error("Couldn't save the draft on this device.");
    }
  };

  const restoreDraft = () => {
    if (!savedDraft) return;
    setItems(savedDraft.items.filter((line) => catalogueBySku.has(line.sku)));
    setIsHighPriority(savedDraft.isHighPriority);
    setDeliveryDate(savedDraft.deliveryDate ? parseISO(savedDraft.deliveryDate) : undefined);
    setNotes(savedDraft.notes);
    // Only restore a saved window that still fits the outlet's hours.
    if (savedDraft.window && slots.includes(savedDraft.window.start) && slots.includes(savedDraft.window.end)) {
      setWindowStart(savedDraft.window.start);
      setWindowEnd(savedDraft.window.end);
    }
    setDraftDismissed(true);
  };

  const discard = () => {
    clearDraft();
    router.push("/store/requests");
  };

  const submit = async () => {
    setShowErrors(true);
    setServerError(null);
    if (errors.length > 0) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setSubmitState("submitting");
    try {
      const created = await placeGoodsRequest(
        {
          deliveryDate: dateKey(deliveryDate!),
          isHighPriority,
          notes,
          window: isCustomWindow ? { start: windowStart, end: windowEnd } : undefined,
          items: lines.map((line) => ({
            sku: line.sku,
            itemName: line.item.itemName,
            quantity: line.quantity,
            temperatureClass: line.item.temperatureClass,
          })),
        },
        orderNumbers
      );
      clearDraft();
      setSubmittedNumbers(created);
      setSubmitState("submitted");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (error instanceof ApiError && !error.isNetworkError && error.status < 500) {
        // The server rejected the request (e.g. the cutoff passed meanwhile): show why, keep the form as is.
        setServerError(error.message);
        setSubmitState("idle");
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      // Connection dropped or server error: keep a draft on this device (Figma 03d). Offline in DevTools shows this.
      persistDraft();
      setDraftDismissed(true);
      setSubmitState("failed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (submitState === "submitted") {
    return (
      <SubmittedConfirmation
        orderNumbers={submittedNumbers}
        groups={groups.map((group) => group.temperature)}
        deliveryDate={deliveryDate!}
        deliveryWindow={chosenWindow}
      />
    );
  }

  const steps = [
    { title: "1. Select Goods & Quantities", done: lines.length > 0, hint: "Add items from the depot catalogue" },
    { title: "2. Order Priority & Timing", done: deliveryDate !== undefined, hint: "Choose priority and delivery date" },
    { title: "3. Review & Submit", done: false, hint: "Check details and submit" },
  ];
  const currentStep = steps.findIndex((step) => !step.done);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
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
                <BreadcrumbPage className="text-primary">New Request</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">New Goods Request</h1>
            <StorePill tone="neutral">Draft</StorePill>
          </div>
          <p className="text-sm text-muted-foreground">
            Specify the items you need from the central depot and when you need them.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          className="hidden h-10 shrink-0 border-2 border-primary px-4 text-base font-bold md:inline-flex"
        >
          Save as Draft
        </Button>
      </div>

      {repeatFrom && (
        <Alert className="border-info/30 bg-info-muted" role="status">
          <RotateCcw className="text-info" aria-hidden="true" />
          <AlertTitle className="text-foreground">Repeating {repeatFrom.orderNumber}</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {repeatFrom.items.length > 0
              ? `${formatItemCount(repeatFrom.items.length)} copied with the same quantities. Check them, then choose a delivery date.`
              : "None of its items are in your catalogue any more. Add items to continue."}
            {repeatFrom.unavailable.length > 0 &&
              ` Left out because they're no longer in your catalogue: ${repeatFrom.unavailable.join(", ")}.`}
          </AlertDescription>
        </Alert>
      )}

      {savedDraft && !draftDismissed && !hasContent && (
        <Alert className="border-info/30 bg-info-muted">
          <AlertTitle className="text-foreground">You have an unsent draft</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground/80 md:flex-row md:items-center md:justify-between">
            <span>
              Saved on this device {format(parseISO(savedDraft.savedAt), "d MMM, HH:mm")} ·{" "}
              {formatItemCount(savedDraft.items.length)}
            </span>
            <span className="flex gap-2">
              <Button onClick={restoreDraft} className="h-11 px-4 font-bold md:h-9">
                Restore draft
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  clearDraft();
                  setDraftDismissed(true);
                }}
                className="h-11 px-4 md:h-9"
              >
                Discard
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {submitState === "failed" && (
        <Alert className="border-destructive/30 bg-destructive-muted" role="alert">
          <CircleAlert className="text-destructive" aria-hidden="true" />
          <AlertTitle className="font-bold text-destructive">
            Couldn&apos;t submit {numbersPreview ? numbersPreview.join(" and ") : "your request"}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground/80 md:flex-row md:items-center md:justify-between">
            <span>
              The connection to central dispatch dropped while sending. Your request is saved as a draft on this device,
              so nothing was lost.
            </span>
            <span className="flex shrink-0 gap-2">
              <Button onClick={submit} className="h-11 px-4 text-base font-bold md:h-10">
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSubmitState("idle");
                  toast.success("Kept as a draft on this device.");
                }}
                className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
              >
                Keep as Draft
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Progress */}
      <Card className="rounded-lg p-4 ring-border md:p-6">
        <ol className="hidden gap-4 md:flex">
          {steps.map((step, index) => {
            const isCurrent = index === currentStep || (currentStep === -1 && index === steps.length - 1);
            return (
              <li key={step.title} className="flex flex-1 flex-col gap-2" aria-current={isCurrent ? "step" : undefined}>
                <span
                  className={cn("h-1 rounded-full", step.done ? "bg-primary" : isCurrent ? "bg-info" : "bg-border")}
                />
                <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                  {step.title}
                  {isCurrent && <StorePill tone="info">Current</StorePill>}
                </span>
                <span className="text-sm text-muted-foreground">{step.done ? "Completed" : step.hint}</span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-3 md:hidden">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-foreground">
              {steps[currentStep === -1 ? 2 : currentStep].title.replace(/^\d\.\s/, "")}
            </span>
            <span className="text-muted-foreground">Step {currentStep === -1 ? 3 : currentStep + 1} of 3</span>
          </div>
          <div className="grid grid-cols-3 gap-2" aria-hidden="true">
            {steps.map((step, index) => (
              <span
                key={step.title}
                className={cn(
                  "h-1 rounded-full",
                  step.done ? "bg-primary" : index === currentStep || (currentStep === -1 && index === 2) ? "bg-info" : "bg-border"
                )}
              />
            ))}
          </div>
        </div>
      </Card>

      {((showErrors && errors.length > 0) || serverError) && (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <Alert className="border-destructive/30 bg-destructive-muted" role="alert">
            <CircleAlert className="text-destructive" aria-hidden="true" />
            <AlertTitle className="font-bold text-destructive">Fix these before submitting</AlertTitle>
            <AlertDescription className="text-foreground/80">
              <ul className="list-disc pl-5">
                {(serverError ? [...errors, { field: "server", message: serverError }] : errors).map((error) => (
                  <li key={error.message}>{error.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_350px] xl:items-start xl:gap-[30px]">
        <div className="flex flex-col gap-4 md:gap-6">
          {/* Order priority */}
          <StoreSectionCard title="Order Priority" description="Choose how urgently these goods are needed">
            <RadioGroup
              value={isHighPriority ? "high" : "default"}
              onValueChange={(value) => setIsHighPriority(value === "high")}
              aria-label="Order priority"
              className="grid gap-4 md:grid-cols-2"
            >
              {[
                {
                  value: "default",
                  title: "Default Order",
                  badge: <StorePill tone="neutral">48h standard</StorePill>,
                  text: "Follows the standard depot fulfillment and delivery schedule.",
                },
                {
                  value: "high",
                  title: "High Priority",
                  badge: <StorePill tone="destructive">24h expedited</StorePill>,
                  text: "Flagged for immediate depot allocation and priority dispatch.",
                },
              ].map((option) => {
                const checked = (option.value === "high") === isHighPriority;
                return (
                  <Label
                    key={option.value}
                    htmlFor={`priority-${option.value}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-4 rounded-lg border p-4 font-normal",
                      checked ? "border-primary bg-warning-muted" : "border-border bg-card hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem id={`priority-${option.value}`} value={option.value} className="mt-0.5 size-5" />
                    <span className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                        {option.title}
                        {option.badge}
                      </span>
                      <span className="text-sm text-foreground/80">{option.text}</span>
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          </StoreSectionCard>

          {/* Selected items */}
          <StoreSectionCard
            title="Selected Items"
            description={
              lines.length > 0 ? `${formatItemCount(lines.length)} · ${formatUnitCount(totalUnits)}` : "No items yet"
            }
          >
            <div className="flex flex-col gap-4">
              {itemsError && (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {itemsError.message}
                </p>
              )}
              {groups.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Add the goods you need from the depot catalogue.
                </p>
              )}
              {groups.map((group) => {
                const units = group.lines.reduce((sum, line) => sum + line.quantity, 0);
                return (
                  <div key={group.temperature} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <TemperaturePill value={group.temperature} />
                      <span className="text-sm text-muted-foreground">
                        {formatItemCount(group.lines.length)} · {formatUnitCount(units)}
                        {group.temperature === "chilled" && " · ships in a reefer vehicle"}
                      </span>
                    </div>

                    <div className="hidden md:block">
                      <Table>
                        <StoreTableHeader
                          columns={[
                            { label: "Item", className: "w-full" },
                            { label: "SKU" },
                            { label: "Quantity" },
                            { label: "Unit" },
                            { label: "Remove", className: "text-transparent select-none" },
                          ]}
                        />
                        <TableBody>
                          {group.lines.map((line) => (
                            <TableRow key={line.sku} className="hover:bg-transparent">
                              <StoreTableCell className="whitespace-normal">
                                <span className="block font-medium">{line.item.itemName}</span>
                                <span className="mt-2 block text-muted-foreground">{line.item.packLabel}</span>
                              </StoreTableCell>
                              <StoreTableCell>{line.sku}</StoreTableCell>
                              <StoreTableCell>
                                <QuantityStepper
                                  label={`Quantity for ${line.item.itemName}`}
                                  value={line.quantity}
                                  min={1}
                                  onChange={(value) => setQuantity(line.sku, value)}
                                />
                              </StoreTableCell>
                              <StoreTableCell>{line.item.unitLabel}</StoreTableCell>
                              <StoreTableCell>
                                <button
                                  type="button"
                                  onClick={() => removeItem(line.sku)}
                                  className="text-sm font-medium text-destructive underline-offset-4 hover:underline"
                                >
                                  Remove<span className="sr-only"> {line.item.itemName}</span>
                                </button>
                              </StoreTableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <ul className="flex flex-col divide-y divide-border md:hidden">
                      {group.lines.map((line) => (
                        <li key={line.sku} className="flex flex-col gap-3 py-3">
                          <div className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-foreground">{line.item.itemName}</span>
                            <span className="text-muted-foreground">
                              {line.sku} · {line.item.unitLabel}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <QuantityStepper
                              label={`Quantity for ${line.item.itemName}`}
                              value={line.quantity}
                              min={1}
                              onChange={(value) => setQuantity(line.sku, value)}
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(line.sku)}
                              className="min-h-11 px-2 text-sm font-medium text-destructive"
                            >
                              Remove<span className="sr-only"> {line.item.itemName}</span>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {groups.length > 1 && (
                <p className="rounded-lg bg-info-muted p-4 text-sm text-foreground/80">
                  Chilled and ambient items ship on different vehicles, so this request will be submitted as two orders
                  {numbersPreview ? (
                    <>
                      : <strong className="font-semibold">{numbersPreview[0]}</strong> (chilled) and{" "}
                      <strong className="font-semibold">{numbersPreview[1]}</strong> (ambient).
                    </>
                  ) : (
                    ": one chilled and one ambient."
                  )}
                </p>
              )}

              <Button
                variant="outline"
                onClick={() => setPickerOpen(true)}
                className="h-11 w-full border-2 border-primary text-base font-bold md:h-10"
              >
                <Plus aria-hidden="true" />
                {lines.length === 0 ? "Add items" : "Add another item"}
              </Button>
            </div>
          </StoreSectionCard>

          {/* Delivery date */}
          <StoreSectionCard title="Delivery Date" description="Pick the day, and narrow the time window if you need to.">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="delivery-date" className="text-base font-medium text-foreground/80">
                  Required delivery date
                </Label>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="delivery-date"
                      variant="outline"
                      aria-describedby="delivery-date-hint"
                      aria-invalid={dateError ? true : undefined}
                      className={cn(
                        "h-12 w-full justify-start gap-2 border-input bg-card px-4 text-base font-normal hover:bg-card",
                        deliveryDate ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <CalendarDays className="size-5" aria-hidden="true" />
                      {deliveryDate ? longDate(deliveryDate) : "Choose a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={deliveryDate}
                      defaultMonth={deliveryDate ?? earliest}
                      disabled={(date) =>
                        !isSelectableDeliveryDate(date, now, isHighPriority, holidays) || isFullyBooked(date)
                      }
                      modifiers={{ booked: bookedDays }}
                      modifiersClassNames={{
                        booked:
                          "relative after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                      }}
                      onSelect={(date) => {
                        setDeliveryDate(date);
                        if (date) setCalendarOpen(false);
                      }}
                      autoFocus
                    />
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      No deliveries on Sundays or public holidays. A dot means you already have an order that day.
                    </p>
                  </PopoverContent>
                </Popover>
                <p id="delivery-date-hint" className="text-sm text-muted-foreground">
                  {deliveryDate && !dateError
                    ? `Order closes in ${timeUntilCutoff(deliveryDate, now)} (4:00 PM ${shortDay(cutoffFor(deliveryDate))}).`
                    : `Earliest for ${isHighPriority ? "high priority" : "default"} orders: ${shortDay(earliest)}. Orders close at 4:00 PM the day before.`}
                </p>
                {dateError && (
                  <p className="text-sm font-medium text-destructive" role="alert">
                    {dateError.message}
                  </p>
                )}
              </div>
              <fieldset className="flex flex-col gap-3 rounded-lg bg-background p-4 text-sm">
                <legend className="sr-only">Delivery window</legend>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span aria-hidden="true" className="font-medium text-muted-foreground">
                    Delivery window
                  </span>
                  {isCustomWindow && (
                    <button
                      type="button"
                      onClick={() => {
                        setWindowStart(outlet.windowStart);
                        setWindowEnd(outlet.windowEnd);
                      }}
                      className="min-h-11 text-sm font-bold text-primary underline-offset-4 hover:underline md:min-h-0"
                    >
                      Use full window
                    </button>
                  )}
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <Label htmlFor="window-start">From</Label>
                    <Select
                      value={windowStart}
                      onValueChange={(value) => {
                        setWindowStart(value);
                        if (value >= windowEnd) setWindowEnd(slots[slots.indexOf(value) + 1]);
                      }}
                    >
                      <SelectTrigger id="window-start" className="h-11 w-full bg-card md:h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {slots.slice(0, -1).map((slot) => (
                          <SelectItem key={slot} value={slot}>
                            {slot}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <Label htmlFor="window-end">To</Label>
                    <Select value={windowEnd} onValueChange={setWindowEnd}>
                      <SelectTrigger id="window-end" className="h-11 w-full bg-card md:h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {slots
                          .filter((slot) => slot > windowStart)
                          .map((slot) => (
                            <SelectItem key={slot} value={slot}>
                              {slot}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Within {outlet.code}&apos;s receiving hours, {formatDeliveryWindow(outlet)}.
                </p>
              </fieldset>
            </div>
          </StoreSectionCard>

          {/* Notes */}
          <StoreSectionCard title="Additional Notes" description="Optional · shared with the depot receiving team">
            <div className="flex flex-col gap-2">
              <Label htmlFor="request-notes" className="sr-only">
                Additional notes
              </Label>
              <Textarea
                id="request-notes"
                value={notes}
                maxLength={NOTES_LIMIT}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Check seals on paper cup boxes."
                aria-describedby="request-notes-count"
                className="min-h-24 bg-card text-base md:text-base"
              />
              <p id="request-notes-count" className="text-sm text-muted-foreground">
                {notes.length} / {NOTES_LIMIT} characters
              </p>
            </div>
          </StoreSectionCard>
        </div>

        {/* Summary */}
        <StoreSectionCard title="Request Summary" description="Review before submitting" className="xl:sticky xl:top-6">
          <div className="flex flex-col gap-4 text-sm">
            <dl className="flex flex-col gap-4">
              <SummaryRow label={groups.length > 1 ? "Order IDs" : "Order ID"}>
                {numbersPreview ? numbersPreview.join(", ") : "Assigned when you submit"}
              </SummaryRow>
              <SummaryRow label="Outlet">
                {outlet.code} · {outlet.name}
              </SummaryRow>
              <SummaryRow label="Store Manager">{manager.fullName}</SummaryRow>
              <Separator />
              <SummaryRow label="Total items">
                {lines.length} line {lines.length === 1 ? "item" : "items"}
              </SummaryRow>
              <SummaryRow label="Total quantity">{formatUnitCount(totalUnits)}</SummaryRow>
              <SummaryRow label="Priority">
                {isHighPriority ? (
                  <StorePill tone="destructive">High Priority</StorePill>
                ) : (
                  <StorePill tone="neutral">Default</StorePill>
                )}
              </SummaryRow>
              <SummaryRow label="Target delivery">
                {deliveryDate ? `${format(deliveryDate, "d MMM yyyy")}, ${formatDeliveryWindow(chosenWindow)}` : "Not chosen"}
              </SummaryRow>
              <SummaryRow label="Unloading">{unloading} (from Outlet Settings)</SummaryRow>
            </dl>
            <Separator />
            <Button
              onClick={submit}
              disabled={submitState === "submitting"}
              className="h-11 w-full text-base font-bold md:h-10"
            >
              {submitState === "submitting"
                ? "Submitting…"
                : submitState === "failed"
                  ? "Try Again"
                  : "Submit Goods Request"}
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              className="h-11 w-full border-2 border-primary text-base font-bold md:h-10"
            >
              Save as Draft
            </Button>
            <button
              type="button"
              onClick={() => (hasContent ? setDiscardOpen(true) : discard())}
              className="min-h-11 text-sm font-bold text-destructive underline-offset-4 hover:underline md:min-h-0"
            >
              Cancel and discard
            </button>
            <p className="rounded-lg bg-warning-muted p-4 text-foreground/80">
              Deliveries arrive in your {formatDeliveryWindow(outlet)} window. No deliveries on Sundays.
            </p>
          </div>
        </StoreSectionCard>
      </div>

      <AddItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        catalogue={catalogue}
        onHand={onHand}
        selected={selectedMap}
        requestLabel={numbersPreview ? numbersPreview.join(" / ") : "this request"}
        onConfirm={(next) => {
          // Keep existing order of lines, append new ones.
          setItems((current) => {
            const kept = current.filter((line) => line.sku in next).map((line) => ({ ...line, quantity: next[line.sku] }));
            const added = Object.keys(next)
              .filter((sku) => !current.some((line) => line.sku === sku))
              .map((sku) => ({ sku, quantity: next[sku] }));
            return [...kept, ...added];
          });
        }}
      />

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this request?</DialogTitle>
            <DialogDescription>
              The items, date and notes you entered will be deleted, including any draft saved on this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-11 md:h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button onClick={discard} className="h-11 bg-destructive text-white hover:bg-destructive/90 md:h-9">
              Discard request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

function SubmittedConfirmation({
  orderNumbers,
  groups,
  deliveryDate,
  deliveryWindow,
}: {
  orderNumbers: string[];
  groups: TemperatureClass[];
  deliveryDate: Date;
  deliveryWindow: { windowStart: string; windowEnd: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card className="items-center gap-4 rounded-lg p-6 text-center ring-border md:p-10" role="status">
        <CircleCheck className="size-12 text-success" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-primary md:text-2xl md:font-bold">Goods request submitted</h1>
        <p className="text-sm text-muted-foreground">
          The depot will confirm your request shortly. Delivery is planned for{" "}
          <strong className="font-semibold text-foreground">
            {format(deliveryDate, "EEEE d MMM")}, {formatDeliveryWindow(deliveryWindow)}
          </strong>
          .
        </p>
        <ul className="flex flex-col gap-2">
          {orderNumbers.map((orderNumber, index) => (
            <li key={orderNumber} className="flex items-center justify-center gap-2 text-base font-bold text-primary">
              {orderNumber}
              {groups[index] && <TemperaturePill value={groups[index]} />}
            </li>
          ))}
        </ul>
        <div className="flex w-full flex-col gap-3 pt-2 md:w-auto md:flex-row">
          <Button asChild className="h-11 px-4 text-base font-bold md:h-10">
            <Link href="/store/requests">Back to Goods Requests</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
          >
            Place another request
          </Button>
        </div>
      </Card>
    </div>
  );
}
