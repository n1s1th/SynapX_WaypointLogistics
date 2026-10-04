"use client";

import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { StorePill } from "@/components/store/status-pill";
import type { StoreOrderItem } from "@/components/store/mock-data";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// Figma 04b: explains why the depot sent less than requested. Dialog on desktop, bottom sheet on mobile.
export function DispatcherNoteDialog({
  item,
  sent,
  orderNumber,
  onOpenChange,
}: {
  item: StoreOrderItem | null;
  sent: number | undefined;
  orderNumber: string;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const note = item?.dispatcherNote;
  const open = item !== null && note !== undefined;
  const formatCount = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
  const difference = item && sent !== undefined ? sent - item.quantity : 0;

  const body = item && note && (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-3 gap-4 rounded-lg bg-background p-4">
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground">Requested</dt>
          <dd className="font-bold text-foreground">
            {formatCount(item.quantity)}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="font-bold text-foreground">
            {formatCount(sent ?? 0)}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground">Difference</dt>
          <dd className="font-bold text-destructive">
            {difference < 0 ? `−${Math.abs(difference)} ${Math.abs(difference) === 1 ? "item" : "items"}` : formatCount(difference)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Reason</span>
        <StorePill tone="warning">{note.reason}</StorePill>
      </div>
      <p className="text-foreground/80">{note.message}</p>
      <Separator />
      <div className="flex items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
          aria-hidden="true"
        >
          {initials(note.author)}
        </span>
        <span className="flex flex-col">
          <span className="font-medium text-foreground">
            {note.author} · {note.authorRole}
          </span>
          <span className="text-muted-foreground">
            {note.location} · {format(parseISO(note.at), "d MMM yyyy, HH:mm")}
          </span>
        </span>
      </div>
    </div>
  );

  const subtitle = item ? `${item.itemName} · ${item.sku} · ${orderNumber}` : "";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90svh] gap-4 overflow-y-auto rounded-t-2xl p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="text-xl font-semibold text-primary">Dispatcher Note</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>
          {body}
          <SheetFooter className="p-0">
            <SheetClose asChild>
              <Button className="h-11 w-full text-base font-bold">Close</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-2xl p-6 sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-primary">Dispatcher Note</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <DialogClose asChild>
            <Button className="h-10 px-4 text-base font-bold">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
