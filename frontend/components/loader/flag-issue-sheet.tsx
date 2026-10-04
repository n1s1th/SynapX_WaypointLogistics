"use client";

import * as React from "react";
import { WifiOff, X } from "lucide-react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatM3, formatOrderSize, formatTime } from "@/lib/loader/format";
import type {
  ActionInput,
  IssueType,
  QueuedAction,
  QueuedActionType,
  Run,
  RunOrder,
} from "@/lib/loader/types";
import { queuePhoto } from "@/lib/loader/offline/photo-queue";
import { FilterChip } from "./filter-chip";
import { FlagPhotoField } from "./flag-photo-field";
import { IssueTypePicker } from "./issue-type-picker";
import { LoaderButton } from "./loader-button";
import { useLoaderShell } from "./loader-shell";
import { useLoaderSync } from "./loader-sync-provider";
import { TempBadge } from "./temp-badge";
import { UnitStepper } from "./unit-stepper";

/** useOfflineRun's act: queues the flag and applies it to the run at once. */
type Act = (actionType: QueuedActionType, input?: ActionInput) => Promise<QueuedAction | undefined>;

interface FlagRequest {
  run: Run;
  orderNumber: string;
  act: Act;
}

// One sheet for the whole shell, opened from any checklist row.
let current: FlagRequest | null = null;
const listeners = new Set<() => void>();

function setRequest(next: FlagRequest | null) {
  current = next;
  listeners.forEach((l) => l());
}

/**
 * Open "Flag an issue" for an order (the row's flag button). The flag goes
 * through `act`, so it is queued offline and the row turns flagged at once.
 */
export function openFlagSheet(run: Run, order: Pick<RunOrder, "order_number">, act: Act) {
  setRequest({ run, orderNumber: order.order_number, act });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const TABLET = "(min-width: 768px)";

function useIsTablet(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(TABLET);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(TABLET).matches,
    () => false,
  );
}

const TITLE = "Flag an issue";
const SUBTITLE = "Report Loading Shortfall";

/**
 * The flag-an-issue sheet (Figma 1d, 1d.1; tablet dialog T1d, T1d.1). Mount
 * once inside the loader shell; open it with openFlagSheet.
 */
export function FlagIssueHost() {
  const request = React.useSyncExternalStore(subscribe, () => current, () => null);
  const isTablet = useIsTablet();
  const close = () => setRequest(null);
  const open = request !== null;
  // A new request (another row) starts a fresh form.
  const form = request && <FlagForm key={`${request.run.code}/${request.orderNumber}`} request={request} onDone={close} />;

  if (isTablet) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent showCloseButton={false} className="max-h-[92dvh] gap-4 overflow-y-auto p-6 sm:max-w-lg">
          <FormHeader Title={DialogTitle} Description={DialogDescription} onClose={close} />
          {form}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[92dvh] gap-4 overflow-y-auto rounded-t-xl px-4 pt-3 pb-5">
        <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
        <FormHeader Title={SheetTitle} Description={SheetDescription} onClose={close} />
        {form}
      </SheetContent>
    </Sheet>
  );
}

function FormHeader({
  Title,
  Description,
  onClose,
}: {
  Title: React.ComponentType<{ className?: string; children: React.ReactNode }>;
  Description: React.ComponentType<{ className?: string; children: React.ReactNode }>;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <Title className="text-xl leading-[26px] font-semibold text-primary">{TITLE}</Title>
        <Description className="text-xs text-muted-foreground">{SUBTITLE}</Description>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-5" aria-hidden />
      </button>
    </div>
  );
}

const QUICK_NOTES: Record<IssueType, string[]> = {
  missing: ["Not on the dock", "Left at depot", "Wrong dock"],
  short: ["Short delivery", "Count differs", "Pallet incomplete"],
  damaged: ["Crushed carton", "Wet / leaking", "Seal broken", "Wrong item"],
  wont_fit: ["Too tall", "Too bulky", "Pallet too wide"],
};

const UNIT_LABEL: Record<IssueType, string> = {
  missing: "units missing",
  short: "units short",
  damaged: "units damaged",
  wont_fit: "units left on the dock",
};

/** The Dispatcher has until departure − 20 min (contract, decide_by). */
const DECIDE_BEFORE_DEPARTURE_MS = 20 * 60_000;

