# Store Manager contract · Dev A ↔ Dev B

The things Dev A (orders, notifications) and Dev B (loading, receipts) must agree on **before** splitting up. Once both of you sign off, treat this as frozen: only **add** to it, never rename, and tell each other before changing anything.

*Adapted from `docs/reference/store_manager_workplan.md` to this repo: FastAPI + SQLAlchemy + Alembic backend, Next.js frontend, Figma "04 — Store Manager" screens as the UI reference.*

**Decided already (DB lead):**

- The UI follows the Figma screens (goods requests with line items, priority, drafts, 6-step progress). The workplan's business rules still apply (operating days, cutoff, Fresh dual-order rule, deferral notices).
- We **extend the existing tables** (`orders`, `order_items`, `users`, `inventory_items`) instead of creating new ones. IDs stay **integers** (not UUIDs), because the existing tables and other teams' code already use them.
- Backend code is Python: services in `backend/app/services/`, validation with Pydantic, not Node/Zod.

---

## 1. Order status (shared by everyone)

The `orders.status` enum already has `draft, confirmed, processing, dispatched, delivered, cancelled`. We **add** `submitted, ready_for_dispatch, completed, deferred`. We don't remove or rename anything.

| DB value | Figma label | Figma progress step | Set by | Workplan name |
|---|---|---|---|---|
| `draft` | Draft | (not submitted) | Dev A: "Save as Draft" | none |
| `submitted` | Submitted | 1 | Dev A: `place_order` | `pending` |
| `confirmed` | Submitted (accepted into plan) | 1 | Dispatcher team | `confirmed` |
| `processing` | Being Prepared | 2 | Dev B: `start_loading` | `loading` |
| `ready_for_dispatch` | Ready for Dispatch | 3 | Dev B: `complete_loading` | none |
| `dispatched` | In Transit / On the Way | 4 | Driver/Dispatcher: vehicle departs | `in_transit` |
| `delivered` | Arrived | 5 | Driver team: arrival at store | `delivered` |
| `completed` | Completed | 6 | Dev B: `submit_receipt` | none |
| `deferred` | Deferred | (off the line) | Dispatcher team | `deferred` |
| `cancelled` | Cancelled | (off the line) | Dev A: `cancel_order` (before cutoff) | none |

> Change from the workplan: `complete_loading` sets `ready_for_dispatch`, not `in_transit`. Figma shows "Ready for Dispatch" as its own step, and the vehicle leaving is a separate event.

**Loading status** (Dev B, `loading_tasks.status`): `pending | in_progress | completed | shortfall_flagged`, as in the workplan.

---

## 2. Tables

### `orders` (Dev A)

| Column | Type | Source | Notes |
|---|---|---|---|
| `id`, `order_number`, `status`, `created_at`, `updated_at` | existing | already in Neon | `order_number` format `ORD0000001` (as in Figma) |
| `client_name`, `destination_address` | existing, NOT NULL | already in Neon | Filled from the outlet's name/district on placement |
| `outlet_id`, `brand`, `temperature_class`, `units`, `weight_kg`, `volume_m3` | int FK `outlets.id`, enum, enum, int, float, float | **Loader migration 0003** (Sachintha) | Reused as-is. `units`/`weight_kg`/`volume_m3` = totals added up from the items |
| `order_date` | DATE | **Dev A adds** | Requested delivery date |
| `cutoff_at` | TIMESTAMP (tz) | **Dev A adds** | See open question Q2 |
| `submitted_at` | TIMESTAMP (tz) | **Dev A adds** | Null while `draft` |
| `is_high_priority` | BOOLEAN default false | **Dev A adds** | Figma "Default" / "High Priority" |
| `notes` | TEXT | **Dev A adds** | |
| `placed_by` | int FK `users.id` | **Dev A adds** | The store manager |
| `deferral_reason` | TEXT | **Dev A adds** | Written by the Dispatcher team when deferring |
| `deferral_count` | INT default 0 | **Dev A adds** | For "⚠️ Deferred 2 days in a row" |

**One order = one temperature class.** Figma lets a request hold chilled and ambient items together. On submit, Dev A splits it into **one order per temperature class**, for example `ORD0000008` (chilled) and `ORD0000009` (ambient). This enforces the Fresh dual-order rule directly and matches how the loader works (reefer vs. ambient vehicles). *(Confirm: Q1.)*

### `order_items` (existing, Dev A writes, Dev B updates)

