// Mock data for the loader UI until the /loader API is wired up, in the shapes
// of docs/reference/loader/API_CONTRACT.md. Scenario follows Figma "02 — Loader":
// Peliyagoda DC, Fresh night wave. Loaders see every dock of the depot.
//
// - mockQueue / mockSummary follow T1b (queue before plan v3 was acknowledged),
//   grouped by dock: RUN-021 is free to pick, Tharindu J. is loading RUN-027,
//   and RUN-033's truck has not arrived yet, so it is not listed.
// - RUN-021's detail matches T1c (checklist after v3 was acknowledged).
// Outlet names other than OUT027 are placeholders.

import type {
  ActivityEntry,
  LoaderIssue,
  LoaderSession,
  LoaderUser,
  Outlet,
  QueueSummary,
  Run,
  RunQueue,
} from "./types";

const DAY = "2026-05-28";
/** Depot time on DAY, sent as the API sends it: UTC with a Z. at("03:30") → "2026-05-27T22:00:00Z". */
const at = (time: string) => new Date(`${DAY}T${time}:00+05:30`).toISOString().replace(".000Z", "Z");

/** Fixed "now" for the mock scenario, so server and client render the same. */
export const mockNow = at("02:20");

export const mockUsers: LoaderUser[] = [
  { id: 1, full_name: "Saman Jayawardena", short_name: "Saman J." },
  { id: 2, full_name: "Tharindu Jayasuriya", short_name: "Tharindu J." },
  { id: 3, full_name: "Nimal Silva", short_name: "Nimal S." },
  { id: 4, full_name: "Sandun Perera", short_name: "Sandun P." },
  { id: 5, full_name: "Sanjeewa Kumara", short_name: "Sanjeewa K." },
];

/**
 * Test PINs, read only by the mock server in lib/loader/offline/transport.ts.
 * The real API never sends a PIN to the tablet.
 */
export const mockUserPins: Record<number, string> = {
  1: "4417",
  2: "2580",
  3: "1357",
  4: "8642",
  5: "9753",
};

export const mockSession: LoaderSession = {
  session_id: 12,
  loader: { id: 1, short_name: "Saman J." },
  dock: null,
  depot: "peliyagoda",
  started_at: at("01:30"),
};


const outlet = (
  code: string,
  name: string,
  dock_type: Outlet["dock_type"],
  window_start: string,
  window_end: string,
): Outlet => ({
  code,
  name,
  brand: "fresh",
  district: "Gampaha",
  dock_type,
  van_only: false,
  window_start: `${window_start}:00`,
  window_end: `${window_end}:00`,
});

