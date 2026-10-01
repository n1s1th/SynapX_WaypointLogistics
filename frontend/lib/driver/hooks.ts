"use client";

// Data hooks for the driver screens. Each shows the phone's copy first (so the
// app opens with no signal), then refreshes from the server when it can.

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useDriver } from "@/components/driver/driver-provider";
import { driverApi } from "./api";
import {
  getCachedSheet,
  getCachedTrip,
  getValue,
  putCachedSheet,
  putCachedTrip,
  putValue,
} from "./offline/db";
import { withPending } from "./offline/outbox";
import type { Availability, DriverMe, DriverStop, DriverTrip, RunCard, RunSheet } from "./types";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  /** A real refusal from the server (not just "no signal"). */
  error: string | null;
  /** Showing the copy saved on the phone. */
  fromCache: boolean;
  savedAt: string | null;
  reload: () => void;
}

interface Loader<T> {
  readCache: () => Promise<{ value: T; saved_at: string } | undefined>;
  fetch: () => Promise<T>;
  writeCache: (value: T) => Promise<void>;
}

interface State<T> {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  savedAt: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function useResource<T>(key: string | null, loader: Loader<T>): Resource<T> {
  const { dataVersion, reportReachable } = useDriver();
  const [state, setState] = React.useState<State<T>>({
    key: null, data: null, loading: true, error: null, fromCache: false, savedAt: null,
  });
  const [reloads, setReloads] = React.useState(0);

  const load = React.useEffectEvent(async (isCancelled: () => boolean) => {
    try {
      const cached = await loader.readCache();
      if (cached && !isCancelled()) {
        setState({ key, data: cached.value, loading: true, error: null, fromCache: true, savedAt: cached.saved_at });
      }
    } catch {
      // No IndexedDB: carry on with the network.
    }
    try {
      const fresh = await loader.fetch();
      if (isCancelled()) return;
      reportReachable(true);
      setState({ key, data: fresh, loading: false, error: null, fromCache: false, savedAt: new Date().toISOString() });
      try {
        await loader.writeCache(fresh);
      } catch {
        // Not cached: fine while online.
      }
    } catch (err) {
      if (isCancelled()) return;
      const noSignal = !(err instanceof ApiError) || err.isNetworkError;
      if (noSignal) reportReachable(false);
      setState((previous) => ({
        ...previous,
        key,
        loading: false,
        error: noSignal ? null : errorMessage(err),
        fromCache: previous.key === key && previous.data !== null,
      }));
    }
  });

  React.useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [key, dataVersion, reloads]);

  const current = state.key === key;
  const data = current ? state.data : null;
  return {
    data,
    // Loading only while there is nothing to show; a cached copy is shown while it refreshes.
    loading: key !== null && data === null && (!current || state.loading),
    error: current ? state.error : null,
    fromCache: current && state.fromCache,
    savedAt: current ? state.savedAt : null,
    reload: () => setReloads((n) => n + 1),
  };
}

export function useMe(): Resource<DriverMe> {
  return useResource("me", {
    readCache: () => getValue<DriverMe>("me"),
    fetch: driverApi.me,
    writeCache: (value) => putValue("me", value),
  });
}

export function useRuns(): Resource<RunCard[]> {
  return useResource("runs", {
    readCache: () => getValue<RunCard[]>("runs"),
    fetch: driverApi.runs,
    writeCache: (value) => putValue("runs", value),
  });
}

export function useRunSheet(code: string | null): Resource<RunSheet> {
  return useResource(code ? `sheet:${code}` : null, {
    readCache: async () => {
      const sheet = code ? await getCachedSheet(code) : undefined;
      return sheet ? { value: sheet, saved_at: "" } : undefined;
    },
    fetch: () => driverApi.runSheet(code as string),
    writeCache: putCachedSheet,
  });
}

/** The trip as the driver sees it: the server's copy plus records not yet sent. */
export function useTrip(tripId: number | null): Resource<DriverTrip> {
  const { outbox } = useDriver();
  const resource = useResource(tripId ? `trip:${tripId}` : null, {
    readCache: async () => {
      const trip = tripId ? await getCachedTrip(tripId) : undefined;
      return trip ? { value: trip, saved_at: "" } : undefined;
    },
    fetch: () => driverApi.trip(tripId as number),
    writeCache: putCachedTrip,
  });
  const data = React.useMemo(
    () => (resource.data ? withPending(resource.data, outbox) : null),
    [resource.data, outbox],
  );
  return { ...resource, data };
}

/** The trip and stop a stop screen is about (?trip=12&stop=34). */
export function useTripStop(): { trip: Resource<DriverTrip>; stop: DriverStop | null; tripId: number | null } {
  const params = useSearchParams();
  const tripId = Number(params.get("trip")) || null;
  const stopId = Number(params.get("stop")) || null;
  const trip = useTrip(tripId);
  const stop = trip.data?.stops.find((item) => item.id === stopId) ?? null;
  return { trip, stop, tripId };
}

export function useAvailability(): Resource<Availability> {
  return useResource("availability", {
    readCache: () => getValue<Availability>("availability"),
    fetch: driverApi.availability,
    writeCache: (value) => putValue("availability", value),
  });
}

/** The trip on the road, from the run list (cached when offline). */
export function useActiveTripId(): { tripId: number | null; loading: boolean } {
  const runs = useRuns();
  const active = runs.data?.find((card) => card.state === "in_progress" && card.trip_id != null);
  return { tripId: active?.trip_id ?? null, loading: runs.loading && !runs.data };
}

function subscribeClock(callback: () => void) {
  const timer = window.setInterval(callback, 15_000);
  return () => window.clearInterval(timer);
}

const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The current time to the minute, for "window closes in 12 min". Null while
 * rendering on the server, so prerendered pages don't show the build time. */
export function useNow(): Date | null {
  const minute = React.useSyncExternalStore(subscribeClock, currentMinute, () => null);
  return React.useMemo(() => (minute === null ? null : new Date(minute)), [minute]);
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  at: number;
}

export type GeoStatus = "off" | "locating" | "ok" | "denied" | "unavailable";

const noSubscription = () => () => {};

/** The phone's position while `enabled`. Only asks for permission when enabled. */
export function useGeolocation(enabled: boolean): { fix: GeoFix | null; status: GeoStatus } {
  const supported = React.useSyncExternalStore(noSubscription, () => "geolocation" in navigator, () => false);
  const [fix, setFix] = React.useState<GeoFix | null>(null);
  const [failure, setFailure] = React.useState<"denied" | "unavailable" | null>(null);

  React.useEffect(() => {
    if (!enabled || !supported) return;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setFailure(null);
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        });
      },
      (error) => setFailure(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, supported]);

  if (!enabled) return { fix: null, status: "off" };
  if (!supported) return { fix: null, status: "unavailable" };
  return { fix, status: failure ?? (fix ? "ok" : "locating") };
}

/** Great-circle distance in km. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
