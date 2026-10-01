"use client";

// Home: the driver's trips for the day (up to two per vehicle), what to do next
// with each, and "ready for tomorrow". Opens from the phone's copy with no signal.

import Link from "next/link";
import { CloudOff, RefreshCw, Truck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DriverShell } from "@/components/driver/driver-shell";
import { Notice } from "@/components/driver/notice";
import { ReadyTomorrowCard } from "@/components/driver/ready-tomorrow-card";
import { RunCard } from "@/components/driver/run-card";
import { formatDay, formatTime } from "@/lib/driver/format";
import { useMe, useNow, useRuns } from "@/lib/driver/hooks";

function greeting(now: Date | null): string {
  if (!now) return "Hello";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DriverHomePage() {
  const now = useNow();
  const me = useMe();
  const runs = useRuns();
  const cards = runs.data ?? [];
  const focus = cards.find((card) => card.state === "in_progress") ?? cards.find((card) => card.state === "ready");
  const completed = cards.filter((card) => card.state === "completed").length;
  const hasWorkToday = cards.some((card) => card.state === "in_progress" || card.state === "completed");
  const firstName = me.data?.full_name.split(" ")[0];

  return (
    <DriverShell
      title={now ? `Today · ${formatDay(now)}` : "Today"}
      subtitle={
        me.data
          ? `${greeting(now)}, ${firstName} · ${me.data.driver_code}${me.data.vehicle ? ` · ${me.data.vehicle.code}` : ""}`
          : `${greeting(now)}`
      }
      tab="home"
      action={
        <Link
          href="/driver/profile"
          aria-label="Profile"
          className="flex size-11 items-center justify-center rounded-full bg-info-muted text-info focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <User className="size-5" aria-hidden />
        </Link>
      }
    >
      {runs.fromCache && (
        <Notice tone="warning" icon={CloudOff} title="Showing trips saved on this phone">
          {runs.savedAt ? `Last updated ${formatTime(runs.savedAt)}. ` : ""}They refresh when the connection returns.
        </Notice>
      )}
      {runs.error && (
        <Notice tone="destructive" icon={RefreshCw} title="Couldn't load your trips">
          {runs.error}
        </Notice>
      )}
      {me.data && !me.data.vehicle && (
        <Notice tone="info" icon={Truck} title="No vehicle assigned to you yet">
          Your trips appear here once dispatch assigns you a vehicle.
        </Notice>
      )}

      <ReadyTomorrowCard now={now} hasWorkToday={hasWorkToday} />

      {runs.loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : cards.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-8 text-center">
          <Truck className="size-8 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="font-bold">No trips for you right now</span>
            <span className="text-sm text-muted-foreground">
              A run shows here when dispatch plans your vehicle and the loader starts loading it.
            </span>
          </div>
          <Button variant="outline" size="lg" className="h-11" onClick={runs.reload}>
            <RefreshCw aria-hidden />
            Check again
          </Button>
        </section>
      ) : (
        cards.map((card) => <RunCard key={card.code} card={card} highlight={card === focus} />)
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 rounded-xl bg-brand-strong p-3.5 text-white">
            <span className="text-2xl font-bold">{cards.length}</span>
            <span className="text-xs text-white/75">Trips</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3.5">
            <span className="text-2xl font-bold">{completed}</span>
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
        </div>
      )}
    </DriverShell>
  );
}
