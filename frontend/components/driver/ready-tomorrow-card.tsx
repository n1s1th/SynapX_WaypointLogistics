"use client";

// "Ready for tomorrow": the driver tells dispatch they can take a run on the next
// operating day (Saturday's "tomorrow" is Monday). Shown while the driver has a
// trip on the road or done today, until 6 PM. Works offline: the tap is queued.

import * as React from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/driver/format";
import { useAvailability } from "@/lib/driver/hooks";
import { useDriver } from "./driver-provider";

const CLOSES_AT_HOUR = 18;

function colomboHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function ReadyTomorrowCard({ now, hasWorkToday }: { now: Date | null; hasWorkToday: boolean }) {
  const availability = useAvailability();
  const { outbox, perform, online } = useDriver();
  const queued = outbox.some((item) => item.action_type === "ready_tomorrow" && item.status === "pending");
  const rejected = outbox.find((item) => item.action_type === "ready_tomorrow" && item.status === "failed");
  const confirmed = availability.data?.confirmed || queued;
  const day = availability.data ? formatDateOnly(availability.data.for_date) : "the next operating day";

  if (!now || !hasWorkToday) return null;

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-info/25 bg-info-muted px-3 py-2.5 text-sm font-semibold text-info">
        <CalendarCheck className="size-4 shrink-0" aria-hidden />
        {queued ? `Saved on this phone: available ${day}. Dispatch sees it once you're back online.` : `Dispatch knows you're available ${day}.`}
      </div>
    );
  }

  if (colomboHour(now) >= CLOSES_AT_HOUR) return null;

  const confirm = async () => {
    await perform({ action_type: "ready_tomorrow", trip_id: null, label: `Ready for ${day}` });
    toast.success(online ? `Sent: available ${day}` : `Saved on this phone: available ${day}`);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-muted p-3">
      <CalendarClock className="size-5 shrink-0 text-success" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold text-success">Available {day}?</span>
        <span className="text-xs text-success/90">
          {availability.error ?? rejected?.last_error ?? "Let dispatch know before 6 PM so they can plan your vehicle."}
        </span>
      </div>
      <Button className="h-11 bg-success px-4 text-white hover:bg-success/90" onClick={confirm} disabled={Boolean(availability.error)}>
        I&apos;m ready
      </Button>
    </div>
  );
}