const RUN_021: Run = {
  code: "RUN-021",
  trip_number: 1,
  brand: "fresh",
  district: "Gampaha",
  wave: "night",
  departs_at: at("03:30"),
  status: "loading",
  current_plan_version: 3,
  dock: "Dock 2",
  vehicle: {
    code: "VEH001",
    vehicle_type: "truck",
    temp_capability: "reefer",
    max_weight_kg: 5510,
    max_volume_m3: 26.4,
  },
  capacity: {
    loaded_weight_kg: 3410,
    planned_weight_kg: 4690,
    max_weight_kg: 5510,
    loaded_volume_m3: 16.6,
    planned_volume_m3: 22.6,
    max_volume_m3: 26.4,
  },
  plan: {
    version: 3,
    published_at: at("02:14"),
    source: "Dispatcher",
    summary: null,
    acknowledged_at: at("02:16"),
    acknowledged_by: "Saman J.",
  },
  unacknowledged_plan_version: null,
  orders_loaded: 5,
  orders_checked: 5,
  orders_total: 7,
  acknowledged_plan_version: 3,
  plan_change: {
    from_version: 2,
    to_version: 3,
    published_at: at("02:14"),
    summary: "Cold-room fault at OUT027; OUT028 must go tonight.",
    planned_weight_before_kg: 4920,
    planned_weight_after_kg: 4690,
    planned_volume_before_m3: 23.9,
    planned_volume_after_m3: 22.6,
    checks_saved: 5,
    was_ready_at: null,
  },
  release_locked: true,
  release_blockers: [{ code: "orders_open", count: 2 }],
  // Ordered by load_position, as the API returns them.
  stops: [
    {
      stop_sequence: 5,
      load_position: 1,
      eta: at("05:44"),
      handling_minutes: 16,
      status: "pending",
      outlet: outlet("OUT027", "Gampaha Market St", "street", "05:00", "07:30"),
      note: "chilled order deferred",
      orders: [
        {
          order_number: "ORD0092307",
          temperature_class: "ambient",
          units: 44,
          weight_kg: 650,
          volume_m3: 3.2,
          state: "loaded",
          checked_at: at("01:41"),
          checked_by: "Saman J.",
        },
        {
          order_number: "ORD0092308",
          temperature_class: "chilled",
          units: 26,
          weight_kg: 380,
          volume_m3: 1.9,
          state: "moved",
          checked_at: null,
          checked_by: null,
          note: "Off truck · back in chiller",
          changed_in_version: 3,
          change_kind: "unload_from_truck",
          deferred_to: "2026-05-29",
          unloaded_at: at("02:24"),
          unloaded_by: "Saman J.",
        },
      ],
    },
    {
      stop_sequence: 4,
      load_position: 2,
      eta: at("05:20"),
      handling_minutes: 18,
      status: "pending",
      outlet: outlet("OUT031", "Gampaha Bus Stand", "rear_dock", "03:00", "08:00"),
      note: "1 dry + 1 chilled",
      orders: [
        {
          order_number: "ORD0092305",
          temperature_class: "ambient",
          units: 48,
          weight_kg: 700,
          volume_m3: 3.4,
          state: "loaded",
          checked_at: at("02:26"),
          checked_by: "Saman J.",
          changed_in_version: 3,
        },
        {
          order_number: "ORD0092306",
          temperature_class: "chilled",
          units: 34,
          weight_kg: 500,
          volume_m3: 2.4,
          state: "loaded",
          checked_at: at("02:26"),
          checked_by: "Saman J.",
          changed_in_version: 3,
        },
      ],
    },
    {
      stop_sequence: 3,
      load_position: 3,
      eta: at("04:56"),
      handling_minutes: 14,
      status: "pending",
      outlet: outlet("OUT030", "Yakkala Junction", "rear_dock", "03:00", "08:00"),
      orders: [
        {
          order_number: "ORD0092303",
          temperature_class: "ambient",
          units: 50,
          weight_kg: 740,
          volume_m3: 3.6,
          state: "loaded",
          checked_at: at("02:05"),
          checked_by: "Saman J.",
        },
        {
          order_number: "ORD0092304",
          temperature_class: "chilled",
          units: 30,
          weight_kg: 440,
          volume_m3: 2.2,
          state: "moved",
          checked_at: null,
          checked_by: null,
          moved_to: { run_code: null, vehicle_code: "VEH003", trip_number: 1, departs_at: at("03:45") },
          changed_in_version: 3,
          change_kind: "dont_load",
        },
      ],
    },
    {
      stop_sequence: 2,
      load_position: 4,
      eta: at("04:32"),
      handling_minutes: 18,
      status: "pending",
      outlet: outlet("OUT026", "Miriswatte", "rear_dock", "03:00", "08:00"),
      note: "1 dry + 1 chilled",
      orders: [
        {
          order_number: "ORD0092301",
          temperature_class: "ambient",
          units: 56,
          weight_kg: 820,
          volume_m3: 4.0,
          state: "loaded",
          checked_at: at("02:20"),
          checked_by: "Saman J.",
          loaded_units: 53,
          note: "53 of 56 loaded · 3 damaged, Dispatcher agreed",
        },
        {
          order_number: "ORD0092302",
          temperature_class: "chilled",
          units: 46,
          weight_kg: 690,
          volume_m3: 3.2,
          state: "to_load",
          checked_at: null,
          checked_by: null,
          note: "Next · pick from chiller dock",
        },
      ],
    },
    {
      stop_sequence: 1,
      load_position: 5,
      eta: at("04:07"),
      handling_minutes: 12,
      status: "pending",
      outlet: outlet("OUT028", "Kadawatha", "street", "03:00", "08:00"),
      note: "deferred yesterday",
      is_new: true,
      orders: [
        {
          order_number: "ORD0092319",
          temperature_class: "ambient",
          units: 40,
          weight_kg: 590,
          volume_m3: 2.8,
          state: "new",
          checked_at: null,
          checked_by: null,
          note: "New in v3 · nothing loaded has to move",
          changed_in_version: 3,
        },
      ],
    },
  ],
};