function FlagForm({ request, onDone }: { request: FlagRequest; onDone: () => void }) {
  const { user } = useLoaderShell();
  const { sync } = useLoaderSync();
  const { run } = request;
  const stop = run.stops.find((s) => s.orders.some((o) => o.order_number === request.orderNumber));
  const order = stop?.orders.find((o) => o.order_number === request.orderNumber);

  const [type, setType] = React.useState<IssueType | null>(null);
  const [units, setUnits] = React.useState(1);
  const [tag, setTag] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [photo, setPhoto] = React.useState<Blob | null>(null);
  const [status, setStatus] = React.useState<"idle" | "sending" | "blocked">("idle");
  const [openedAt] = React.useState(() => new Date().toISOString());
  const noteId = React.useId();

  if (!stop || !order) return null;
  const total = order.units;

  const pickType = (next: IssueType) => {
    setType(next);
    // A missing order is usually all of it; the others start at one unit.
    setUnits(next === "missing" ? total : 1);
    setTag(null);
  };

  const send = async () => {
    if (!type) return;
    setStatus("sending");
    const action = await request.act("flag", {
      run_code: run.code,
      order_number: order.order_number,
      issue_type: type,
      units_affected: units,
      quick_note_tag: tag,
      note: note.trim(),
    });
    // Refused while a new plan waits to be acknowledged (the takeover shows).
    if (!action) return setStatus("blocked");
    // The photo follows the flag on its own; it never holds the flag back.
    if (photo) void queuePhoto({ client_action_id: action.client_action_id, run_code: run.code, order_number: order.order_number, blob: photo, created_at: new Date().toISOString() });
    onDone();
  };

  const loaded = total - units;
  const decideBy = new Date(Date.parse(run.departs_at) - DECIDE_BEFORE_DEPARTURE_MS).toISOString();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold text-foreground">{order.order_number}</span>
          <TempBadge temp={order.temperature_class} />
        </div>
        <p className="text-xs text-muted-foreground">
          {stop.outlet.code} · Stop {stop.stop_sequence} · {formatOrderSize(order)}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Issue type</h3>
        <IssueTypePicker value={type} onChange={pickType} />
      </section>

      {type && (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Units affected</h3>
            <UnitStepper value={units} min={1} max={total} onChange={setUnits} unitLabel={UNIT_LABEL[type]} />
            <p className="text-xs font-medium text-success">
              {loaded} of {total} {type === "wont_fit" ? "will be loaded" : "units will be loaded"}
              {type === "wont_fit" &&
                ` · plan said ${run.capacity.planned_volume_m3.toFixed(1)} / ${formatM3(run.capacity.max_volume_m3)}`}
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Quick note · no typing</h3>
            <div className="flex flex-wrap gap-2">
              {QUICK_NOTES[type].map((label) => (
                <FilterChip
                  key={label}
                  label={label}
                  active={tag === label}
                  onClick={() => setTag(tag === label ? null : label)}
                  className="rounded-full"
                />
              ))}
            </div>
            <Label htmlFor={noteId} className="sr-only">
              Notes or reason
            </Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add notes or reason…"
              className="min-h-16 bg-card"
            />
            <FlagPhotoField value={photo} onChange={setPhoto} />
          </section>
        </>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {user.initials}
        </span>
        <span className="text-sm text-foreground">
          {user.name} · {formatTime(openedAt)}
        </span>
      </div>

      {status === "blocked" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          A new plan is waiting. Acknowledge it first, then flag the order.
        </p>
      )}
      {!sync.online && (
        <p role="status" className="flex items-center gap-2 text-sm text-warning-muted-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          Offline · it goes to the Dispatcher when the tablet reconnects.
        </p>
      )}

      <LoaderButton className="w-full" disabled={!type || status === "sending"} onClick={() => void send()}>
        Send to Dispatcher
      </LoaderButton>

      <p className={cn("text-xs text-muted-foreground")}>
        {type === "wont_fit"
          ? `Goes to Dispatcher · Exceptions as Won’t fit, with planned vs real volume. If there is no answer by ${formatTime(decideBy)}, the default is to leave the overflow for the next run.`
          : "Goes to Dispatcher · Exceptions as a Loading Shortfall. The row stays flagged until they answer."}
      </p>
    </div>
  );
}