| Column | Notes |
|---|---|
| `id`, `order_id`, `sku`, `item_name`, `quantity`, `unit_price` | existing. `quantity` = requested |
| `quantity_sent` | **Dev B adds**: what the depot actually loaded (Figma 04 "Sent" / "Difference") |
| `dispatcher_note` | **Dev B adds**: e.g. "8 of 10 cases sent due to stock shortage" (Figma 04b) |

### `notifications` (new, Dev A)

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `outlet_id` | int FK `outlets.id` | Who sees it |
| `order_id` | int FK `orders.id`, nullable | |
| `type` | enum | See section 4 |
| `category` | enum `request \| delivery \| issue` | Figma tabs: Requests / Deliveries / Issues |
| `title` | VARCHAR(200) | e.g. "Dispatcher note on ORD0000001" |
| `message` | TEXT | |
| `is_read` | BOOLEAN default false | |
| `created_at` | TIMESTAMP (tz) | |

Index: `(outlet_id, is_read)`.

### `loading_tasks`, `delivery_receipts` (new, Dev B)

As in the workplan, but with `id` as an **int** PK and `order_id` as an **int** FK to `orders.id`. `delivery_receipts.outlet_id` is an int FK to `outlets.id`.

### Changes to shared tables (ask the owners)

- **`users`**: add `store_manager` and `loader` to the `UserRole` enum, and add `outlet_id` (int FK `outlets.id`, nullable) so a store manager's outlet comes from their profile.
- **`inventory_items`** (the depot catalogue in Figma 03b): add `category`, `temperature_class`, `unit_label` (e.g. "Cases"), `unit_weight_kg`, `unit_volume_m3`. The weight/volume columns let order totals be calculated from the items. *(Owner: warehouse/inventory team. Q4.)*

---

## 3. Service contracts

Same style as the existing `order_service.py`: a class with static methods, `db: Session` first, and a shared instance.

```python
# Dev A exposes. Dev B calls these exactly.
order_service.get_orders_by_date(db, date: date, depot: Depot) -> list[Order]
order_service.update_order_status(db, order_id: int, status: OrderStatus) -> Order
notification_service.send(db, outlet_id: int, type: NotificationType, meta: dict) -> Notification

# Dev B exposes. Dev A reads these for the order detail screen.
loading_service.get_loading_status_by_order(db, order_id: int) -> LoadingStatus | None
receipt_service.get_receipt_by_order(db, order_id: int) -> DeliveryReceipt | None
```

Dev A's own (not called by Dev B): `place_order`, `save_draft`, `get_orders`, `get_order_detail`, `cancel_order`; `calendar_service.is_operating_day`, `calendar_service.get_next_operating_day`.

Until the real one exists, each dev codes against a **stub with exactly these signatures**.

---

## 4. Notification types

| `type` | `category` | Fired by | Example title (Figma 10) |
|---|---|---|---|
| `order_submitted` | request | Dev A | "ORD0000008 submitted" |
| `order_confirmed` | request | Dispatcher team | "ORD0000008 accepted into tomorrow's plan" |
| `dispatcher_note` | request | Dev B (partial allocation) | "Dispatcher note on ORD0000001" |
| `shortfall_warning` | request | Dev B | "Shortfall on ORD0000001" |
| `deferred` | request | Dispatcher team | "ORD0000003 deferred to Mon 28 Sep" |
| `ready_for_dispatch` | request | Dev B | "ORD0000002 is ready for dispatch" |
| `eta_updated` | delivery | Dispatcher/Driver | "ORD0000001 is approaching, ETA 06:10" |
| `delivered` | delivery | Driver team | "ORD0000004 arrived at the rear dock" |
| `issue_logged` | issue | Dev B | "Delivery issue logged: ISS0000001" |
| `order_closed` | request | Dev B | "ORD0000005 closed" |

---

## 5. API routes (prefix `/api/v1`)

*Updated 30 Sep 2026 to match what's built. The Store Manager routes live in their own module (`endpoints/store_orders.py`) so they don't clash with the Dispatcher team's changes to `endpoints/orders.py`. The existing `/orders/` CRUD routes are unchanged.*

