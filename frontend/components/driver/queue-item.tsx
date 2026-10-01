// One record in the sync queue: what it is, when it was made, and where it stands.

import {
  CalendarCheck,
  CheckCircle2,
  MapPinCheck,
  PackageCheck,
  PenTool,
  Siren,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { formatTime } from "@/lib/driver/format";
import type { ActionType, QueuedAction } from "@/lib/driver/types";
import { Pill } from "./badges";

const KINDS: Record<ActionType, { label: string; icon: typeof MapPinCheck }> = {
  arrive: { label: "Arrival", icon: MapPinCheck },
  outcome: { label: "Delivery outcome", icon: PackageCheck },
  pod: { label: "Proof of delivery", icon: PenTool },
  complete_stop: { label: "Stop closed", icon: CheckCircle2 },
  issue: { label: "Problem report", icon: TriangleAlert },
  complete_trip: { label: "Trip complete", icon: CheckCircle2 },
  checkin: { label: "Depot check-in", icon: Warehouse },
  sos: { label: "SOS", icon: Siren },
  ready_tomorrow: { label: "Availability", icon: CalendarCheck },
};

export function QueueItem({ item }: { item: QueuedAction }) {
  const kind = KINDS[item.action_type];
  const Icon = kind.icon;
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{kind.label}</span>
        <span className="truncate text-sm font-semibold">{item.label}</span>
        <span className="truncate text-xs text-muted-foreground">
          Saved on phone {formatTime(item.created_at)}
          {item.status === "pending" && item.attempts > 0 ? ` · ${item.attempts} tr${item.attempts === 1 ? "y" : "ies"} so far` : ""}
          {item.status !== "pending" && item.last_error ? ` · ${item.last_error}` : ""}
        </span>
      </div>
      {item.status === "pending" && <Pill tone="warning">Waiting</Pill>}
      {item.status === "conflict" && <Pill tone="destructive">Conflict</Pill>}
      {item.status === "failed" && <Pill tone="destructive">Rejected</Pill>}
    </div>
  );
}
