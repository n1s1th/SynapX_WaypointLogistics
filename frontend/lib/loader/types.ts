// Loader module types, from docs/loader/API_CONTRACT.md (loader-sachintha).
//
// - "Built (L0, L4)" shapes are final: RunDetail, Vehicle, Outlet, RunStop,
//   RunOrder, Issue, ActivityEntry, and the check / uncheck / recheck writes.
// - "Proposed" shapes (queue, summary, users, session, writes) follow the
//   contract but are not final; they are read only through lib/loader/format.ts
//   so a rename stays local.
// - Fields marked "not in contract, pending Sachintha" are UI needs the
//   contract does not cover yet. They stay optional.
// - Times are ISO datetimes in UTC with a Z, shown in depot time
//   (Asia/Colombo) by lib/loader/format.ts. Delivery windows are
//   "HH:MM:SS" in depot time and shown as-is.
// - Client-only UI state (SyncState) stays camelCase.

// ---- Shared enums (contract "Shared enums") ------------------------------

export type RunStatus =
  | "not_started"
  | "loading"
  | "issue_flagged"
  | "loaded"
  | "ready_to_depart"
  | "gated_out";

// to_load  – on the plan, not yet checked
// loaded   – checked onto the vehicle
// flagged  – shortage / damage / won't fit reported to the Dispatcher
// re_check – plan change touched it; must be checked again (a check clears it)
// take_off – plan change removed it after it was loaded; unload it
// moved    – not on this trip (other vehicle or deferred), nothing to do
// new      – added in the latest plan version, not yet checked
export type OrderState =
  | "to_load"
  | "loaded"
  | "flagged"
  | "re_check"
  | "take_off"
  | "moved"
  | "new";

export type TemperatureClass = "chilled" | "ambient";
export type Brand = "fresh" | "style" | "tech";
export type DockType = "rear_dock" | "street" | "mall_bay";
export type VehicleType = "truck" | "van";
export type TempCapability = "reefer" | "ambient";
export type IssueType = "missing" | "short" | "damaged" | "wont_fit";
export type IssueStatus = "sent" | "seen" | "decided" | "default_applied";
export type ChangeKind = "unload_from_truck" | "dont_load" | "load_new" | "resequence";
export type ActorKind = "loader" | "dispatcher" | "system";
/** Fresh runs on the night wave, Style and Tech on the day wave. */
export type Wave = "night" | "day";
/**
 * stops[].status: pending until something at the stop is aboard or resolved,
 * loading once it is, complete when every active order is loaded or flagged.
 * Not shown: the load map derives its own states from the rows.
 */
export type StopStatus = "pending" | "loading" | "complete";

// ---- Built (L0): GET /loader/runs/{code} ---------------------------------

export interface Vehicle {
  code: string;
  vehicle_type: VehicleType;
  temp_capability: TempCapability;
  max_weight_kg: number;
  max_volume_m3: number;
}

export interface Outlet {
  code: string;
  name: string;
  brand: Brand;
  district: string;
  dock_type: DockType;
  van_only: boolean;
  /** "HH:MM:SS" */
  window_start: string;
  /** "HH:MM:SS" */
  window_end: string;
}

export interface RunOrder {
  order_number: string;
  temperature_class: TemperatureClass;
  units: number;
  weight_kg: number;
  volume_m3: number;
  state: OrderState;
  checked_at: string | null;
  checked_by: string | null;
  /**
   * Units of the order actually on the truck ("53 of 56"). Sent on every
   * order; optional only for runs cached before the field existed.
   */
  loaded_units?: number;
  // L7 plan diff ("Plan diff" in the contract). Optional: runs cached before
  // L7 do not carry them.
  /** Short, time-free line for the row, e.g. "Take off the truck". */
  note?: string | null;
  /** Plan version that last changed the order. */
  changed_in_version?: number | null;
  /** The diff group the order is in now. */
  change_kind?: ChangeKind | null;
  /** The Dispatcher's words for the change. */
  reason?: string | null;
  /** Where a moved order went. Null for now (pending migration fix). */
  moved_to?: MovedTo | null;
  /** Day a deferred order goes instead, "2026-05-29". Null for now. */
  deferred_to?: string | null;
  /** When and by whom a take-off order came off the truck. */
  unloaded_at?: string | null;
  unloaded_by?: string | null;
}