/** Run details available offline in the mock. Other runs are queue-level only. */
// RUN-022: signed off 01:48 by Nimal S. (queue card T1b, success screen 1f).
// Outlet names are placeholders.
const RUN_022: Run = {
  code: "RUN-022",
  trip_number: 1,
  brand: "fresh",
  district: "Colombo",
  wave: "night",
  departs_at: at("03:40"),
  status: "ready_to_depart",
  current_plan_version: 2,
  dock: "Dock 2",
  vehicle: {
    code: "VEH005",
    vehicle_type: "truck",
    temp_capability: "reefer",
    max_weight_kg: 5510,
    max_volume_m3: 26.4,
  },
  capacity: {
    loaded_weight_kg: 2310,
    planned_weight_kg: 2310,
    max_weight_kg: 5510,
    loaded_volume_m3: 11.2,
    planned_volume_m3: 11.2,
    max_volume_m3: 26.4,
  },
  plan: {
    version: 2,
    published_at: at("00:40"),
    source: "Dispatcher",
    summary: null,
    acknowledged_at: at("00:44"),
    acknowledged_by: "Nimal S.",
  },
  unacknowledged_plan_version: null,
  orders_loaded: 4,
  orders_checked: 4,
  orders_total: 4,
  acknowledged_plan_version: 2,
  plan_change: null,
  release_locked: false,
  release_blockers: [],
  released_at: at("01:48"),
  released_by: { id: 3, name: "Nimal S." },
  stops: [
    {
      stop_sequence: 2,
      load_position: 1,
      eta: at("05:10"),
      handling_minutes: 15,
      status: "complete",
      outlet: { ...outlet("OUT012", "Colombo Fort", "rear_dock", "04:00", "07:45"), district: "Colombo" },
      orders: [
        {
          order_number: "ORD0092311",
          temperature_class: "ambient",
          units: 40,
          weight_kg: 600,
          volume_m3: 2.9,
          state: "loaded",
          checked_at: at("01:20"),
          checked_by: "Nimal S.",
        },
        {
          order_number: "ORD0092312",
          temperature_class: "chilled",
          units: 30,
          weight_kg: 450,
          volume_m3: 2.2,
          state: "loaded",
          checked_at: at("01:24"),
          checked_by: "Nimal S.",
        },
      ],
    },
    {
      stop_sequence: 1,
      load_position: 2,
      eta: at("04:35"),
      handling_minutes: 15,
      status: "complete",
      outlet: { ...outlet("OUT010", "Colombo Pettah", "rear_dock", "04:00", "07:45"), district: "Colombo" },
      orders: [
        {
          order_number: "ORD0092309",
          temperature_class: "ambient",
          units: 52,
          weight_kg: 760,
          volume_m3: 3.7,
          state: "loaded",
          checked_at: at("01:35"),
          checked_by: "Nimal S.",
        },
        {
          order_number: "ORD0092310",
          temperature_class: "chilled",
          units: 34,
          weight_kg: 500,
          volume_m3: 2.4,
          state: "loaded",
          checked_at: at("01:40"),
          checked_by: "Nimal S.",
        },
      ],
    },
  ],
};

export const mockRunDetails: Run[] = [RUN_021, RUN_022];

export function findMockRun(code: string): Run | undefined {
  return mockRunDetails.find((run) => run.code === code);
}

// ---- Activity (GET /loader/runs/{code}/activity) -------------------------

const saman = { kind: "loader", name: "Saman J.", full_name: "Saman Jayawardena" } as const;
const dispatcher = { kind: "dispatcher", name: "Dispatcher", full_name: null } as const;

type MockEvent = [time: string, type: string, actor: ActivityEntry["actor"], summary: string, order?: [string, number, string]];

