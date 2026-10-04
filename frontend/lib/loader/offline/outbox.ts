// Offline outbox: every loader write becomes a QueuedAction with a
// client_action_id, is applied to the cached run straight away, and is sent
// later by the sync engine. The server answers a replayed client_action_id
// with 200 and the resource as it is now, so retries are safe.

import { withRecomputedCounts } from "../format";
import type {
  FlagActionPayload,
  OrderActionPayload,
  OrderState,
  QueuedAction,
  QueuedActionPayload,
  QueuedActionType,
  Run,
  RunStatus,
} from "../types";
import { putOutboxAction } from "./db";

export interface NewAction {
  action_type: QueuedActionType;
  run_code: string;
  plan_version: number;
  payload: QueuedActionPayload;
}

/** Save a write to the outbox. Call once per tap; retries reuse the id. */
export async function enqueue(input: NewAction): Promise<QueuedAction> {
  const action: QueuedAction = {
    ...input,
    client_action_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  await putOutboxAction(action);
  return action;
}

// ---- Requests ----------------------------------------------------------

export interface ActionRequest {
  method: "POST" | "DELETE";
  /** Relative to /api/v1. */
  path: string;
  /** Always carries client_action_id. */
  body: Record<string, unknown>;
}

const enc = encodeURIComponent;

function orderPath(a: QueuedAction, verb: string): string {
  const { order_number } = a.payload as OrderActionPayload;
  return `/loader/runs/${enc(a.run_code)}/orders/${enc(order_number)}/${verb}`;
}

const runPath = (a: QueuedAction) => `/loader/runs/${enc(a.run_code)}`;

// Paths from docs/reference/loader/API_CONTRACT.md. The contract names unload and
// acknowledge without paths; those two follow LOADER_FEATURES.md (L7).
// Uncheck is a DELETE with a JSON body, like every other write.
const ENDPOINTS: Record<QueuedActionType, (a: QueuedAction) => Pick<ActionRequest, "method" | "path">> = {
  check: (a) => ({ method: "POST", path: orderPath(a, "check") }),
  uncheck: (a) => ({ method: "DELETE", path: orderPath(a, "check") }),
  recheck: (a) => ({ method: "POST", path: orderPath(a, "recheck") }),
  unload: (a) => ({ method: "POST", path: orderPath(a, "unload") }),
  flag: () => ({ method: "POST", path: "/loader/issues" }),
  acknowledge: (a) => ({ method: "POST", path: `${runPath(a)}/plan/${a.plan_version}/acknowledge` }),
  release: (a) => ({ method: "POST", path: `${runPath(a)}/release` }),
  release_undo: (a) => ({ method: "POST", path: `${runPath(a)}/release/undo` }),
};

/**
 * JSON body: client_action_id, plan_version and loader_session_id on every
 * write. The flag body is the full POST /loader/issues payload; the rest carry
 * nothing else (run code and order number are in the path).
 */
function bodyFor(action: QueuedAction): Record<string, unknown> {
  const base = {
    client_action_id: action.client_action_id,
    plan_version: action.plan_version,
    loader_session_id: action.payload.loader_session_id,
  };
  return action.action_type === "flag" ? { ...(action.payload as FlagActionPayload), ...base } : base;
}

export function requestFor(action: QueuedAction): ActionRequest {
  return { ...ENDPOINTS[action.action_type](action), body: bodyFor(action) };
}

// ---- Optimistic apply --------------------------------------------------

// check confirms a re_check row too (the checklist sends check for every
// tap); recheck is the explicit form. uncheck goes back to to_load here; the server sends a new order back to
// new, and its copy replaces this one after the sync.
const ORDER_STATE_AFTER: Partial<Record<QueuedActionType, OrderState>> = {
  check: "loaded",
  recheck: "loaded",
  uncheck: "to_load",
  unload: "moved",
  flag: "flagged",
};

/**
 * Apply an action to a run locally, so the checklist shows the result before
 * the server confirms it. Returns a new run with counts and capacity
 * recomputed; the input is not changed.
 */
export function applyAction(run: Run, action: QueuedAction, actorName?: string, actorId?: number): Run {
  const by = actorName ?? null;

  switch (action.action_type) {
    case "acknowledge":
      // Recounted so the release lock drops plan_not_acknowledged.
      return withRecomputedCounts({
        ...run,
        current_plan_version: action.plan_version,
        unacknowledged_plan_version: null,
        acknowledged_plan_version: action.plan_version,
        plan: { ...run.plan, version: action.plan_version, acknowledged_at: action.created_at, acknowledged_by: by },
      });
    case "release":
      return {
        ...run,
        status: "ready_to_depart",
        released_at: action.created_at,
        // Without the loader's id the name is left out rather than guessed.
        released_by: by && actorId != null ? { id: actorId, name: by } : null,
      };
    case "release_undo":
      // Release needs every order checked, so an undone run is loaded again.
      return { ...run, status: "loaded", released_at: null, released_by: null };
  }

  const nextState = ORDER_STATE_AFTER[action.action_type];
  const { order_number } = action.payload as OrderActionPayload | FlagActionPayload;
  if (!nextState || !order_number) return run;

  const loaded = nextState === "loaded";
  const next: Run = {
    ...run,
    stops: run.stops.map((stop) => ({
      ...stop,
      orders: stop.orders.map((order) =>
        order.order_number !== order_number
          ? order
          : {
              ...order,
              state: nextState,
              checked_at: loaded ? action.created_at : null,
              checked_by: loaded ? by : null,
            },
      ),
    })),
  };
  const counted = withRecomputedCounts(next);
  return { ...counted, status: statusAfter(counted, action.action_type) };
}

/**
 * Run status after an order write, as the server sets it: loading from the
 * first write, loaded once every order is checked or flagged, back to loading
 * on an uncheck. A flag moves the run to issue_flagged, which only the
 * Dispatcher's decision clears; signed-off runs are left alone.
 */
function statusAfter(run: Run, type: QueuedActionType): RunStatus {
  if (type === "flag") return "issue_flagged";
  if (run.status === "issue_flagged" || run.status === "ready_to_depart" || run.status === "gated_out") {
    return run.status;
  }
  return run.orders_total > 0 && run.orders_checked === run.orders_total ? "loaded" : "loading";
}
