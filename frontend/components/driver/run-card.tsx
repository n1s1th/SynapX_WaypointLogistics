// One trip on the driver's home screen, with the next thing to do with it.

import Link from "next/link";
import { Clock, MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDay, formatTime, runTitle } from "@/lib/driver/format";
import type { RunCard as RunCardData } from "@/lib/driver/types";
import { RunStateBadge, TemperatureChip } from "./badges";

export function RunCard({ card, highlight }: { card: RunCardData; highlight?: boolean }) {
  const progress = card.stop_count ? Math.round((card.stops_done / card.stop_count) * 100) : 0;
  return (
    <section
      aria-label={`${card.code}, trip ${card.trip_number}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4",
        highlight ? "border-2 border-primary bg-accent" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xl leading-tight font-bold">{card.code}</span>
          <span className="truncate text-xs font-medium text-muted-foreground">
            Trip {card.trip_number}
            {card.vehicle ? ` · ${card.vehicle.code}` : ""}
          </span>
        </div>
        <RunStateBadge state={card.state} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        {runTitle(card) && (
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <MapPin className="size-4 text-muted-foreground" aria-hidden />
            {runTitle(card)}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="size-4" aria-hidden />
          Departs {formatTime(card.departs_at)}
          {card.departs_at ? ` · ${formatDay(card.departs_at)}` : ""}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Truck className="size-4" aria-hidden />
          {card.stop_count} stops
        </span>
        {card.has_chilled && <TemperatureChip chilled />}
      </div>

      {card.state === "in_progress" && (
        <div className="flex flex-col gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Stops done">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {card.stops_done} of {card.stop_count} stops done
          </span>
        </div>
      )}

      <RunAction card={card} />
    </section>
  );
}

function RunAction({ card }: { card: RunCardData }) {
  if (card.state === "being_loaded") {
    return (
      <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
        The loader is still loading this run. You can collect it once they mark it ready to depart.
      </p>
    );
  }
  if (card.state === "ready") {
    return (
      <Button asChild size="lg" className="h-12 text-base font-bold">
        <Link href={`/driver/trip/overview?code=${encodeURIComponent(card.code)}${card.trip_id ? `&trip=${card.trip_id}` : ""}`}>
          Open run sheet
        </Link>
      </Button>
    );
  }
  if (card.state === "in_progress" && card.trip_id) {
    return (
      <Button asChild size="lg" className="h-12 text-base font-bold">
        <Link href={`/driver/trip?id=${card.trip_id}`}>Continue route</Link>
      </Button>
    );
  }
  if (card.trip_id) {
    return (
      <Button asChild variant="outline" size="lg" className="h-12">
        <Link href={`/driver/trip/summary?trip=${card.trip_id}`}>
          {card.checked_in ? "View trip summary" : "Trip summary · return to depot"}
        </Link>
      </Button>
    );
  }
  return null;
}