// RUN-021 up to T1c. The last five lines are the Change log card in Figma T1c
// (the two 02:26 re-checks show there as one line, "ORD0092305/06 re-checked").
const RUN_021_EVENTS: MockEvent[] = [
  ["01:41", "order_checked", saman, "ORD0092307 loaded", ["ORD0092307", 5, "OUT027"]],
  ["01:52", "order_checked", saman, "ORD0092305 loaded", ["ORD0092305", 4, "OUT031"]],
  ["01:58", "order_checked", saman, "ORD0092306 loaded", ["ORD0092306", 4, "OUT031"]],
  ["02:05", "order_checked", saman, "ORD0092303 loaded", ["ORD0092303", 3, "OUT030"]],
  ["02:08", "issue_flagged", saman, "ORD0092301: damaged 3 of 56 units, sent to Dispatcher", ["ORD0092301", 2, "OUT026"]],
  ["02:12", "order_checked", saman, "ORD0092308 loaded", ["ORD0092308", 5, "OUT027"]],
  ["02:14", "plan_published", dispatcher, "Dispatcher published plan v3"],
  ["02:16", "plan_acknowledged", saman, "Acknowledged · Saman J."],
  ["02:20", "issue_decided", { kind: "dispatcher", name: "Kasun Perera", full_name: null }, "ORD0092301: send 53 of 56", ["ORD0092301", 2, "OUT026"]],
  ["02:24", "order_unloaded", saman, "ORD0092308 unloaded → chiller", ["ORD0092308", 5, "OUT027"]],
  ["02:26", "order_rechecked", saman, "ORD0092305 re-checked", ["ORD0092305", 4, "OUT031"]],
  ["02:26", "order_rechecked", saman, "ORD0092306 re-checked", ["ORD0092306", 4, "OUT031"]],
];

function mockEntries(events: MockEvent[]): ActivityEntry[] {
  return events
    .map(([time, type, actor, summary, order], i) => ({
      id: i + 1,
      type,
      at: at(time),
      actor,
      stop: order ? { sequence: order[1], outlet_code: order[2] } : null,
      order: order ? { order_number: order[0] } : null,
      summary,
      details: type === "order_unloaded" ? { return_area: "chiller" } : {},
    }))
    .reverse(); // newest first, as the API sends it
}

/** Each detailed run's log, newest first. */
export const mockActivity: Record<string, ActivityEntry[]> = {
  "RUN-021": mockEntries(RUN_021_EVENTS),
};

// ---- Queue (GET /loader/runs, GET /loader/summary) -----------------------

export const mockSummary: QueueSummary = {
  depot: "peliyagoda",
  dock: null,
  dock_count: 3,
  date: DAY,
  day_label: "Thu 28 May",
  next_holiday: { date: "2026-05-30", label: "Poson Sat 30 May" },
  runs: 5,
  loading: { count: 2, loaders: ["Saman", "Tharindu"] },
  issues: { count: 1, label: "Awaiting decision" },
  ready: { count: 1, run_codes: ["RUN-022"] },
};

