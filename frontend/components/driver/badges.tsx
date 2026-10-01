// Status badges for the driver screens. Semantic tokens only, each with an
// icon and words (frontend/AGENTS.md status conventions).

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  CircleDot,
  Clock,
  MapPinCheck,
  Package,
  PackageMinus,
  PackageX,
  Snowflake,
  Truck,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { minutesLabel, stopStatusLabel, windowLabel, windowState } from "@/lib/driver/format";
import type { OutletRef, RunState, StopStatus, StopTiming } from "@/lib/driver/types";

type Tone = "neutral" | "info" | "success" | "warning" | "destructive";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-muted text-info",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  destructive: "bg-destructive-muted text-destructive",
};

export function Pill({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

const STOP_TONES: Record<StopStatus, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { tone: "neutral", icon: CircleDot },
  arrived: { tone: "info", icon: MapPinCheck },
  delivered: { tone: "success", icon: CheckCircle2 },
  partial: { tone: "warning", icon: PackageMinus },
  failed: { tone: "destructive", icon: PackageX },
  rescheduled: { tone: "destructive", icon: Ban },
};

export function StopStatusBadge({ status }: { status: StopStatus }) {
  const { tone, icon } = STOP_TONES[status];
  return (
    <Pill tone={tone} icon={icon}>
      {stopStatusLabel(status)}
    </Pill>
  );
}

const RUN_STATES: Record<RunState, { tone: Tone; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  being_loaded: { tone: "neutral", icon: Warehouse, label: "Being loaded" },
  ready: { tone: "success", icon: CheckCircle2, label: "Ready to collect" },
  in_progress: { tone: "info", icon: Truck, label: "On the road" },
  completed: { tone: "neutral", icon: CheckCircle2, label: "Completed" },
};

export function RunStateBadge({ state }: { state: RunState }) {
  const { tone, icon, label } = RUN_STATES[state];
  return (
    <Pill tone={tone} icon={icon}>
      {label}
    </Pill>
  );
}

export function TemperatureChip({ chilled }: { chilled: boolean }) {
  return chilled ? (
    <Pill tone="info" icon={Snowflake}>
      Chilled
    </Pill>
  ) : (
    <Pill icon={Package}>Ambient</Pill>
  );
}

/** Arrival against the window: early (wait), on time, or late. */
export function TimingBadge({ timing }: { timing: StopTiming | null }) {
  if (!timing) return null;
  if (timing.status === "early") {
    return (
      <Pill tone="info" icon={Clock}>
        Early · window opens in {minutesLabel(timing.minutes)}
      </Pill>
    );
  }
  if (timing.status === "late") {
    return (
      <Pill tone="destructive" icon={Clock}>
        Late · {minutesLabel(timing.minutes)} after window
      </Pill>
    );
  }
  return (
    <Pill tone="success" icon={Clock}>
      On time
    </Pill>
  );
}

/** "05:00–07:30", with how it stands now for a stop not reached yet. */
export function WindowChip({ outlet, now }: { outlet: OutletRef | null | undefined; now?: Date | null }) {
  const label = windowLabel(outlet);
  if (!label) return null;
  const state = now ? windowState(outlet, now) : null;
  if (state?.kind === "closed") {
    return (
      <Pill tone="destructive" icon={Clock}>
        {label} · closed {minutesLabel(state.minutesAgo)} ago
      </Pill>
    );
  }
  if (state?.kind === "open" && state.minutesLeft <= 30) {
    return (
      <Pill tone="warning" icon={Clock}>
        {label} · closes in {minutesLabel(state.minutesLeft)}
      </Pill>
    );
  }
  return (
    <Pill icon={Clock}>
      Window {label}
    </Pill>
  );
}
