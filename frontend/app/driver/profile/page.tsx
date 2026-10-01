"use client";

// Profile: who's signed in, their vehicle and depot, sync state, and sign-out
// (which warns when records are still waiting on the phone).

import * as React from "react";
import Link from "next/link";
import { CloudCheck, CloudOff, LogOut, Snowflake, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoTools } from "@/components/driver/demo-tools";
import { DriverShell } from "@/components/driver/driver-shell";
import { useDriver } from "@/components/driver/driver-provider";
import { DEMO_TOOLS_ENABLED } from "@/lib/driver/demo";
import { formatTime, titleCase } from "@/lib/driver/format";
import { useMe } from "@/lib/driver/hooks";

export default function ProfilePage() {
  const me = useMe();
  const { pendingCount, conflictCount, lastSync, online, signOut } = useDriver();
  const [confirming, setConfirming] = React.useState(false);
  const unsent = pendingCount + conflictCount;
  const data = me.data;
  const initials = data?.full_name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DriverShell title="Profile" subtitle="Your account and vehicle" backHref="/driver" tab="home">
      {!data ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <section className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-info-muted text-lg font-bold text-info">
            {initials}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lg font-bold">{data.full_name}</span>
            <span className="text-xs font-semibold text-muted-foreground">{data.driver_code}</span>
            <span className="truncate text-xs text-muted-foreground">{data.email}</span>
            {data.phone && <span className="text-xs text-muted-foreground">{data.phone}</span>}
          </div>
        </section>
      )}

      <section aria-labelledby="vehicle" className="flex flex-col gap-2 rounded-xl border-2 border-info bg-info-muted p-4">
        <h2 id="vehicle" className="flex items-center gap-2 text-sm font-bold text-info">
          <Truck className="size-5" aria-hidden />
          Assigned vehicle
        </h2>
        {data?.vehicle ? (
          <>
            <span className="text-2xl font-bold">{data.vehicle.code}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {titleCase(data.vehicle.type)}
              {data.vehicle.temperature_mode === "reefer" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-info">
                  <Snowflake className="size-4" aria-hidden />
                  Refrigerated
                </span>
              ) : (
                <span>Ambient</span>
              )}
              {data.depot ? `· ${data.depot.name}` : ""}
            </span>
            {data.license_type && <span className="text-xs text-muted-foreground">Licence: {data.license_type}</span>}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{data ? "No vehicle assigned yet. Dispatch assigns one." : "Loading…"}</span>
        )}
      </section>

      <Link
        href="/driver/queue"
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {online && unsent === 0 ? (
          <CloudCheck className="size-6 text-success" aria-hidden />
        ) : (
          <CloudOff className="size-6 text-warning" aria-hidden />
        )}
        <span className="flex flex-col">
          <span className="text-sm font-bold">{unsent === 0 ? "All records synced" : `${unsent} record${unsent === 1 ? "" : "s"} on this phone`}</span>
          <span className="text-xs text-muted-foreground">
            {lastSync ? `Last sync ${formatTime(lastSync.at)}` : online ? "Connected" : "No connection"}
          </span>
        </span>
      </Link>

      {DEMO_TOOLS_ENABLED && <DemoTools />}

      <Button
        variant="outline"
        size="lg"
        className="h-12 border-2 border-destructive font-bold text-destructive hover:bg-destructive-muted"
        onClick={() => (unsent > 0 ? setConfirming(true) : void signOut())}
      >
        <LogOut aria-hidden />
        Sign out
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sign out with {unsent} record{unsent === 1 ? "" : "s"} not synced?</DialogTitle>
            <DialogDescription>
              They stay on this phone and sync after you sign in again. Signing out on a shared phone? Sync first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="lg" className="h-11" onClick={() => setConfirming(false)}>
              Stay signed in
            </Button>
            <Button variant="destructive" size="lg" className="h-11" onClick={() => void signOut()}>
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DriverShell>
  );
}