export interface MovedTo {
  run_code: string | null;
  vehicle_code: string;
  trip_number: number;
  departs_at: string | null;
}

export interface RunStop {
  /** Driver's route order: 1 is delivered first. */
  stop_sequence: number;
  /** Load order: 1 is loaded first (deepest, by the cab). */
  load_position: number;
  /** Null for a stop a plan change just added, until it is routed. */
  eta: string | null;
  handling_minutes: number;
  status: StopStatus;
  outlet: Outlet;
  orders: RunOrder[];
  /** L7: "was Stop 4" or "new stop"; null if the stop kept its place. */
  note?: string | null;
  /** L7: stop added in the current plan. */
  is_new?: boolean;
  /** Arrival (ETA, or departure while pending) against the outlet's window; null: no window. */
  window_status?: "ok" | "closing" | "closed" | null;
}

export interface RunCapacity {
  loaded_weight_kg: number;
  planned_weight_kg: number;
  max_weight_kg: number;
  loaded_volume_m3: number;
  planned_volume_m3: number;
  max_volume_m3: number;
}

export interface RunPlan {
  version: number;
  published_at: string;
  source: string;
  summary: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

/** RunDetailRead. Stops come ordered by load_position. */
export interface Run {
  code: string;
  trip_number: number;
  brand: Brand;
  district: string;
  wave: Wave;
  departs_at: string;
  status: RunStatus;
  current_plan_version: number;
  dock: string;
  vehicle: Vehicle;
  capacity: RunCapacity;
  plan: RunPlan;
  /** Set while a newer plan waits to be acknowledged; release stays locked. */
  unacknowledged_plan_version: number | null;
  stops: RunStop[];
  /** Counts loaded only: "x of y orders in". re_check does not count. */
  orders_loaded: number;
  /** Counts loaded and flagged: the review lock. re_check does not count. */
  orders_checked: number;
  /** Excludes take_off and moved. */
  orders_total: number;
  // L7 ("Plan diff" and "Release lock"). Optional: runs cached before L7 do
  // not carry them.
  /** Newest plan version someone acknowledged. */
  acknowledged_plan_version?: number | null;
  /** The latest change against the plan the loader last confirmed; null when there is none. */
  plan_change?: PlanChange | null;
  /** True while release_blockers lists anything. */
  release_locked?: boolean;
  /** What still stops release, in the order the footer names them. */
  release_blockers?: ReleaseBlocker[];
  // L6 ("Released"). Set only while ready_to_depart or gated_out, null
  // otherwise. Optional: runs cached before the fields existed.
  /** When the run was signed off. */
  released_at?: string | null;
  /** Who signed it off; `name` is the loader's short name ("Saman J."). */
  released_by?: ReleasedBy | null;
}

export interface ReleasedBy {
  id: number;
  name: string;
}

export interface PlanChange {
  from_version: number;
  to_version: number;
  published_at: string;
  summary: string | null;
  planned_weight_before_kg: number;
  planned_weight_after_kg: number;
  planned_volume_before_m3: number;
  planned_volume_after_m3: number;
  /** "Your 5 checked orders are saved" */
  checks_saved: number;
  /** Set when this change reopened a Ready run: "was Ready 01:48". */
  was_ready_at: string | null;
}

export type ReleaseBlockerCode =
  | "plan_not_acknowledged"
  | "unload_pending"
  | "re_check_pending"
  | "orders_open"
  | "issue_waiting";

export interface ReleaseBlocker {
  code: ReleaseBlockerCode;
  count: number;
}

// ---- Built (L0): activity and issues -------------------------------------

/**
 * Known activity types. The set is open: L8 (and L5/L6) add more, so a type
 * this list does not name is still shown, by its summary.
 */
export type ActivityType =
  | "plan_published"
  | "plan_acknowledged"
  | "order_checked"
  | "order_unchecked"
  | "order_rechecked"
  | "order_unloaded"
  | "load_reopened"
  | "issue_flagged"
  | "issue_decided"
  | "issue_default_applied"
  | "run_released"
  | "run_release_undone"
  | (string & {});

/** RunActivityEventRead: one entry of GET /loader/runs/{code}/activity, newest first. */
export interface ActivityEntry {
  id: number;
  type: ActivityType;
  at: string;
  actor: {
    kind: ActorKind;
    /** "Saman J." for a loader; the logged label for the dispatcher or the system. */
    name: string | null;
    /** Loaders only. */
    full_name: string | null;
  };
  stop: { sequence: number; outlet_code: string } | null;
  order: { order_number: string } | null;
  /** The loader's wording (Figma T1c): "ORD0092308 unloaded → chiller". */
  summary: string;
  details: Record<string, unknown>;
}

export interface IssueOption {
  label: string;
  detail: string;
  is_default: boolean;
  is_chosen: boolean;
}

/** IssueDetailRead. */
export interface LoaderIssue {
  id: number;
  run_code: string;
  order_number: string;
  outlet_code: string;
  issue_type: IssueType;
  units_affected: number;
  units_total: number;
  quick_note_tag: string | null;
  note: string | null;
  photo_path: string | null;
  reported_by: string;
  reported_at: string;
  status: IssueStatus;
  seen_at: string | null;
  decide_by: string;
  decided_at: string | null;
  decided_by: string | null;
  options: IssueOption[];
}

// ---- Proposed (L2, L3): users, session, queue, summary -------------------

export interface LoaderUser {
  id: number;
  full_name: string;
  short_name: string;
}

export interface LoaderSession {
  session_id: number;
  loader: { id: number; short_name: string };
  dock: string;
  depot: string;
  started_at: string;
}

/** POST /loader/session body. The PIN is checked on the server only. */
export interface SessionRequest {
  loader_user_id: number;
  pin: string;
  /** Which tablet is signing in; the server knows its dock. */
  dock_tablet_label: string;
}

/** end_reason of DELETE /loader/session/{id}. */
export type SessionEndReason = "idle_timeout" | "switch_user" | "sign_out";

export type RunAlertTone = "warning" | "error" | "success" | "neutral";

export interface RunAlert {
  tone: RunAlertTone;
  message: string;
  action: string;
  href: string;
}

export interface RunSummary {
  code: string;
  vehicle_code: string;
  vehicle_type: VehicleType;
  temp_capability: TempCapability;
  trip_number: number;
  brand: Brand;
  district: string;
  departs_at: string;
  status: RunStatus;
  stop_count: number;
  /** The card's "x of y loaded". */
  orders_loaded: number;
  orders_checked: number;
  orders_total: number;
  loader: string | null;
  // Contract fields the card does not read yet. Optional until the route exists.
  released_at?: string | null;
  released_by?: ReleasedBy | null;
  /** The current plan's publish time; null if the run has none. */
  plan_updated_at?: string | null;
  /** Always null for now: its source is still to be agreed with the dispatcher team. */
  pre_stage_note?: string | null;
  /** Display strings, e.g. ["Truck", "Reefer", "5,510 kg · 26.4 m³"]. */
  chips: string[];
  alert: RunAlert | null;
}

export interface RunGroup {
  label: string;
  brand: Brand;
  wave: Wave;
  runs: RunSummary[];
}

export interface RunQueue {
  groups: RunGroup[];
}

export interface QueueSummary {
  dock: string;
  date: string;
  day_label: string;
  next_holiday: { date: string; label: string } | null;
  runs: number;
  loading: { count: number; loaders: string[] };
  issues: { count: number; label: string };
  ready: { count: number; run_codes: string[] };
  /** Latest plan publish across the dock ("Plan from Dispatcher · updated 02:14"); null when none. */
  plan_updated_at?: string | null;
}

// ---- Offline writes -------------------------------------------------------

export type QueuedActionType =
  | "check"
  | "uncheck"
  | "recheck"
  | "unload"
  | "flag"
  | "acknowledge"
  | "release"
  | "release_undo";

/**
 * Offline write, stored in IndexedDB. client_action_id (crypto.randomUUID())
 * is generated once per tap and sent in the JSON body; the server answers a
 * replayed id with 200 and the resource as it is now, so retries are safe.
 */
export interface QueuedAction {
  client_action_id: string;
  action_type: QueuedActionType;
  run_code: string;
  payload: QueuedActionPayload;
  /**
   * Plan version on screen when tapped. Sent in every write body; the server
   * refuses a write made on a plan that is no longer current.
   */
  plan_version: number;
  created_at: string;
  attempts: number;
  /** Client-only: pending until sent; conflict (409) and failed are not retried. */
  status: QueuedActionStatus;
  last_error?: string;
  /** Set with status conflict: the 409's detail.code. */
  conflict_code?: ConflictCode;
  /** PLAN_VERSION_STALE only: the run's plan version when the write was refused. */
  current_plan_version?: number;
}

export type QueuedActionStatus = "pending" | "conflict" | "failed";

/**
 * detail.code of a 409 (API_CONTRACT.md "Errors"). None is retried:
 * - PLAN_VERSION_STALE: made on a plan that is no longer current.
 * - PLAN_NOT_ACKNOWLEDGED: a row write while the current plan is unread (L7).
 * - RELEASE_LOCKED: release refused while release_blockers lists anything (L6).
 * - UNDO_WINDOW_EXPIRED: undo after the window (L6); detail carries
 *   released_at and window_seconds.
 * - CLIENT_ACTION_ID_REUSED: the id was already used for another action (a client bug).
 * - INVALID_STATE_TRANSITION: the row or run no longer allows it (for undo:
 *   the run is no longer ready to depart).
 */
export type ConflictCode =
  | "PLAN_VERSION_STALE"
  | "PLAN_NOT_ACKNOWLEDGED"
  | "RELEASE_LOCKED"
  | "UNDO_WINDOW_EXPIRED"
  | "CLIENT_ACTION_ID_REUSED"
  | "INVALID_STATE_TRANSITION";

/** Refused because the plan moved on: the refetch brings the plan-change takeover. */
export function isPlanConflict(code: ConflictCode | undefined): boolean {
  return code === "PLAN_VERSION_STALE" || code === "PLAN_NOT_ACKNOWLEDGED";
}

/**
 * Every write carries the loader session. Null until L2 sign-in exists: the
 * server applies the write and leaves checked_by empty. An id the server does
 * not know is a 404.
 */
export interface SessionPayload {
  loader_session_id: number | null;
}

/** check / uncheck / recheck / unload. */
export interface OrderActionPayload extends SessionPayload {
  order_number: string;
}

/** POST /loader/issues body (minus client_action_id). */
export interface FlagActionPayload extends SessionPayload {
  run_code: string;
  order_number: string;
  issue_type: IssueType;
  units_affected: number;
  quick_note_tag: string | null;
  note: string;
}

/** acknowledge / release / release_undo: session only. */
export type QueuedActionPayload = OrderActionPayload | FlagActionPayload | SessionPayload;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a screen passes when it acts; the session is added by the outbox hook. */
export type ActionInput = DistributiveOmit<QueuedActionPayload, "loader_session_id">;

/** Client-only connectivity and outbox state (not an API shape). */
export interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  /** Writes refused because the plan changed (PLAN_VERSION_STALE, PLAN_NOT_ACKNOWLEDGED). */
  stale: number;
  /** Other writes that were refused or failed and will not be retried. */
  failed: number;
  lastSyncedAt?: string;
}
