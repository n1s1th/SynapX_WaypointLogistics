# Loader integration — phase 1 audit and design

Status: **decisions taken (§7). Loader side built** on `loader-sachintha-integration`: run creation,
the dispatcher read, plan change, decision (+ decide-by default), driver hand-off and gate-out. The dispatcher
and driver teams wire their own sides: **§8 is Thisaru's contract, §9 is Minidu's.** Where §3 (the proposal)
and §8/§9 (what was built) differ, §8/§9 win. Audited on `dev` at `3c9ae55` (2026-10-01).
Owner: Sachintha (loader backend). Reviewers: Thisaru (dispatcher), Minidu (driver), Devmith (DB).

This audit covers how the loader connects to the dispatcher and the driver. It says what exists
today, which records describe the same thing, what each connection should look like, and what to
build in what order. Every DB change in §4 needs Devmith's approval before anyone writes a migration.

Unmerged branches that touch these connections were read too and are named where they matter:
`origin/dispatcher` (live tracking, +2 commits), `origin/feature/delivery-runs-ui` (NOT NULL on
`dispatch_trips`), `origin/driver-minidu` and `origin/driver-nagitha` (driver pages wired to `/driver`).

---

## 1. Current state

### 1.1 Status table

| # | Connection | State | In one line |
|---|---|---|---|
| D1 | Dispatcher → Loader: allocation, stop sequence, items | ❌ missing | Loader runs come only from seed scripts; `delivery_runs.dispatch_trip_id` exists but nothing writes or reads it |
| D2 | Dispatcher → Loader: plan change | ⚠️ loader side only | `LoaderService.publish_plan` is real, but only the dev endpoint calls it; the dispatcher's re-sequence writes JSON on `dispatch_trips` |
| D3 | Dispatcher → Loader: deferred / discarded order | ❌ missing | `POST /orders/{id}/defer` clears `allocation_id`; the order stays `to_load` on any loader run |
| D4 | Dispatcher → Loader: decision on a loader issue (L8) | ⚠️ loader side only | `simulate_decision` is real but dev-only; `LoadingShortfallDialog` acts on `dispatch_trips` JSON |
| L1 | Loader → Dispatcher: loading progress | ❌ missing | Dispatcher shows `dispatch_trips.stops_completed / stop_count`, which nothing on the loader side writes |
| L2 | Loader → Dispatcher: flag sync (exception queue) | ❌ missing | Loader writes `loader_issues`; dispatcher reads `dispatch_trips.open_shortfalls` + `loading_events` |
| L3 | Loader → Dispatcher: ready to depart | ❌ missing | `delivery_runs.status = ready_to_depart` is never mirrored; `dispatch_trips.status` is a free string |
| L4 | Loader → Dispatcher: trip audit log | ⚠️ loader side only | `loader_activities` is written in the dispatcher's wording already; dispatcher reads `loading_events` JSON |
| R1 | Loader → Driver: run, items as loaded, stop sequence | ❌ missing | `driver_trips` and `delivery_stops` are created only by `seed_driver.py`; no item list; nothing sets `gated_out` |

There is no ✅ connection yet. The loader side is real (Postgres, tested) for D2, D4 and L4. On `dev`
the dispatcher works on real tables of its own, and the driver frontend is static mock pages
(only `/driver/login` calls the API). The driver branches wire the pages to the real `/driver/*` API,
but that API has no loader data to serve.

### 1.2 What each side reads and writes today

**Dispatcher** (backend `allocations.py`, `dispatch.py`, `orders.py`; frontend `components/dispatcher/*`)

| Screen / action | Endpoint | Tables | Notes |
|---|---|---|---|
| Allocations page, `AllocationFormDrawer` | `GET/POST/PATCH/DELETE /allocations` | `allocations`, `vehicles.status` | Status DRAFT → ALLOCATED → READY → LOADING → DISPATCHED…; LOADING is set by hand in the drawer |
| `QuickAllocationDrawer` | `POST /orders/bulk-allocate` | `orders.status = ALLOCATED`, `orders.allocation_id` | The item list of an allocation = its orders (+ `order_items`) |
| Orders page, defer | `POST /orders/{id}/defer` | `orders.status = DEFERRED`, `deferral_reason`, `allocation_id = NULL` | No run is told |
| `AllocationDetailDrawer` "Dispatch" | `POST /delivery-runs/from-allocation/{id}` | creates `dispatch_trips` (status `scheduled`, `stop_sequence = []`, totals 0), sets allocation DISPATCHED | Idempotent per allocation (looks up `dispatch_trips.allocation_id`); allowed only from READY/LOADING |
| Delivery runs page, `DeliveryRunTable` | `GET /delivery-runs/` | `dispatch_trips` | The dispatcher's "delivery run" **is `dispatch_trips`**, not `delivery_runs` |
| `DeliveryRunDetailPanel` "Publish Run" | `PATCH /delivery-runs/{id}` `{status: "en_route"}` | `dispatch_trips.status` | Shown while `scheduled`/`ready`; "publish" here means "on the road" |
| `RouteOptimizationDialog` | `PATCH /delivery-runs/{id}` `{stop_sequence}` + `add-loading-event "Route optimized"` | `dispatch_trips.stop_sequence` (JSON of `{id,name,eta,sla_ok,sla_note}` or place-name strings), `loading_events` | Stops are names ("Kelaniya"), not outlet ids |
| `LoadingReadinessDialog` | reads the run from the list | `loading_events`, `stops_completed`, `stop_count`, `open_shortfalls` | "Loader acknowledged" is shown whenever a "Route optimized" event exists — not real |
| `LoadingShortfallDialog` | `add-loading-event`, `PATCH open_shortfalls=0`, `PATCH departure_time +30m`, `send-to-exceptions` | `dispatch_trips.loading_events`, `open_shortfalls`, `departure_time` | Parses the first `status:"error"` event's note as "stop · issue" |
| `ManifestDialog` | `GET /delivery-runs/{id}/manifest` | `orders` by `allocation_id` + `order_items` | Ordered items, not loaded |
| *(branch `dispatcher`)* live tracking | `GET /delivery-runs/live`, `mark-stop-complete`, `recall-run` | `dispatch_trips.status` (`en_route`, `recalled`, `completed`), `stops_completed` | Reuses `stops_completed` for **delivery** progress, while the readiness dialog shows it as "Stops loaded" |

Frontend base URL: these components use `NEXT_PUBLIC_API_URL ?? "http://localhost:5001"`, and the allocations pages use `fetchWithFallback`. Most dispatcher write endpoints have their auth dependency commented out.

**Loader** (`endpoints/loader.py`, `services/loader_service.py`, models `delivery_run`, `plan_revision`, `loader_issue`, `loader_activity`)

| Area | Endpoint | Tables |
|---|---|---|
| Queue, summary, run read | `GET /loader/runs`, `/summary`, `/runs/{code}` | `delivery_runs`, `run_stops`, `run_stop_orders`, `plan_revisions`, `loader_issues` |
| Checklist writes (L4) | `POST/DELETE /loader/runs/{code}/orders/{n}/check`, `recheck`, `unload` | `run_stop_orders.state`, `loading_checks`, `loader_activities` |
| Plan acknowledge (L7) | `POST /loader/runs/{code}/plan/{v}/acknowledge` | `plan_revisions.acknowledged_*` |
| Flag (L5) | `POST /loader/issues`, `GET /loader/issues[/{id}]` | `loader_issues`, `loader_issue_options` (fixed options from `_issue_options`) |
| Release / undo (L6) | `POST /loader/runs/{code}/release[/undo]` | `delivery_runs.status/released_*`, `run_release_actions` |
| Activity (L9) | `GET /loader/runs/{code}/activity`, `/loader/activity` | `loader_activities` |
| **Dev only** (`LOADER_DEV_ENDPOINTS`, on unless `ENVIRONMENT=production`) | `POST /loader/dev/runs/{code}/plan-change`, `/dev/issues/{id}/decide`, `/dev/issues/{id}/expire` | the same tables, acting as the dispatcher |