| Route | Owner | Notes |
|---|---|---|
| `POST /orders/store` | Dev A | Place a goods request. Body: `outlet_id`, `delivery_date`, `is_priority`, `notes`, `items[]` (`sku`, `item_name`, `quantity`, `temperature_zone`: `Chilled`/`Ambient`). Returns **one order per zone** |
| `GET /orders/store?outlet_id=&status=&priority=&date_from=&date_to=&search=` | Dev A | Goods Requests list. Repeat `status` for several; dates filter on submission time |
| `GET /orders/store/{order_number}` | Dev A | Request Details, e.g. `ORD0000001` |
| `POST /orders/{order_id}/cancel` | Dev A | Cancel before the cutoff (only draft / submitted / confirmed) |
| `PATCH /orders/{order_id}/status` | Dev A → **Dev B, Driver, Dispatcher call it** | `update_order_status`. Illegal moves return **409** |
| `POST /orders/{order_id}/defer` | Dev A → **Dispatcher calls it** | Body: `reason`, optional `new_delivery_date`. Counts deferrals, notifies the store |
| `GET /orders/by-date?date=&depot=` | Dev A → **Dev B calls it** | `get_orders_by_date` for loading lists |
| `GET /notifications/?outlet_id=&category=&unread=` | Dev A | Newest first |
| `PATCH /notifications/{id}/read`, `POST /notifications/read-all?outlet_id=` | Dev A | |
| `GET /calendar/operating-days?date_from=&date_to=` | Dev A | Operating days plus `earliest_default` / `earliest_high_priority` for the date picker (03c) |
| `/loading/*`, `/receipts/*` | Dev B | As in the workplan |

Rule errors return **422** with `detail.code`: `NOT_OPERATING_DAY` (+ `suggested_date`), `CUTOFF_PASSED`, `TOO_EARLY` (+ `earliest_date`), `DUPLICATE_ORDER` (+ `existing_orders`), `MIXED_ZONES_NOT_ALLOWED`.

**Column decisions (30 Sep):** the orders code reuses Nisith's columns from `0a80c3e0353c` as they are: `is_priority`, `deferral_reason`, `temperature_zone` (`Chilled`/`Ambient`), `weight_kg`, `brand`, `district`, `delivery_window`, and **`operating_date` as the requested delivery date** (`YYYY-MM-DD`). Loader `0003` supplies `outlet_id`, `units`, `volume_m3` (it should no longer add `brand`, `weight_kg` or `temperature_class`). Dev A only adds `submitted_at`, `cutoff_at`, `notes`, `placed_by`, `deferral_count`, the `notifications` table, and the `SUBMITTED` / `READY_FOR_DISPATCH` / `COMPLETED` status values.

---

## 6. Business rules (Dev A enforces in `place_order`)

- The delivery date must be an operating day (`calendar_days.is_operating`). If it isn't, reject with the reason (e.g. the holiday name) and suggest `get_next_operating_day`.
- The cutoff is **strict**: an order at exactly the cutoff time is rejected. Timezone **Asia/Colombo**.
- **Fresh outlets:** at most one `chilled` and one `ambient` order per outlet per delivery date. Style/Tech outlets: one order per date.
- Deferral: when the Dispatcher team defers an order, set `status=deferred`, `deferral_reason`, `deferral_count += 1`, and call `notification_service.send(..., "deferred", ...)`.

---

## 7. Build order and migrations

1. **Sachintha's loader migrations** (`outlets`, `calendar_days`, `orders` loader columns) must reach `dev` first. Dev A's orders work depends on them.
2. **Dev A migration**: `orders` columns, `notifications`, `users` role and `outlet_id`. Dev B migration: `loading_tasks`, `delivery_receipts`, `order_items` columns. **One migration PR at a time**, each after the previous head. The DB lead applies them.
3. Until then, both devs build the **frontend against mock data** with the same shapes, so the UI isn't blocked.

---

## 8. Open questions (settle in the kickoff)

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Split mixed chilled/ambient requests into two orders on submit? | Yes |
| Q2 | When is the cutoff? The workplan says "4 PM on order_date", but delivery is 04:00–07:45 that morning. | 4 PM on the **day before** the delivery date |
| Q3 | Figma shows "Default 48h" / "High Priority 24h". How does that combine with the cutoff? | Default = earliest delivery 2 operating days out; High = next operating day; both still obey the 4 PM cutoff |
| Q4 | Who adds catalogue columns to `inventory_items`? | Dev A with their OK |
| Q5 | Where does the ETA come from? The workplan mentions a `deliveries` table that doesn't exist. | `dispatch_trips.estimated_arrival` via `shipments`. Confirm with the Dispatcher team | This i think it should be the dispatcher team that should handle it. we should just access it
| Q6 | Login (Figma 00): who builds it, and do we use the existing JWT auth or Keycloak? | Existing JWT auth with a `role` claim; whoever finishes first | No this is using keycloak n is built by someone else
| Q7 | Store Manager page layout (sidebar, top bar, mobile nav): who builds it? | Dev A (it hosts the Dashboard); Dev B reuses it |

**Signed off:** Dev A  · Dev B  · DB lead