/** Every dock of Peliyagoda with a truck in, by arrival (GET /loader/runs). */
export const mockQueue: RunQueue = {
  depot: "peliyagoda",
  docks: [
    {
      dock: "Dock 1",
      dock_code: "DOCK1",
      runs: [
        {
          dock: "Dock 1",
          stage: "loading",
          arrived_at: at("01:20"),
          picked_by: "Tharindu J.",
          picked_at: at("01:35"),
          code: "RUN-027",
          vehicle_code: "VEH035",
          vehicle_type: "van",
          temp_capability: "reefer",
          trip_number: 1,
          brand: "fresh",
          district: "Colombo",
          departs_at: at("04:30"),
          status: "issue_flagged",
          stop_count: 3,
          orders_loaded: 3,
          orders_checked: 4,
          orders_total: 5,
          loader: "Tharindu J.",
          chips: ["Van", "Reefer", "van_only"],
          alert: {
            tone: "error",
            message: "ORD0092314 missing · waiting",
            action: "Open",
            href: "/loader/issues/7",
          },
        },
        {
          dock: "Dock 1",
          stage: "at_dock",
          arrived_at: at("01:45"),
          picked_by: null,
          picked_at: null,
          code: "RUN-029",
          vehicle_code: "VEH005",
          vehicle_type: "truck",
          temp_capability: "reefer",
          trip_number: 2,
          brand: "fresh",
          district: "Colombo",
          departs_at: at("05:20"),
          status: "not_started",
          stop_count: 2,
          orders_loaded: 0,
          orders_checked: 0,
          orders_total: 3,
          loader: null,
          chips: ["Truck", "Reefer", "2nd trip · reload"],
          alert: {
            tone: "neutral",
            message: "Pre-stage ambient pallets at Bay 2",
            action: "Open",
            href: "/loader/runs/RUN-029",
          },
        },
      ],
    },
    {
      dock: "Dock 2",
      dock_code: "DOCK2",
      runs: [
        {
          dock: "Dock 2",
          stage: "ready",
          arrived_at: at("00:50"),
          picked_by: null,
          picked_at: null,
          code: "RUN-022",
          vehicle_code: "VEH005",
          vehicle_type: "truck",
          temp_capability: "reefer",
          trip_number: 1,
          brand: "fresh",
          district: "Colombo",
          departs_at: at("03:40"),
          status: "ready_to_depart",
          stop_count: 2,
          orders_loaded: 4,
          orders_checked: 4,
          orders_total: 4,
          loader: "Nimal S.",
          chips: ["Truck", "Reefer", "rear_dock 04:00–07:45"],
          alert: {
            tone: "success",
            message: "Signed off · driver can collect",
            action: "View",
            href: "/loader/runs/RUN-022/ready",
          },
        },
        {
          dock: "Dock 2",
          stage: "loading",
          arrived_at: at("01:10"),
          picked_by: null,
          picked_at: null,
          code: "RUN-021",
          vehicle_code: "VEH001",
          vehicle_type: "truck",
          temp_capability: "reefer",
          trip_number: 1,
          brand: "fresh",
          district: "Gampaha",
          departs_at: at("03:30"),
          status: "loading",
          stop_count: 4,
          orders_loaded: 5,
          orders_checked: 5,
          orders_total: 8,
          loader: "Saman J.",
          chips: ["Truck", "Reefer", "5,510 kg · 26.4 m³"],
          alert: {
            tone: "warning",
            message: "Plan updated 02:14 · v2 → v3",
            action: "Review",
            href: "/loader/runs/RUN-021",
          },
        },
      ],
    },
    {
      dock: "Dock 4",
      dock_code: "DOCK4",
      runs: [
        {
          dock: "Dock 4",
          stage: "at_dock",
          arrived_at: at("01:55"),
          picked_by: null,
          picked_at: null,
          code: "RUN-031",
          vehicle_code: "VEH012",
          vehicle_type: "truck",
          temp_capability: "ambient",
          trip_number: 1,
          brand: "style",
          district: "Colombo",
          departs_at: at("06:00"),
          status: "not_started",
          stop_count: 3,
          orders_loaded: 0,
          orders_checked: 0,
          orders_total: 3,
          loader: null,
          chips: ["Truck", "Ambient", "3,200 kg · 18.0 m³"],
          alert: null,
        },
      ],
    },
  ],
};

// ---- Issues (GET /loader/issues, /loader/issues/{id}) ----------------------

export const mockIssues: LoaderIssue[] = [
  {
    // Figma 1d / T1e: flagged 02:13, the Dispatcher answered 02:20.
    id: 3,
    run_code: "RUN-021",
    order_number: "ORD0092301",
    outlet_code: "OUT026",
    issue_type: "damaged",
    units_affected: 3,
    units_total: 56,
    quick_note_tag: "Crushed carton",
    note: null,
    photo_path: null,
    reported_by: "Saman J.",
    reported_at: at("02:13"),
    status: "decided",
    seen_at: at("02:15"),
    decide_by: at("03:10"),
    decided_at: at("02:20"),
    decided_by: "Kasun P.",
    options: [
      {
        label: "Send 53 of 56",
        detail: "Balance Fri 29 May.",
        is_default: true,
        is_chosen: true,
      },
      {
        label: "Hold VEH001",
        detail: "Wait for replacement stock.",
        is_default: false,
        is_chosen: false,
      },
    ],
  },
  {
    id: 7,
    run_code: "RUN-027",
    order_number: "ORD0092314",
    outlet_code: "OUT003",
    issue_type: "missing",
    units_affected: 8,
    units_total: 8,
    quick_note_tag: null,
    note: "Chilled order not at the dock.",
    photo_path: null,
    reported_by: "Tharindu J.",
    reported_at: at("02:03"),
    status: "sent",
    seen_at: null,
    decide_by: at("04:10"),
    decided_at: null,
    decided_by: null,
    options: [
      {
        label: "Send without it",
        detail: "Defer to Fri 29 May. OUT003 gets its dry order only.",
        is_default: true,
        is_chosen: false,
      },
      {
        label: "Move to VEH036 · Trip 1",
        detail: "Chilled order follows on the next reefer van.",
        is_default: false,
        is_chosen: false,
      },
      {
        label: "Hold VEH035",
        detail: "Wait for the chiller dock to find it.",
        is_default: false,
        is_chosen: false,
      },
    ],
  },
];