Run creation: only `scripts/seed_loader_demo.py` (local) and `scripts/seed_loader_neon.py`. `gated_out` is
never set by the app. The tablet uses the mock transport unless `NEXT_PUBLIC_LOADER_TRANSPORT=api`.

**Driver** (`endpoints/driver.py`, `services/driver_service.py`, `models/driver.py`)

| Area | Endpoint | Tables |
|---|---|---|
| Today's trips, detail | `GET /driver/trips/today`, `/trips/{id}` | `driver_trips` (by `driver_id = users.id`, `assigned_date = today`), `delivery_stops` |
| Trip and stop actions | `POST /trips/{id}/start`, `/complete`; `PATCH /stops/{id}/arrive`, `/outcome`; `POST /stops/{id}/pod`, `/complete` | `driver_trips.status`, `delivery_stops.status`, `proof_of_delivery` |
| Issues, SOS, depot, sync | `/trips/{id}/issues`, `/sos`, `/depot/checkin`, `/sync` | `issue_reports`, `sos_alerts` |

`driver_trips.dispatch_trip_id` is **NOT NULL** → every driver trip needs a `dispatch_trips` row.
`delivery_stops` has `address`, `customer_name`, `sequence`, optional `shipment_id`, and **no order or item link**.
Only `seed_driver.py` creates trips (DT-TODAY-001, "John Doe"). Nothing reads loader data.

---

## 2. Duplicate concepts

