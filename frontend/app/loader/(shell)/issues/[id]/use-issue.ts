"use client";

import * as React from "react";
import { useLoaderSync } from "@/components/loader/loader-sync-provider";
import { isIssueWaiting } from "@/lib/loader/format";
import { cachedIssue, loadIssue } from "@/lib/loader/offline/issue-cache";
import type { LoaderIssue } from "@/lib/loader/types";

/** How often a waiting issue is asked for again. */
const POLL_MS = 15_000;

export type IssueState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "unavailable" }
  // "checking": this tablet's last copy, shown while the server is asked. It
  // only becomes "cache" (the offline chip) once the server cannot be reached.
  | { status: "ready"; issue: LoaderIssue; fetchedAt: string; source: "server" | "cache" | "checking" };

/**
 * One issue (GET /loader/issues/{id}): this tablet's last copy at once, then
 * the server's. While it waits on the Dispatcher it is asked for again every
 * 15 s, after each sync and when the tab comes back; once decided (or the
 * default applied) the answer is final and polling stops.
 */
export function useIssue(id: number, dock: string | undefined): IssueState {
  const { transport, sync } = useLoaderSync();
  const [state, setState] = React.useState<IssueState>({ status: "loading" });
  // Only the newest load may update the screen.
  const seq = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const mine = ++seq.current;
    const loaded = await loadIssue(transport, id, dock);
    if (mine !== seq.current) return;
    if (loaded.kind === "ok") {
      setState({ status: "ready", issue: loaded.issue, fetchedAt: loaded.fetchedAt, source: loaded.source });
    } else {
      // Keep a copy already on screen rather than blanking it.
      setState((s) => (s.status === "ready" && loaded.kind === "unavailable" ? s : { status: loaded.kind }));
    }
  }, [transport, id, dock]);

  // The last copy first, so the screen shows at once, even offline.
  React.useEffect(() => {
    const cached = cachedIssue(id, dock);
    if (!cached) return;
    const timer = window.setTimeout(() =>
      setState((s) =>
        s.status === "ready" ? s : { status: "ready", issue: cached.issue, fetchedAt: cached.fetchedAt, source: "checking" },
      ),
    );
    return () => window.clearTimeout(timer);
  }, [id, dock]);

  const waiting = state.status !== "ready" || isIssueWaiting(state.issue);
  const waitingRef = React.useRef(waiting);
  React.useEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);

  // On open, after each sync, and when the pending count changes; not once the answer is final.
  React.useEffect(() => {
    if (!waitingRef.current) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, sync.lastSyncedAt, sync.pending]);

  React.useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, waiting]);

  return state;
}