| Concept | Where it lives today | Source of truth (proposed) | How the others link |
|---|---|---|---|
| **The trip** | `allocations` (plan) · `dispatch_trips` (dispatcher's run) · `delivery_runs` (dock) · `driver_trips` (road) | Each one owns a phase: allocation = plan until published; `dispatch_trips` = the dispatcher's handle and the **hub**; `delivery_runs` = what is on the truck; `driver_trips` = what happened on the road | `dispatch_trips.allocation_id` (exists) · `delivery_runs.dispatch_trip_id` (exists, unused — start using it, add UNIQUE) · `driver_trips.dispatch_trip_id` (exists, NOT NULL). Optional shortcut `driver_trips.delivery_run_id` (§4 #5). No `delivery_runs.allocation_id` needed: the path is `run → dispatch_trip → allocation` |
| **Stop sequence** | `dispatch_trips.stop_sequence` (JSON, names) · `run_stops.stop_sequence` per plan version · `delivery_stops.sequence` | Before publish: the dispatcher's list. After publish: `run_stops` of `current_plan_version`. After hand-off: `delivery_stops` | Dispatcher JSON entries carry `outlet_code` (§3 D1). Loader → driver copies `run_stops.stop_sequence` (delivery order), **not** `load_position` |
| **Items** | `orders` + `order_items` (ordered) · `run_stop_orders.units/weight/volume` (snapshot per plan version) · driver: none | Ordered: `orders`/`order_items`. Loaded: `run_stop_orders` + `LoaderService.loaded_units` | Driver reads the loaded list through the hand-off read (§3 R1); no copy table |
| **Issues** | `issue_reports` (driver, road; enums `issuetype`/`issuestatus`) · `loader_issues` (dock; `loaderissuetype`/`loaderissuestatus`) · `dispatch_trips.open_shortfalls` + `loading_events` (dispatcher JSON) | Keep both tables: they have different lifecycles (a dock flag has decide-by and options; a road issue does not). Retire `open_shortfalls`/`loading_events` as a store for dock flags | Dispatcher exception queue reads both with `source: "dock" \| "road"` |
| **Temperature** | `orders.temperature_zone` (varchar `Ambient`/`Chilled`, NOT NULL, Nisith) · `orders.temperature_class` (enum, nullable, loader 0003) | `temperature_zone` — every order has it; Store Manager writes only it | Loader reads `temperature_class` and falls back to `temperature_zone.lower()` at read time. No backfill, no write to the column |
| **Units / volume** | `orders.units`, `orders.volume_m3` (loader 0003, nullable) · `order_items.quantity` | `orders.units` when set (Store Manager sets it), otherwise `sum(order_items.quantity)`. `volume_m3` has no other source → 0 when null | Snapshotted into `run_stop_orders` at materialise / plan time, as today |
| **Driver identity** | `allocations.driver_id` → `driver_profiles.id` · `dispatch_trips.driver_id` → `driver_profiles.id` + `driver_name` string · `driver_trips.driver_id` → **`users.id`** | `allocations.driver_id` | Hand-off maps `driver_profiles.user_id` → `driver_trips.driver_id` |
| **Departure time** | `allocations.departure_time` · `dispatch_trips.departure_time` · `delivery_runs.departs_at` | `dispatch_trips.departure_time` once dispatched (the shortfall dialog's "hold" edits it) | Copied to `departs_at` at materialise; a hold is pushed through the plan-change call (§3 D2/D4) |
| **Status** | `allocations.status` · `dispatch_trips.status` (free string) · `delivery_runs.status` · `driver_trips.status` · `vehicles.status` | Each table owns its own. The dispatcher **shows** the dock status from `delivery_runs`; it does not copy it | See transitions per connection in §3 |
| **Brand** | `orders.brand` ("Fresh", string) · `delivery_runs.brand` (enum) · `outlets.brand` | `orders.brand` | `Brand.label` maps already (0003 note) |
| **Vehicle** | one `vehicles` table | `vehicles` | Shared; nothing to fix |
| **"Delivery run"** (the word) | Dispatcher API `/delivery-runs` = `dispatch_trips`; loader `delivery_runs` table = dock runs | — | Naming only: in this doc "dispatch trip" = `dispatch_trips`, "loader run" = `delivery_runs`. Don't rename anything |

---

## 3. Proposed contract per connection

> This was the proposal. The built contract is §8 (dispatcher) and §9 (driver). The main differences:
> the dispatcher and driver call **loader HTTP endpoints** (or the same `LoaderService` functions);
> `driver_service.ensure_trip_for_run` is not called by the loader (Minidu pulls the hand-off instead);
> idempotency uses the state of the data, not stored `client_action_id`s (§4 #2/#3 are not built).

General rules for every cross-module write:

- **Service functions, not HTTP between modules.** One FastAPI app, one DB. The dispatcher's endpoints
  call `LoaderService` functions inside their own transaction, so the dispatcher's write and the loader's
  write commit together or not at all. The loader adds no dispatcher-facing HTTP endpoints, except the
  read-only ones the dispatcher UI fetches directly.
- **Errors** use the loader's existing error envelope and codes (`409 INVALID_STATE_TRANSITION`, `409 PLAN_VERSION_STALE`, …). New codes are listed per connection.
- **Locking**: every write that changes a loader run takes `SELECT … FOR UPDATE` on the `delivery_runs` row, as L4–L6 do.
- **Logging**: every dispatcher-originated change writes a `loader_activities` row with `actor_kind = dispatcher`, `actor_label` = the dispatcher's name.
- **Runs without a link** (`dispatch_trip_id IS NULL`, e.g. LDR-RUN-1002 and the local seed runs) keep working
  exactly as now. Every integration path checks the link and skips when it is null.

### D1 — Allocation → loader run (plan v1)

- **Trigger:** `POST /delivery-runs/from-allocation/{allocation_id}` (Thisaru), after it creates the
  `dispatch_trips` row, calls `LoaderService.create_run_for_dispatch_trip(db, trip, dock_code=None)` in the
  same transaction. "Confirmed allocation" = the moment the dispatcher dispatches it (READY/LOADING → DISPATCHED).
- **Service function (Sachintha):** builds from `trip.allocation.orders`:
  - `delivery_runs`: `code = trip.trip_code` (RUN-0024 style; must be ≤ 20 chars, the column limit),
    `vehicle_id`, `dispatch_trip_id = trip.id`, `departs_at = trip.departure_time`, `brand` from the orders,
    `district` from the orders (most common), `dock` = `dock_code` if given, else the first active dock at
    the vehicle's depot, `status = not_started`, `current_plan_version = 1`.
  - `run_stops` (v1): one per distinct `orders.outlet_id`. Sequence = the order of `outlet_code`s in
    `trip.stop_sequence` when given, otherwise by `outlets.window_start`, then outlet code. `load_position = n − sequence + 1`.
  - `run_stop_orders` (v1): one per order, `state = to_load`, units / weight / volume snapshotted as in §2.
  - `plan_revisions` v1, `source = "Dispatcher"`, **unacknowledged**: the loader must accept v1 before ticking,
    as in the Figma flow. A `plan_published` activity row.
- **Payload** (no new HTTP body; the function reads the trip). For the dispatcher to pass an explicit order,
  `dispatch_trips.stop_sequence` entries gain `outlet_code` (a JSON field, no schema change):
  `{"id": "OUT026", "outlet_code": "OUT026", "name": "…", "eta": "03:55", "sla_ok": true, "sla_note": ""}`.
- **Rules** (built):
  - `422 RUN_NOT_BUILDABLE` with every reason in `detail.violations` (`{code, message, order_number?}`), and the
    whole dispatch rolls back: `NO_ALLOCATION`, `NO_ORDERS`, `ORDER_WITHOUT_OUTLET`, `ORDER_WITHOUT_BRAND`,
    `MIXED_BRANDS`, `NO_DEPARTURE_TIME`, `NO_VEHICLE`, `NO_DOCK`, `RUN_CODE_TOO_LONG` (> 20 characters).
  - `409 RUN_CODE_TAKEN` when a loader run that is not this trip's already has the trip code (e.g. a seeded RUN-021).
  - `409 ORDER_ON_ANOTHER_RUN` (`detail.orders = [{order_number, run_code}]`) when an order is on another loader
    run's current plan, that row is not `take_off`/`moved`, and that run is not `gated_out` (protects LDR-1002-xx
    and any hand-built run).
  - Brand = `orders.brand` ("Fresh"), else the outlet's brand. District = the most common outlet district.
    Units = `orders.units`, else the sum of `order_items.quantity`. `trip_number` = 1 + the vehicle's other runs
    that depot day.
  - Dispatcher-side guard (Thisaru): `bulk-allocate` into an allocation that already has a loader run goes
    through D2 (`load_new`), not a bare `allocation_id` update.
- **Idempotency:** UNIQUE on `delivery_runs.dispatch_trip_id` (§4 #1). If a run already exists for the trip,
  return it unchanged. The dispatcher's endpoint is already idempotent per allocation, so a double-click is a no-op end to end.

### D2 — Plan change (allowed until gate-out)

- **Trigger:** any dispatcher edit to a dispatched allocation's plan: re-sequence (`RouteOptimizationDialog`),
  add an order, remove an order, hold the departure. Thisaru adds `POST /delivery-runs/{id}/plan` (or routes
  the existing `PATCH` through it) which calls
  `LoaderService.publish_dispatcher_plan(db, trip, change, dispatcher_name)`.
- **Payload** (`DispatcherPlanChange`):
  ```json
  {
    "base_version": 2,
    "request_id": "6f1c…",                       // UUID, one per dispatcher action
    "add_orders": ["ORD0092319"],
    "remove_orders": [{"order_number": "ORD0092308", "reason": "Cold-room fault at OUT027"}],
    "stop_order": ["OUT028", "OUT026", "OUT030", "OUT031", "OUT027"],   // optional: full new sequence
    "departs_at": "2026-10-02T03:30:00Z",       // optional: hold / bring forward
    "summary": "Cold-room fault at OUT027; OUT028 must go tonight."
  }
  ```
  `remove_orders` maps onto the existing `unload` / `dont_load`: `publish_plan` already decides which applies
  from where the order is. `stop_order` needs a small extension to `publish_plan` (RESEQUENCE rows;
  the enum value already exists). The loader picks `recheck` itself (default: everything aboard).
- **Status rules:**
  | Loader run status | Result |
  |---|---|
  | `not_started`, `loading`, `issue_flagged`, `loaded` | Publishes v+1, unacknowledged; checklist blocks until the loader acknowledges |
  | `ready_to_depart` | Publishes v+1 and **reopens** the run to `loading` (L7 behaviour, "Load reopened · plan changed after Ready"); the loader releases again |
  | `gated_out` | **`409 PLAN_LOCKED`** ("through the gate; change it with the driver") |
  | `base_version ≠ current_plan_version` | `409 PLAN_VERSION_STALE` (the dispatcher's screen is out of date) |
- **Decided:** the `PLAN_LOCKED` code is raised by `publish_dispatcher_plan` only. The dev endpoint
  (`/loader/dev/runs/{code}/plan-change`) stays as it is (its gated-out answer remains `409 INVALID_STATE_TRANSITION`).
  For R1 this means a released-but-not-started driver trip can still change: the hand-off rebuilds stops on re-release.
- **Idempotency:** `request_id` stored on the revision (§4 #2). Same `request_id` again → return that revision
  (200, no new version). Same id on another run → 409 `CLIENT_ACTION_ID_REUSED`.
- **Dispatcher side (Thisaru):** after 200, update `dispatch_trips.stop_sequence` / `departure_time` as today, in the same transaction.

### D3 — Discarded / deferred order

- **Trigger:** `POST /orders/{id}/defer` (and any "remove from allocation" action). Before clearing
  `allocation_id`, Thisaru calls `LoaderService.withdraw_order(db, order, reason, dispatcher_name)`.
- **Behaviour:** if the order is on a loader run's current plan → D2 with `remove_orders=[order]` and the
  deferral reason as the change reason. If it is on no run → no-op.
- **Status rules:** same as D2. A `ready_to_depart` run reopens; a `gated_out` run → `409 PLAN_LOCKED`, and the
  defer is refused (the order is on the road; it has to be handled as a delivery outcome).
- **Idempotency:** a second call finds the row already `moved`/`take_off` → no new version.
- **Not done here:** "deferred to Fri 29 May / moved to VEH003" text on the diff. It needs
  `plan_revision_changes.deferred_to` / `moved_to` (§4 #4), and ships later.

### D4 — Dispatcher decision on a loader issue (L8)

- **Trigger:** dispatcher picks an option in the exception queue (the reworked `LoadingShortfallDialog`).
- **Endpoint (Sachintha):** `POST /loader/issues/{id}/decision` — the real version of `/dev/issues/{id}/decide`.
  Body: `{"option_id": 412, "decided_by": "Kasun P.", "request_id": "uuid"}`. Also `POST /loader/issues/{id}/seen`
  (marks `seen_at`, drives "Seen" on the tablet tracker). Both are the dispatcher's calls, so they go behind
  `require_dispatcher_or_admin` once auth is on.
- **Behaviour:** `simulate_decision` minus the dev parts. Choosing by `option_id`, not label. "Hold the vehicle"
  → also moves `departs_at` (and `dispatch_trips.departure_time`, Thisaru's side) by the hold length.
  "Send without it" / "Move to …" → row `moved`. If it was the last waiting issue, run `issue_flagged → loading`.
- **Status rules:** issue `decided` / `default_applied` → `409 INVALID_STATE_TRANSITION`. Run `gated_out` → 409.
- **Idempotency:** same `request_id` + same option → 200 with the current issue; a different option on a decided
  issue → 409. (`request_id` needs a column, §4 #3; until then, "already decided with the same option" = 200.)
- **Decide-by timeout:** today only the dev `/expire` endpoint applies the default. A real timeout needs a
  sweeper. Proposal: apply it lazily on any read of the issue/run once `now > decide_by` (no scheduler needed).
- **Option semantics:** `_apply_issue_outcome` matches on label prefixes ("send without", "move to").
  Proposal: an `action` code on `loader_issue_options` (§4 #3), so a dispatcher-side label change can't break it.

### L1 + L3 + L4 — Loading progress, ready to depart, audit log (one read)

- **Approach: pull, not push.** The loader does not write into `dispatch_trips`. The dispatcher reads the loader's state.
- **Service function (built):** `LoaderService.dispatcher_view(db, dispatch_trip_ids) -> {trip_id: DispatcherLoadingRead}`
  (trips with no loader run are absent). Also served one trip at a time as `GET /loader/dispatch-trips/{id}/loading` (404 when none).
  Field names are the ones `LoadingReadinessDialog` already reads off a dispatch trip, so it can read `run.loader.X`:
  ```json
  {
    "run_code": "RUN-0024",
    "status": "loading",                       // the loader run_status enum
    "dock": "DOCK3",
    "departs_at": "2026-10-01T22:00:00Z",
    "plan_version": 3, "plan_acknowledged": true,
    "stop_count": 5, "stops_completed": 3,     // stops fully loaded (or flagged); stops whose orders all left the plan don't count
    "orders_checked": 7, "orders_total": 9,
    "open_shortfalls": 1,                      // loader issues sent or seen
    "planned_weight_kg": 4690.0, "loaded_weight_kg": 3120.0,
    "planned_volume_m3": 22.1, "loaded_volume_m3": 14.0,
    "released_at": null, "released_by": null,
    "last_update_at": "2026-10-01T20:46:00Z",
    "loading_events": [
      {"event": "Shortfall flagged", "time": "02:03", "note": "OUT027 · ORD0092314: missing 8 of 8 units, sent to Dispatcher",
       "status": "error", "at": "2026-10-01T20:33:00Z", "type": "issue_flagged"}
    ]
  }
  ```
  `loading_events` are oldest first, from `loader_activities`. `time` is depot time. `note` is the stored message;
  an `issue_flagged` note is prefixed with the outlet code, because `LoadingShortfallDialog` splits the note
  as "stop · issue". Status: `issue_flagged` → `error`; `plan_published`, `load_reopened`,
  `issue_default_applied`, `run_release_undone` → `warning`; the rest → `ok`.
- **Dispatcher side (Thisaru):** `GET /delivery-runs/` and `GET /delivery-runs/{id}` add a `loader` field from
  `dispatcher_view` (null when the trip has no loader run). The readiness and detail screens read `run.loader`
  when present and fall back to today's fields when not. That keeps the existing seeded dispatch trips
  rendering. "Loader acknowledged latest plan change" then comes from `plan_acknowledged`, not from the presence
  of a "Route optimized" event.
- **Ready to depart:** `loader.status == "ready_to_depart"` drives a "Ready · signed off by Saman J. 03:10" badge
  and enables the dispatcher's go button. Proposal: the dispatcher does **not** set `dispatch_trips.status` from it.
  `dispatch_trips.status` becomes `en_route` at gate-out (R1).
- **`stops_completed` clash:** the readiness dialog shows it as "stops loaded", and the live-tracking branch
  increments it per delivered stop. With `loader.stops_completed` the readiness dialog stops reading the trip's own column, so the
  column means "delivered" only.
- **Freshness:** the dispatcher polls (the delivery-runs page already refetches). No websockets in phase 1.
- **Idempotency:** read-only.

### L2 — Flag sync to the exception queue

- **Endpoint (Sachintha):** `GET /loader/issues/waiting?depot=peliyagoda` → every `sent`/`seen` issue across
  docks, oldest first, with run code, `dispatch_trip_id`, order, outlet, units, decide-by, minutes left,
  and options (`id`, `label`, `detail`, `is_default`). Same item shape as `IssueDetailRead`, plus `dispatch_trip_id`.
- **Dispatcher side (Thisaru):** the exception queue (or the reworked `LoadingShortfallDialog`) lists these
  next to driver `issue_reports` with `source: "dock" | "road"`. "Adjust order" / "Hold departure" become the
  issue's options (D4). "Send to exceptions" is no longer needed for dock flags; it stays for the run-level escalation.
- **Status:** read-only. `open_shortfalls` on the dispatch trip = `loader.open_shortfalls` from L1.

### R1 — Hand-off to the driver

- **Trigger:** loader release (`POST /loader/runs/{code}/release`, L6) on a run with a `dispatch_trip_id`.
  In the same savepoint, `LoaderService` calls `driver_service.ensure_trip_for_run(db, run)` (Minidu's function).
- **`ensure_trip_for_run` (Minidu):**
  - Finds the `driver_trips` row by `dispatch_trip_id`, or creates it with `driver_id = allocation.driver.user_id`,
    `assigned_date = departs_at` (depot date), `status = assigned`, `delivery_run_id` if §4 #5 is approved.
  - Rebuilds `delivery_stops` from `run_stops` of the current plan version, ordered by `stop_sequence`:
    `sequence`, `address` = outlet name + district, `customer_name` = outlet name, `run_stop_id` (§4 #6).
    Rebuild only while the trip is `assigned` and no stop has left `pending`.
  - No allocation driver → no driver trip. The release still succeeds, and the dispatcher sees
    "Ready · no driver assigned" (from L1).
- **Undo inside 10 s:** the run goes back to `loaded`, and the driver trip stays `assigned`. Minidu's `start_trip`
  refuses with `409 RUN_NOT_RELEASED` unless the loader run is `ready_to_depart`. A re-release refreshes the stops (rule above).
- **Gate-out:** `POST /driver/trips/{id}/start` calls `LoaderService.mark_gated_out(db, run)`, which sets
  `delivery_runs.status = gated_out` and `gated_out_at`, and logs `gated_out`. The run then drops off the loader
  queue. Thisaru's side sets `dispatch_trips.status = en_route` in the same call (or on read from L1).
  This is the first code path that ever sets `gated_out`.
- **Items as loaded (read):** `GET /driver/trips/{id}/manifest` (Minidu's endpoint) returns
  `LoaderService.handoff_manifest(db, run)` (Sachintha):
  ```json
  {
    "run_code": "RUN-0024", "plan_version": 3, "released_at": "…", "released_by": "Saman J.",
    "stops": [
      {"stop_sequence": 1, "outlet_code": "OUT028", "outlet_name": "…", "eta": "03:55",
       "orders": [
         {"order_number": "ORD0092319", "units_ordered": 12, "loaded_units": 12,
          "temperature": "chilled", "note": null},
         {"order_number": "ORD0092314", "units_ordered": 8, "loaded_units": 0,
          "note": "Missing at dock · Send without it (dispatcher)"}
       ]}
    ]
  }
  ```
  Only rows on the plan (`moved` / `take_off` rows are left out). `loaded_units` from `LoaderService.loaded_units`.
  Stops in **delivery order** (`stop_sequence`), never `load_position`.
- **No snapshot table.** After release the checklist is closed (L4 409s). A plan change reopens the run (D2),
  and the driver's `start_trip` refuses while the run is not `ready_to_depart`, so the driver never starts on a stale
  list; once gated out, D2 answers 409. The live read is therefore the snapshot from gate-out on.
- **Idempotency:** `ensure_trip_for_run` is an upsert keyed by `dispatch_trip_id` (one driver trip per dispatch
  trip; §4 #5 adds the UNIQUE). Release's own `client_action_id` replay already stops double hand-offs.

---

## 4. Required DB changes (all additive; each needs Devmith's approval)

| # | Table (owner) | Change | Why | Needed by |
|---|---|---|---|---|
| 1 | `delivery_runs` (loader) | UNIQUE index on existing `dispatch_trip_id` (nulls allowed) | One loader run per dispatch trip; D1 idempotency. No column change | D1 — slice 1 |
| 2 | `plan_revisions` (loader) — **not built** | `publish_request_id VARCHAR(64) NULL UNIQUE` | Replay of a dispatcher publish (D2/D3). `client_action_id` is already the acknowledge's | D2 |
| 3 | `loader_issue_options` (loader) — **not built** | `action VARCHAR(32) NULL` (`send_partial`, `send_without`, `hold`, `move`, `swap_vehicle`); `loader_issues.decision_request_id VARCHAR(64) NULL UNIQUE` | Stop matching on labels; D4 replay | D4 |
| 4 | `plan_revision_changes` (loader) — **not built**; read-time derivation instead (§8.3) | `moved_to VARCHAR(100) NULL`, `deferred_to DATE NULL` | "Moved to VEH003 · Trip 1" / "Deferred to Fri" text (already pending from the migration plan) | D3, later |
| 5 | `driver_trips` (Minidu) | `delivery_run_id INT NULL FK delivery_runs(id) ON DELETE SET NULL`; UNIQUE on `dispatch_trip_id` | Direct link without going through the dispatch trip; one driver trip per dispatch trip. **Optional**: the join through `dispatch_trip_id` already works | R1 |
| 6 | `delivery_stops` (Minidu) | `run_stop_id INT NULL FK run_stops(id) ON DELETE SET NULL` | Per-stop manifest join; lets the driver's stop screens show the loaded items | R1 |

Not needed: `delivery_runs.allocation_id`. The existing `dispatch_trip_id` plus `dispatch_trips.allocation_id`
covers it. Nothing changes any existing column of another team. No change to `temperature_zone` /
`temperature_class` (read-time fallback). If Devmith rejects #1, D1 can fall back to a `SELECT … FOR UPDATE`
lookup inside the dispatcher's transaction, which is safe enough while one dispatcher clicks.

Neon note (from the migration rebase): Neon must be stamped/upgraded to head before any of these revisions are
applied there, and all of them are new revisions after `0005`. None edits an applied migration.

---

## 5. Work split, smallest useful slice first

Each slice is shippable and demoable on its own.

**Slice 1 — "A dispatched allocation shows up on the dock tablet, and the dispatcher sees its progress"** (D1 + L1/L3/L4 read)

| Who | Work |
|---|---|
| Sachintha | ✅ Built: `create_run_for_dispatch_trip` + the 422/409 rules; `dispatcher_view`; `POST /loader/dispatch-trips/{id}/run` and `GET …/loading`; temperature/units fallback; 21 tests (SQLite); migration `0006` (#1) for Devmith. Not yet: a smoke run on local Postgres |
| Thisaru | One call in `create_run_from_allocation`; add `loader` to `DeliveryRunResponse`; readiness dialog / detail panel read `run.loader` when present; `outlet_code` in `stop_sequence` entries (optional in slice 1) |
| Minidu | Nothing |

**Slice 2 — "The dispatcher answers a dock flag"** (L2 + D4)

| Who | Work |
|---|---|
| Sachintha | `GET /loader/issues/waiting`, `POST /loader/issues/{id}/seen`, `POST /loader/issues/{id}/decision` (by option id); lazy default-on-timeout; migration #3 |
| Thisaru | Exception-queue list of dock flags; `LoadingShortfallDialog` shows the issue's options and posts the decision; "Hold" also updates `departure_time` |

**Slice 3 — "The dispatcher changes the plan before release"** (D2 + D3)

| Who | Work |
|---|---|
| Sachintha | `publish_dispatcher_plan` (`base_version`, `request_id`, `stop_order`, `departs_at`, PLAN_LOCKED guard); `withdraw_order`; resequence support in `publish_plan`; migration #2 |
| Thisaru | `POST /delivery-runs/{id}/plan`; route `RouteOptimizationDialog`, add-order and defer through it; show the 409s ("Released — ask the dock to undo") |

**Slice 4 — "The driver gets what was actually loaded"** (R1)

| Who | Work |
|---|---|
| Sachintha | `handoff_manifest`, `mark_gated_out`, call `ensure_trip_for_run` from `release_run` |
| Minidu | `ensure_trip_for_run` (upsert trip + stops); `start_trip` → 409 unless released, then calls `mark_gated_out`; `GET /driver/trips/{id}/manifest`; trip screens show loaded vs ordered; migrations #5/#6 if approved |
| Thisaru | `dispatch_trips.status = en_route` at gate-out (replaces "Publish Run" setting it by hand) |

**Later:**
- #4 moved/deferred text stored on the plan change (today it is read from where the order went).
- **Item-level shortfalls (rule D):** a nullable `loader_issues.order_item_id` (FK `order_items`) plus picking
  the item on the tablet's flag sheet, so a short multi-item order gets an exact `quantity_sent` per item
  instead of null (§10). Needs a migration (Devmith) and a tablet change.
- websocket/SSE instead of polling; auth on the dispatcher-facing loader endpoints.

---

## 6. Risks to the current demo data (LDR-RUN-1002 on Neon must keep working)

1. **LDR-RUN-1002 has no dispatch trip.** `dispatch_trip_id` is null, so every path above skips it: no dispatcher
   view, no hand-off, no D2 lock. The tablet flow (check, flag, dev decide, release, undo, activity) is untouched.
   The UNIQUE index (#1) allows any number of nulls. **Must hold:** every new code path tests `dispatch_trip_id is not None` first.
2. **Its orders look allocated to the dispatcher.** `LDR-1002-01..08` are `ALLOCATED` with `allocation_id = NULL`,
   and they already appear under the dispatcher's "Allocated" filter (`status == ALLOCATED OR allocation_id != NULL`).
   If someone bulk-allocates them into a real allocation and dispatches it, D1 returns `409 ORDER_ON_ANOTHER_RUN`, by design. `LDR-1002-09`
   is `DEFERRED` and appears in the dispatcher's deferred list; deferring it again is harmless (D3 no-op, not on a run).
3. **Plan-change behaviour.** Decided: a Ready run reopens (as L7 does today) and only `gated_out` answers
   `409 PLAN_LOCKED`, in the dispatcher-facing function only. The dev plan-change endpoint is unchanged, so the
   L7 "Load reopened" demo on LDR-RUN-1002 still works.
4. **Dev endpoints stay on.** Neon's backend must keep `LOADER_DEV_ENDPOINTS=true` and `ENVIRONMENT != production`
   for the L5–L8 demo. When the real D4 endpoint lands, both paths share `_apply_issue_outcome`, so their results match.
5. **Read-time temperature fallback** changes nothing for LDR-RUN-1002 (it has `temperature_class` set). For
   other orders the badge appears where it was blank before.
6. **Migrations.** All are additive and nullable. #1 is an index on an all-null column on Neon (one row), so there is no lock
   risk. Neon needs the `alembic stamp 50ff454ecd63` fix before any `upgrade head` (known, Devmith).
7. **`gated_out` becomes reachable.** Once slice 4 lands, starting a driver trip removes the run from the queue.
   LDR-RUN-1002 has no driver trip, so it can't be gated out by accident. The seed itself is not re-runnable
   for a gated-out run (insert-only; it skips an existing run). Use a new `--date` for a fresh demo.
8. **In-flight branches.** `feature/delivery-runs-ui` makes `dispatch_trips` totals NOT NULL (D1 creates trips
   through the dispatcher's own code, which sets them, so this is fine). `dispatcher` live tracking reuses
   `stops_completed` (see L1). The driver branches change pages and `lib/api.ts` only. None of them conflicts with this design.
   `GET /delivery-runs/live` is declared after `GET /delivery-runs/{id}` on that branch, which may route
   `live` into `{id}` (422). That's Thisaru's to check, and unrelated to the loader.
9. **Local Postgres TZ bug** (aware UTC into naive columns, +5:30 on a Colombo session) affects any new write
   path (`gated_out_at`, decision times). New code should write naive UTC (`_naive_utc`) until the engine-level fix lands.

---

## 7. Decisions (2026-10-01)

| # | Question | Decision |
|---|---|---|
| 1 | Hub between the modules | **`dispatch_trips`.** `delivery_runs.dispatch_trip_id` (unique) and `driver_trips.dispatch_trip_id` link to it; no `delivery_runs.allocation_id` |
| 2 | Plan change after release | **Allowed until `gated_out`.** A `ready_to_depart` run reopens to `loading` (L7 behaviour kept). After `gated_out` → `409 PLAN_LOCKED`. Enforced in the dispatcher-facing function (`publish_dispatcher_plan`, slice 3); the dev endpoint stays as it is |
| 3 | Orders without `outlet_id` | **422** (`RUN_NOT_BUILDABLE`, violation `ORDER_WITHOUT_OUTLET`), built in slice 1 |
| 4 | Driver ID mapping (`driver_profiles` → `users`) | **Deferred to slice 4** |

Still open (slice 1 uses the proposed default; say if you want otherwise):

- Dock choice: the first dock (by code) at the vehicle's depot, unless the caller passes `dock_code`.
- Mixed-brand allocations: 422 `MIXED_BRANDS` (not split into one run per brand).
- Plan v1 arrives unacknowledged (matches Figma; the loader accepts it before the first tick).
- Hand-off at release (slice 4) rather than at gate-out.

---

## 8. For Thisaru — the dispatcher contract

The loader side is on `loader-sachintha-integration`. Nothing in `dispatch.py`, `allocations.py`, `schemas/shipment.py`
or `components/dispatcher/*` was touched. Everything below is something **you** call. The loader works without
any of it: until you call these, loader runs come only from the seeds.

| When | Call | Section |
|---|---|---|
| An allocation is dispatched (`from-allocation`) | `loader_service.create_run_for_dispatch_trip(db, trip)` in your transaction, or `POST /loader/dispatch-trips/{id}/run` | 8.1 |
| Showing delivery runs / Loading readiness | `loader_service.dispatcher_view(db, ids)`, or `GET /loader/dispatch-trips/{id}/loading` | 8.2 |
| The dispatcher changes the plan (re-route, add / remove / move / defer an order, hold departure) | `POST /loader/dispatch-trips/{id}/plan` | 8.3 |
| Exception queue: list the dock's flags | `GET /loader/issues?dock=DOCK3` (all), `GET /loader/issues/{id}` | 8.4 |
| The dispatcher answers a flag | `POST /loader/issues/{id}/decision` | 8.4 |

All errors use the shared envelope: `{"detail": {"code": "…", "message": "…", …details}}`. 422s carry
`detail.violations: [{code, message, …}]`, listing every problem at once.

**Idempotency.** Every write takes a `client_action_id` (UUID; one per user action, reused on retry).
What actually makes a retry safe is the state of the data (§4 #2/#3, which would store the ids, are not built):
a plan change is a replay when the current version is exactly that change; a decision is a replay when the
same option is already chosen; a gate-out is a replay when the run is already gated out. A replay answers 200
with `"replayed": true` (plan, gate-out) or the unchanged issue (decision), and writes nothing.
Consequence: one `client_action_id` reused for a *different* request is not detected.

### 8.1 Build the loader run when an allocation is dispatched

`backend/app/api/v1/endpoints/dispatch.py`, in `create_run_from_allocation`, between `db.add(allocation)` and `db.commit()`:

```python
from app.services.loader_service import loader_service  # top of file

    # Mark allocation as dispatched
    allocation.status = AllocationStatus.DISPATCHED
    db.add(allocation)

    # Send the plan to the loading dock (loader run + stops + plan v1), in this
    # same transaction: if the dock cannot load it (422 RUN_NOT_BUILDABLE, 409
    # ORDER_ON_ANOTHER_RUN / RUN_CODE_TAKEN) the exception propagates, nothing is
    # committed, and the allocation stays READY/LOADING.
    db.flush()  # gives trip.id
    loader_service.create_run_for_dispatch_trip(db, trip)

    db.commit()
    db.refresh(trip)
    return trip
```

What the UI sees: the existing `toast.error(err.detail …)` in `AllocationDetailDrawer.dispatchAllocation`. For a 422,
`detail` is an object: show `detail.message` and list `detail.violations[].message`. For example, "ORD1003 has no outlet."

Trips dispatched before this change have no loader run. Build one with `POST /api/v1/loader/dispatch-trips/{trip_id}/run`
(201 created / 200 already there; optional `?dock=DOCK3`).

### 8.2 Show the dock's progress on delivery runs

`backend/app/schemas/shipment.py`:

```python
class DeliveryRunResponse(DispatchTripRead):
    # The loading dock's side (docs/loader/INTEGRATION_DESIGN.md L1); null when
    # this trip has no loader run.
    loader: Optional[Dict[str, Any]] = None
```

`backend/app/api/v1/endpoints/dispatch.py`, `list_delivery_runs` and `get_delivery_run`:

```python
from app.schemas.shipment import DeliveryRunResponse
from app.services.loader_service import loader_service


def _with_loader(db: Session, trips: List[DispatchTrip]) -> List[DeliveryRunResponse]:
    views = loader_service.dispatcher_view(db, [t.id for t in trips])
    out = []
    for t in trips:
        item = DeliveryRunResponse.model_validate(t)
        view = views.get(t.id)
        item.loader = view.model_dump(mode="json") if view else None
        out.append(item)
    return out

# list_delivery_runs:  return _with_loader(db, query.offset(skip).limit(limit).all())
# get_delivery_run:    return _with_loader(db, [run])[0]
```

Frontend: add `loader?: LoaderView | null` to `DeliveryRun` in `app/dispatcher/delivery-runs/page.tsx`, and in
`LoadingReadinessDialog` read from `run.loader ?? run`:

```tsx
const src = run.loader ?? run;               // loader view when the dock has the run
const events = src.loading_events || [];
const itemsChecked = run.loader
  ? Math.round((run.loader.orders_checked / Math.max(run.loader.orders_total, 1)) * 100)
  : run.stop_count > 0 ? Math.round((run.stops_completed / run.stop_count) * 100) : 0;
// "Stops loaded":   src.stops_completed / src.stop_count
// "Open shortfalls": src.open_shortfalls
// "Last loader update": run.loader?.last_update_at ?? last event time
const hasLoaderAck = run.loader ? run.loader.plan_acknowledged : hasPlanChanged;
```

The detail panel can show `run.loader.status` (`not_started` · `loading` · `issue_flagged` · `loaded` ·
`ready_to_depart` · `gated_out`) as the dock badge. "Ready to depart" = `run.loader.status === "ready_to_depart"`.

### 8.3 Plan change — `POST /loader/dispatch-trips/{trip_id}/plan`

Call it whenever the dispatcher changes a dispatched trip, after your own validation and in place of (or
alongside) your `PATCH /delivery-runs/{id}` of `stop_sequence` / `departure_time`. It publishes the next plan
version; the dock tablet blocks on the L7 "Plan changed" screen until the loader acknowledges.

Request:

```json
{
  "client_action_id": "6f1c2a9e-0d55-4c1e-9a43-3d2b9b7c1e01",
  "base_version": 1,
  "stop_order": ["OUT030", "OUT026"],
  "add":    [{"order_number": "ORD1005", "reason": "OUT031 must go tonight"}],
  "remove": [{"order_number": "ORD1003", "reason": "Store closed for stock-take"}],
  "move":   [{"order_number": "ORD1006", "reason": "Balance load", "to_dispatch_trip_id": 25}],
  "defer":  [{"order_number": "ORD1004", "reason": "Vehicle full", "deferred_to": "2026-10-03"}],
  "departs_at": "2026-10-01T22:30:00Z",
  "summary": "Stock-take at OUT030; OUT031 must go tonight.",
  "dispatcher": "Kasun P."
}
```

- `base_version` = the `plan_version` your screen shows (`run.loader.plan_version` from 8.2).
- `stop_order` (optional): outlet codes in delivery order. Named stops go first, others keep their order.
  A new stop for an added order goes first unless you place it.
- `remove` / `move` / `defer` all take the order off this run: `take_off` when it is already on the truck
  (the loader must unload it), otherwise it is simply not loaded. `reason` is shown verbatim on the tablet.
- `to_dispatch_trip_id` / `deferred_to` are informational (nothing stores them). The tablet's "moved to" /
  "deferred to" are read from the order's real state: **moved to** appears once another loader run has the
  order on its plan (e.g. you built that trip's run, or added it there with this endpoint); **deferred to**
  appears when the order is `DEFERRED` with an `operating_date` after this run's day. So: also do your own
  defer (`POST /orders/{id}/defer`, and set the new `operating_date`) as you do today.
- `departs_at` alone (nothing else) changes the departure without a new plan version (`published: false`).
- Aboard orders nearer the door than an order coming off are put to re-check (the loader moves them to reach
  it). A new stop order re-checks everything aboard.

Response `200`:

```json
{
  "dispatch_trip_id": 24, "run_code": "RUN-0024", "plan_version": 2,
  "published": true, "replayed": false, "run_status": "loading",
  "departs_at": "2026-10-01T22:30:00Z",
  "changes": [
    {"change_kind": "unload_from_truck", "order_number": "ORD1003", "outlet_code": "OUT030", "reason": "Store closed for stock-take"},
    {"change_kind": "dont_load", "order_number": "ORD1004", "outlet_code": "OUT026", "reason": "Vehicle full"},
    {"change_kind": "load_new", "order_number": "ORD1005", "outlet_code": "OUT031", "reason": "OUT031 must go tonight"}
  ]
}
```

| Run status | Result |
|---|---|
| `not_started`, `loading`, `issue_flagged`, `loaded` | new version, tablet shows the change |
| `ready_to_depart` | new version **and the run reopens** to `loading`; the loader releases again |
| `gated_out` | `409 PLAN_LOCKED` |

| Error | When |
|---|---|
| `404 NOT_FOUND` | no dispatch trip, or no loader run for it (build it first, 8.1) |
| `409 PLAN_LOCKED` | the run has gone through the gate |
| `409 PLAN_VERSION_STALE` | `base_version` is behind (someone else changed it): re-read 8.2 and retry. `detail.current_plan_version` |
| `409 ORDER_ON_ANOTHER_RUN` | an added order is on another loader run's plan; `detail.orders = [{order_number, run_code}]` |
| `422 PLAN_CHANGE_INVALID` | `violations[].code`: `ORDER_NOT_ON_RUN`, `ORDER_NOT_FOUND`, `ORDER_WITHOUT_OUTLET`, `BRAND_MISMATCH`, `UNKNOWN_STOP`, `DUPLICATE_ORDER`, `EMPTY_CHANGE` |

Retry: the same body after a timeout returns `200` with `"replayed": true` and the same `plan_version`.

### 8.4 Exception queue and decisions (L8)

**List:** `GET /loader/issues?dock=DOCK3` (every issue at the dock, newest first; keep `status` in `sent` /
`seen` on your side for "waiting" — the endpoint has no status filter), or `GET /loader/issues/{id}`. Each option now carries its `id`:

```json
{
  "id": 41, "run_code": "RUN-0024", "order_number": "ORD1002", "outlet_code": "OUT027",
  "issue_type": "short", "units_affected": 3, "units_total": 8,
  "reported_by": "Saman J.", "reported_at": "2026-10-01T20:33:00Z",
  "status": "sent", "decide_by": "2026-10-01T21:40:00Z", "decided_at": null, "decided_by": null,
  "options": [
    {"id": 101, "label": "Send 5 of 8", "detail": "Balance on the next delivery day.", "is_default": true, "is_chosen": false},
    {"id": 102, "label": "Hold the vehicle", "detail": "Wait for replacement stock.", "is_default": false, "is_chosen": false}
  ]
}
```

**Decide:** `POST /loader/issues/{issue_id}/decision`

```json
{"option": 102, "note": "Replacement on the 03:00 shuttle", "decided_by": "Kasun P.",
 "client_action_id": "0b7d…", "deferred_to": null}
```

`option` is the option's `id` (preferred) or its exact label. Response `200`: the issue as above with
`status: "decided"`, the chosen option `is_chosen: true`, `decided_by`, `decided_at`.

What it does: marks the option chosen; "Send without it" / "Move to …" take the order off the run; when no other
issue waits, the run goes `issue_flagged → loading` and the release lock lifts; writes an `issue_decided`
activity (`"ORD1002: Hold the vehicle · Replacement on the 03:00 shuttle"`). The note is kept in that
activity row only. "Hold" does not move the departure: send a `departs_at` plan change (8.3) for that.

| Error | When |
|---|---|
| `404 NOT_FOUND` | no such issue |
| `422 INVALID_OPTION` | the option is not one of this issue's; `violations[0].options` lists the valid ones |
| `409 ISSUE_ALREADY_DECIDED` | decided (or defaulted) with a different option; `detail.chosen_option`, `detail.decided_by` |
| `409 INVALID_STATE_TRANSITION` | the run has gone through the gate |

Same option again → `200`, nothing written.

**Deferring options.** "Send without it", any "Defer …" option, and "Leave the overflow for the next run" when the
overflow is the whole order, defer the order through `order_service.defer_order`. The new day is `deferred_to`
if sent, otherwise the **deferral day**: the first operating day after the run's delivery day, or after today
when the run's day has already passed (depot time; never today or a past day). Operating days come from
`calendar_days` where it has the date, otherwise every day but Sunday. **Calendar coverage:** Neon's
`calendar_days` ends 2026-06-28 and local has two rows, and `docs/calendar.csv` is not in the repo, so beyond
that only Sundays are skipped — holidays (Poya days etc.) need the calendar extended (Devmith,
`scripts/seed_reference_data.py`). The reason reads
`"Missing at the loading dock (RUN-0024): Send without it"`. The store gets its usual deferral notification.
An order already `DEFERRED` (deferred upstream) is left alone. The decide-by default does the same.

**Decide-by.** `decide_by` = departure − 20 min. When it passes with no decision, the default option is applied
(`status: "default_applied"`, `decided_by: "System (decide-by passed)"`, activity `issue_default_applied`).
This happens on the next read of the loader or of these endpoints; there is no scheduler. It applies only to
runs built from a dispatch trip (seeded demo runs keep the dev `/expire` endpoint). A decision after that
is `409 ISSUE_ALREADY_DECIDED`.


---

## 9. For Minidu — hand-off and gate-out

The driver side is not touched. Two loader endpoints, both keyed by the **dispatch trip id**, the same id as
`driver_trips.dispatch_trip_id`, so you need no new column to find the loader run.

| When | Call |
|---|---|
| Trip screen / before departure: what is on the truck | `GET /loader/dispatch-trips/{dispatch_trip_id}/handoff` |
| The driver starts the trip (leaves the depot) | `POST /loader/dispatch-trips/{dispatch_trip_id}/gate-out` |

Suggested wiring on your side: in `start_trip`, call `loader_service.gate_out(db, run, payload)` (or the endpoint)
and refuse the start while it answers `409 RUN_NOT_RELEASED`. Build `delivery_stops` from the hand-off's `stops`.
Runs with no dispatch trip (the seeded LDR-RUN-xxxx demo runs) have no hand-off.

### 9.1 `GET /loader/dispatch-trips/{dispatch_trip_id}/handoff`

Available once the loader has released the run (`ready_to_depart`), and after gate-out. Stops are in
**delivery order** (`stop_sequence` 1 = first stop); `load_position` is the loading order (1 = deepest), for reference.
Only orders on the plan are listed; an order sent without (shortfall decision) appears only in `shortfalls`,
and a stop left with no orders is dropped.

```json
{
  "dispatch_trip_id": 24, "run_code": "RUN-0024", "status": "ready_to_depart", "plan_version": 2,
  "vehicle_code": "VEH014", "dock": "DOCK3", "departs_at": "2026-10-01T22:00:00Z",
  "released_at": "2026-10-01T21:20:00Z", "released_by": {"id": 3, "name": "Saman J."},
  "gated_out_at": null,
  "units_ordered": 28, "units_loaded": 25,
  "stops": [
    {"stop_sequence": 1, "load_position": 3, "outlet_code": "OUT027", "outlet_name": "Fresh Gampaha 27",
     "district": "Gampaha", "eta": null,
     "orders": [
       {"order_number": "ORD1002", "temperature_class": "chilled", "units_ordered": 8, "loaded_units": 5,
        "weight_kg": 200.0, "volume_m3": 0.8,
        "shortfall": {"issue_id": 41, "order_number": "ORD1002", "outlet_code": "OUT027", "issue_type": "short",
                      "units_affected": 3, "units_total": 8, "status": "decided",
                      "decision": "Hold the vehicle", "decided_by": "Kasun P.", "decided_at": "2026-10-01T20:40:00Z"}}
     ]},
    {"stop_sequence": 2, "load_position": 2, "outlet_code": "OUT026", "outlet_name": "Fresh Gampaha 26",
     "district": "Gampaha", "eta": null,
     "orders": [
       {"order_number": "ORD1001", "temperature_class": "ambient", "units_ordered": 12, "loaded_units": 12,
        "weight_kg": 300.0, "volume_m3": 1.2, "shortfall": null}
     ]}
  ],
  "shortfalls": [ { "issue_id": 41, "order_number": "ORD1002", "decision": "Hold the vehicle", "…": "…" } ]
}
```

- `units_ordered` = what the plan said; `loaded_units` = what is physically on the truck (short / damaged /
  won't fit subtract the flagged units; missing = 0). Deliver against `loaded_units`.
- A plan change before gate-out reopens the run (it is then not released): the hand-off answers 409 until the
  loader releases again. Re-read it before departure; it is final from gate-out on.

| Error | When |
|---|---|
| `404 NOT_FOUND` | no dispatch trip, or no loader run for it |
| `409 RUN_NOT_RELEASED` | the loader has not released the run (`detail.status` says where it is) |

### 9.2 `POST /loader/dispatch-trips/{dispatch_trip_id}/gate-out`

```json
{"client_action_id": "3c2d…", "by": "Tharindu F."}
```

Response `200`:

```json
{"dispatch_trip_id": 24, "run_code": "RUN-0024", "status": "gated_out",
 "gated_out_at": "2026-10-01T22:04:00Z", "replayed": false}
```

`ready_to_depart → gated_out`. From then on: the run leaves the dock queue; the loader's release and undo answer
409; dispatcher plan changes answer `409 PLAN_LOCKED`; decisions on its issues answer 409. Logged as `gated_out`
("Gated out · Tharindu F.").

| Error | When |
|---|---|
| `404 NOT_FOUND` | no dispatch trip, or no loader run for it |
| `409 RUN_NOT_RELEASED` | not released yet (`not_started` … `loaded`): the driver cannot leave |

Already gated out → `200` with `"replayed": true` and the original `gated_out_at`.

---

## 10. Order status from the loader (agreed with Devmith)

The loader moves orders through `order_service` only (no HTTP, no direct writes to `orders.status`):

```python
from app.services.order_service import order_service
from app.models.order import OrderStatus
order_service.update_order_status(db, order_id, OrderStatus.PROCESSING)
```

| Loader action | Order effect |
|---|---|
| First tick of an order (check → loaded) | `ALLOCATED → PROCESSING`. Already `PROCESSING` or later: nothing. Untick / re-tick: nothing |
| Acknowledge a plan | nothing |
| Release (`ready_to_depart`) | nothing yet: the loader may undo within 10 s (+ 2 s grace) |
| Undo within the window | nothing |
| Undo window closed | every order on the current plan → `READY_FOR_DISPATCH` (through `PROCESSING` if never ticked), `order_items.quantity_sent` filled. Orders taken off / moved, and orders `DEFERRED` upstream, are left alone |
| Gate-out | the same, at once (leaving the gate ends the undo window) |
| Decision that defers the order | `order_service.defer_order(db, order_id, reason, new_date)` (see 8.4) |

**When "after the window" happens.** There is no worker. The first loader or dispatcher read after the window
finalizes: the queue, summary, run read, issues, `…/loading`, `dispatcher_view`, `…/handoff` (only once the window
has closed; reading the hand-off inside the window must not defeat undo) and `…/gate-out` (always).
`LoaderService.finalize_due_releases(db)` / `finalize_release(db, run)` are the functions. Finalizing is idempotent
without a new column: it only touches orders still in `SUBMITTED`/`CONFIRMED`/`ALLOCATED`/`PROCESSING`.

**`quantity_sent`.** A loader flag is per order (`units_affected`), not per item. `_quantity_sent_for_order`:
- fully loaded → every item's `quantity`;
- one item → the loaded units ("43 of 46"), i.e. ordered − the issue's final `units_affected` (§11);
- short with several items → **null on every item** (rule C). Switch `SHORT_MULTI_ITEM_RULE` to `"B"` to put the
  whole shortfall on the last item (by `order_items.id`) instead. Rule D (exact, per item) is on the later list (§5).

**Transactions.** `order_service` commits inside each call, so every call comes last in its loader action and its
commit writes the loader's change with it. A refused move (`InvalidStateTransitionError`) is raised before
anything commits; the loader logs it and carries on — a tick, read or decision never fails because of the order's
status. Finalizing commits once per order; a failure halfway is picked up by the next read.

**Known gap.** A plan change after the window (a reopened Ready run) can take an order off the truck that is
already `READY_FOR_DISPATCH`; there is no move back. The dispatcher's own defer/re-plan handles that order.

---

## 11. For the Store Manager page — shortfalls from `loader_issues`

Devmith's store page reads shortfalls straight from `loader_issues` by `order_id`. What the loader guarantees:

**Which rows.** `issue_type` in short / missing / wont_fit (damaged exists too and follows the same rules).
Show the number only when `status` is decided or default_applied; before that it is the loader's first count
and may still change.

**Real stored values (Postgres enums store the member NAME, upper case).** The API shows lower case; raw SQL
must use these:

| Column (Postgres type) | Stored values |
|---|---|
| `status` (`loaderissuestatus`) | `SENT`, `SEEN`, `DECIDED`, `DEFAULT_APPLIED` |
| `issue_type` (`loaderissuetype`) | `MISSING`, `SHORT`, `DAMAGED`, `WONT_FIT` |

```sql
SELECT order_id, issue_type, units_affected, units_total
FROM loader_issues
WHERE order_id = :order_id
  AND issue_type IN ('SHORT', 'MISSING', 'WONT_FIT')
  AND status IN ('DECIDED', 'DEFAULT_APPLIED');
```

(Through the ORM: `IssueStatus.DECIDED`, `IssueType.SHORT`, … compare correctly.)

**`units_affected` once decided = the final number of units NOT sent; `units_total` = the order's units on the run.**
Both are always set (never null) once decided: a flag without a count becomes the whole order. Sent = `units_total − units_affected`.

| Issue | Decision (option) | Final `units_affected` |
|---|---|---|
| any | "Send without it" (order deferred), "Defer …", "Move to …" (another vehicle) | `units_total` |
| missing / short / damaged | "Hold the vehicle" (the truck waits for the goods / stock) | `0` |
| won't fit | "Swap to a larger vehicle" | `0` |
| short / damaged | "Send N of M" | as flagged (`M − N`) |
| won't fit | "Leave the overflow for the next run" | as flagged (the overflow); the whole order → also deferred |
| missing | (default "Send without it") | `units_total` |
| any | dispatcher sends `units_not_sent` (a partial top-up: 3 short, 2 found → 1) | that number |

The decide-by default (`DEFAULT_APPLIED`) sets it the same way as a dispatcher choosing that option.
The same number drives `loaded_units` on the tablet, the driver hand-off and `order_items.quantity_sent` (§10),
so the store page, the hand-off and "sent" never disagree.

**One issue per order per run.** Enforced by the loader (no DB constraint, no migration): a second flag for an
order on the same run is `409 ORDER_ALREADY_FLAGGED`, including when the order comes back on the plan after a
plan change. Across runs an order can have more than one issue (e.g. moved to another vehicle and flagged
there): take the latest decided one (`decided_at`), or sum per run if both runs carried part of it.

**A moved order is not a shortfall for the store.** "Move to …" means not sent *on this run*
(`units_affected = units_total`), but the order goes on another vehicle. If that matters on the page, show it
only when the order is not on another run (or rely on the order's own status: a deferred order is `DEFERRED`).
