# Store Manager + Loader Module — 2-Member Workplan
### Waypoint Group Logistics System · Tech-Triathlon 2026 Hackathon

---

> [!IMPORTANT]
> **Hackathon Deadline:** Sunday, October 4, 2026 at 11:59 PM (Day 10)
> **Dev window:** Day 6 AM → Day 9 EOD (3 – 3.5 days active dev).
> Day 10 = final integration smoke test, demo video, README polish.

---

## How These Two Roles Connect

The Loader and Store Manager aren't separate modules — they're two ends of the same physical goods flow:

```
Store Manager places order
         │
         ▼
  [orders table]  ◄── single source of truth
         │
         ▼
Loader sees the order on their loading list
Loader picks & verifies items, flags shortfalls
         │
         ▼ (vehicle departs)
Driver delivers → marks stop complete
         │
         ▼
Store Manager confirms receipt, reports issues
```

So the **entire user-facing workflow** for these two roles must be designed and built as one coherent flow — just split across two developers by vertical slice.

---

## The Vertical Split

Rather than splitting by frontend/backend (which creates blocking dependencies), each developer owns a **complete feature flow** — from database migration all the way to the UI screen — for their slice. They share only the `orders` table as the integration boundary.

| | **Dev A — Order Placement & Status Flow** | **Dev B — Loading & Receipt Flow** |
|---|---|---|
| **Owns (DB)** | `orders`, `notifications` tables | `loading_tasks`, `delivery_receipts` tables |
| **Owns (Service)** | `OrderService`, `NotificationService`, `CalendarService` | `LoadingService`, `ReceiptService` |
| **Owns (API)** | `/api/orders/*`, `/api/notifications/*` | `/api/loading/*`, `/api/receipts/*` |
| **Owns (UI — Store Manager)** | Order placement screen, Order history & detail screen, Notification panel | Receipt confirmation screen, Issue reporting screen |
| **Owns (UI — Loader)** | — | Loading list screen, Item verification screen, Shortfall flagging screen |
| **Integration point** | Writes to `orders` → Dev B reads it | Writes `loading_tasks.status` → Dev A's notification fires |

> [!NOTE]
> The **only shared dependency** is the `orders` table — Dev A writes it, Dev B reads it.
> This means Dev B can work against a mock/seed from Day 1 without waiting for Dev A.
> Agree on the `orders` schema in the joint Day 1 session and **never rename columns** — only add.

---

## Shared Architecture

Modular monolith: one deployable process, clean internal service boundaries. Modules call each other's **service functions directly** (no HTTP between modules). A simple in-process **event bus** (`EventEmitter` in Node, or a signals/events pattern) handles cross-module notifications so modules stay decoupled.

```
┌────────────────────────────────────────────────────────────────┐
│                     MODULAR MONOLITH                           │
│                                                                │
│  ┌────────────────────────┐   ┌─────────────────────────────┐  │
│  │   ORDER & NOTIFICATION  │   │   LOADING & RECEIPT         │  │
│  │      FLOW (Dev A)       │   │      FLOW (Dev B)           │  │
│  │                         │   │                             │  │
│  │  OrderService           │   │  LoadingService             │  │
│  │  NotificationService    │◄──│  ReceiptService             │  │
│  │  CalendarService        │   │  (reads orders, fires       │  │
│  │                         │   │   notification on shortfall)│  │
│  └────────────┬────────────┘   └──────────────┬──────────────┘  │
│               │                               │                 │
│               └──────────┬────────────────────┘                 │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │    PostgreSQL DB       │                          │
│              │  orders               │                          │
│              │  notifications        │                          │
│              │  loading_tasks        │                          │
│              │  delivery_receipts    │                          │
│              │  outlets (seeded)     │                          │
│              │  vehicles (seeded)    │                          │
│              └───────────────────────┘                          │
└────────────────────────────────────────────────────────────────┘
```

**Integration contracts to finalize in the Day 1 joint session:**

| Contract | Owner | Called By |
|----------|-------|-----------|
| `OrderService.getOrdersByDate(date, depotId)` | Dev A | Dev B (to build loading lists) |
| `OrderService.updateOrderStatus(orderId, status)` | Dev A | Dev B (marks order as loaded / delivered) |
| `NotificationService.send(outletId, type, payload)` | Dev A | Dev B (on shortfall, on delivery) |
| `OrderStatus` enum: `pending \| confirmed \| loading \| in_transit \| delivered \| deferred` | Both | All flows |
| `LoadingStatus` enum: `pending \| in_progress \| completed \| shortfall_flagged` | Dev B | Dev A reads for notification trigger |

---

## Shared DB Schema (finalize Day 1 together)

```sql
-- ── Dev A owns ───────────────────────────────────────────────────

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id        VARCHAR(10)   NOT NULL REFERENCES outlets(outlet_id),
  brand            VARCHAR(20)   NOT NULL,  -- Fresh | Style | Tech
  temp_requirement VARCHAR(10)   NOT NULL,  -- chilled | ambient
  order_date       DATE          NOT NULL,  -- requested delivery date
  placed_at        TIMESTAMP     NOT NULL,
  cutoff_at        TIMESTAMP     NOT NULL,  -- always 4 PM on order_date
  order_units      INTEGER       NOT NULL,
  order_weight_kg  DECIMAL(10,2),
  order_volume_m3  DECIMAL(10,4),
  notes            TEXT,
  status           VARCHAR(25)   NOT NULL DEFAULT 'pending',
  -- pending | confirmed | loading | in_transit | delivered | deferred
  is_high_priority BOOLEAN       DEFAULT FALSE,
  placed_by        UUID,         -- store manager user id
  created_at       TIMESTAMP     DEFAULT NOW(),
  updated_at       TIMESTAMP     DEFAULT NOW()
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id  VARCHAR(10)  NOT NULL REFERENCES outlets(outlet_id),
  order_id   UUID         REFERENCES orders(id),
  type       VARCHAR(40)  NOT NULL,
  -- order_confirmed | eta_updated | deferred | shortfall_warning | delivered
  title      VARCHAR(200),
  message    TEXT,
  is_read    BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMP    DEFAULT NOW()
);

-- ── Dev B owns ───────────────────────────────────────────────────

CREATE TABLE loading_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID         NOT NULL REFERENCES orders(id),
  vehicle_id      VARCHAR(10)  NOT NULL,
  assigned_loader UUID,
  status          VARCHAR(25)  NOT NULL DEFAULT 'pending',
  -- pending | in_progress | completed | shortfall_flagged
  loaded_units    INTEGER,
  shortfall_notes TEXT,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP    DEFAULT NOW(),
  updated_at      TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE delivery_receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID         NOT NULL REFERENCES orders(id),
  outlet_id           VARCHAR(10)  NOT NULL REFERENCES outlets(outlet_id),
  units_received      INTEGER,
  weight_received_kg  DECIMAL(10,2),
  has_issues          BOOLEAN      DEFAULT FALSE,
  issue_type          VARCHAR(30), -- short_delivery | damaged | wrong_items | other
  issue_description   TEXT,
  confirmed_at        TIMESTAMP,
  synced_from_offline BOOLEAN      DEFAULT FALSE,  -- was this submitted offline?
  created_at          TIMESTAMP    DEFAULT NOW()
);
```

---

## Day-by-Day Workplan

---

### 📅 DAY 1 Morning — Joint Kickoff (~2.5–3 hours, both together)

> **Do this first. Skipping this causes merge conflicts and integration pain.**

- [ ] Read and align on the full plan together
- [ ] Set up monorepo: `git init`, folder structure agreed, `docker-compose.yml` working, DB connects
- [ ] Run seeding scripts: `outlets.csv`, `vehicles.csv`, `calendar.csv` → into DB
- [ ] Finalize and **commit** the full DB schema above (both migrate together, one migration file)
- [ ] Define and commit the service interface contracts (even as empty stubs/interfaces):
  ```
  /src/modules/orders/OrderService.ts       ← Dev A will implement
  /src/modules/orders/NotificationService.ts ← Dev A will implement
  /src/modules/loading/LoadingService.ts     ← Dev B will implement
  /src/modules/receipts/ReceiptService.ts    ← Dev B will implement
  ```
- [ ] Define the `OrderStatus` and `LoadingStatus` enums in a shared `/src/shared/enums.ts` file
- [ ] Create seed data for at least one realistic delivery day (needed by both devs to test)
- [ ] Agree on auth: JWT with `role` claim (`store_manager` | `loader` | `dispatcher` | `driver`)
- [ ] Split and go

---

### 📅 DAY 1 Afternoon → DAY 2 — Core Full-Stack Build

---

#### 🔵 Dev A — Order Placement & Status Flow (Full Stack)

**Goal by end of Day 2:** A store manager can log in, place an order, see it in their history with status, and receive a deferral notification — all working end to end.

**Day 1 Afternoon — Data & Service layer:**
- [ ] Implement `CalendarService`:
  - `isOperatingDay(date: Date): boolean` — reads calendar table
  - `getNextOperatingDay(from: Date): Date`
- [ ] Implement `OrderService`:
  - `placeOrder(outletId, payload)` — validate: operating day, cutoff not passed, Fresh dual-order rule (same outlet can have one `ambient` + one `chilled` order on same day, no more)
  - `getOrders(outletId, filters)` — for order history (filter by date, status)
  - `getOrderDetail(orderId)` — with ETA pulled from `deliveries` table (written by Dispatcher module)
  - `cancelOrder(orderId)` — only allowed before cutoff
  - `updateOrderStatus(orderId, status)` — **this is the contract Dev B calls**
- [ ] Implement `NotificationService`:
  - `send(outletId, type, payload)` — **this is the contract Dev B calls**
  - Internally inserts into `notifications` table
  - Optionally push via SSE if the outlet's browser is connected
- [ ] Write unit tests for: cutoff enforcement, dual Fresh order logic, operating-day validation

**Day 2 — API layer + UI:**
- [ ] Wire up API routes:
  - `POST /api/orders` — place new order
  - `GET /api/orders?outletId=&date=&status=` — order list
  - `GET /api/orders/:id` — order detail + ETA
  - `DELETE /api/orders/:id` — cancel (pre-cutoff only)
  - `GET /api/notifications?outletId=` — notification list
  - `PATCH /api/notifications/:id/read` — mark read
- [ ] Add request validation (Zod/Joi)
- [ ] Build **Order Placement Screen** (Store Manager):
  - Outlet is pre-set from logged-in user's profile
  - Delivery date picker — only operating days enabled (from CalendarService)
  - Order type: `Dry` / `Chilled` (Fresh shows both; others show one)
  - Fields: units, weight (kg), volume (m³), notes
  - **Cutoff countdown** displayed prominently: "Cutoff in 2h 15m"
  - Form disabled with message after 4 PM
  - On submit → show order ID confirmation card
- [ ] Build **Order History & Dashboard Screen** (Store Manager):
  - List of orders with color-coded status badges
  - `⚠️ Deferred 2 days in a row` warning surfaced visually
  - Filter by date, status
  - Tap/click → Order Detail
- [ ] Build **Order Detail Screen** (Store Manager):
  - Order summary, ETA if dispatched, status timeline
  - Deferral reason if applicable
- [ ] Build **Notification Panel** (Store Manager):
  - Bell icon with unread count badge
  - Notification list: confirmed / deferred / shortfall warning / delivered
  - Deferral notice should be prominent and explain why
  - Mark all as read

---

#### 🟢 Dev B — Loading & Receipt Flow (Full Stack)

**Goal by end of Day 2:** A loader can log in, see their vehicle's loading list from today's orders, verify items, flag a shortfall, and a store manager gets a shortfall notification. A store manager can confirm receipt of a delivered order.

**Day 1 Afternoon — Data & Service layer:**
- [ ] Implement `LoadingService`:
  - `getLoadingTasksByVehicle(vehicleId, date)` — reads `orders` (via `OrderService.getOrdersByDate`) and returns grouped loading list per vehicle
  - `startLoading(orderId, loaderId)` — creates `loading_tasks` entry, updates order status to `loading`
  - `confirmItemLoaded(taskId, loadedUnits)` — updates `loading_tasks`
  - `flagShortfall(taskId, notes)` — sets status to `shortfall_flagged`, **calls `NotificationService.send(outletId, 'shortfall_warning', ...)`** (Dev A's contract)
  - `completeLoading(taskId)` — marks `completed`, calls `OrderService.updateOrderStatus(orderId, 'in_transit')`
- [ ] Implement `ReceiptService`:
  - `submitReceipt(payload)` — inserts into `delivery_receipts`, calls `OrderService.updateOrderStatus(orderId, 'delivered')`, fires `NotificationService.send(outletId, 'delivered', ...)` if issue
  - `syncOfflineReceipts(receipts[])` — batch insert for offline-submitted receipts
  - `getReceiptByOrder(orderId)` — for Store Manager detail view
- [ ] Use **stub / mock for `OrderService` and `NotificationService`** until Dev A's implementation is ready — match the agreed interface exactly
- [ ] Write unit tests for: shortfall flag triggering notification, receipt marking order delivered, offline batch sync

**Day 2 — API layer + UI:**
- [ ] Wire up API routes:
  - `GET /api/loading/tasks?vehicleId=&date=` — loading list for loader
  - `PATCH /api/loading/tasks/:id/start` — start loading
  - `PATCH /api/loading/tasks/:id/item` — confirm item loaded
  - `PATCH /api/loading/tasks/:id/shortfall` — flag shortage
  - `PATCH /api/loading/tasks/:id/complete` — mark loading done
  - `POST /api/receipts` — submit delivery receipt
  - `POST /api/receipts/sync` — batch sync offline receipts
  - `GET /api/receipts/:orderId` — get receipt for an order
- [ ] Build **Loading List Screen** (Loader — tablet/phone sized):
  - Vehicle ID and date at top
  - Orders grouped by brand and district (reflects stop sequence)
  - Each order shows: outlet name, order ID, items/units, weight, volume, priority badge
  - Tap to expand and start loading
- [ ] Build **Item Verification Screen** (Loader):
  - Item list with checkboxes and quantity fields
  - "Loaded: __ / Expected: __" per line item
  - Large touch targets (tablet/phone use)
  - Confirm button → marks task complete, updates order status
- [ ] Build **Shortfall Flagging Screen** (Loader):
  - Surface when loader checks fewer items than ordered
  - Severity indicator, free-text notes field
  - Submit → triggers notification to store manager
  - Clear confirmation: "Shortfall reported. Dispatcher has been notified."
- [ ] Build **Receipt Confirmation Screen** (Store Manager — desktop/phone):
  - Appears when order status = `delivered`
  - Shows: ordered vs received quantities side by side
  - Toggle: "All received correctly" / "Report an issue"
  - Issue types: Short delivery / Damaged goods / Wrong items / Other
  - Free text description
  - Submit → stores receipt, marks order fully closed
  - **Offline support:** if no network, save to `localStorage`/IndexedDB, show sync banner on reconnect
- [ ] Build **Offline Sync Flow**:
  - On reconnect, detect pending receipts in local storage
  - Banner: "2 unsynced receipts — Sync Now"
  - On confirm, call `POST /api/receipts/sync` with batch
  - Clear local storage on success, show confirmation

---

### 📅 DAY 3 — Integration & Cross-Module Wiring

**Dev A:**
- [ ] Replace stubbed `LoadingService`-side calls with real service (if any cross-calls exist)
- [ ] Verify end-to-end: order placed → appears in dispatcher queue → dispatcher defers it → notification sent to store manager (coordinate with dispatcher dev team for the notification trigger)
- [ ] Verify ETA data: when Dispatcher writes to `deliveries` table, store manager's order detail screen should reflect the ETA
- [ ] Edge cases:
  - Order placed on a holiday → reject with friendly message and suggest next operating day
  - Duplicate Fresh order (same outlet, same date, same temp) → reject with message
  - Order placed exactly at 16:00:00 → treat as rejected (cutoff is strict)
  - Deferred order consecutive count → surface in order history UI
- [ ] Add DB indexes: `orders(outlet_id, order_date)`, `notifications(outlet_id, is_read)`, `loading_tasks(order_id)`
- [ ] Finalize notification content strings (exact text for each notification type)

**Dev B:**
- [ ] Replace mock `OrderService` and `NotificationService` with real implementations from Dev A
- [ ] Verify end-to-end: loading task created → loader confirms shortfall → notification appears in store manager's panel
- [ ] Verify end-to-end: delivery marked complete by Driver module → receipt screen unlocks for store manager
- [ ] Verify offline receipt: submit offline, close browser, reopen, sync banner appears, sync completes, status updates
- [ ] Polish loading list UI for tablet/shared terminal use (large tap targets, bold text, high contrast)
- [ ] Add **Degradation screen** (Loader — when system is down):
  - "System unavailable. Continue with your printed loading list. Come back to confirm when connectivity returns."
  - Allow offline-mode confirmation: store checked items in `localStorage`
- [ ] Polish receipt confirmation for phone screen (judge will test on phone-sized viewport)
- [ ] Empty states: "No loading tasks for today", "No orders to confirm"
- [ ] Error states: failed API call with retry, validation errors inline

---

### 📅 DAY 3.5 (Half Day) — QA, Demo Prep & Docs

**Both together:**
- [ ] Full judge walkthrough from scratch on a fresh DB:
  1. Log in as Store Manager (Fresh) → place dry order → place chilled order → see them in history
  2. Log in as Store Manager (Style) → place weekly order → attempt order after 4 PM → see rejection
  3. [Dispatcher seeds the plan] → Store Manager receives ETA notification
  4. Log in as Loader → see vehicle's loading list → start loading → flag shortfall on one order
  5. Store Manager receives shortfall warning notification
  6. Driver marks delivery complete → Store Manager receives "delivered" notification
  7. Store Manager confirms receipt, reports a damaged goods issue
  8. Turn off network → Store Manager submits receipt offline → turn network back on → sync
- [ ] Fix any critical bugs surfaced in walkthrough
- [ ] Document 4 seeded demo accounts in README:

  | Role | Credentials | Outlet |
  |------|------------|--------|
  | Store Manager (Fresh, Colombo) | `fresh.store@waypoint.lk` / `pass123` | OUT001 |
  | Store Manager (Style, Mall) | `style.store@waypoint.lk` / `pass123` | OUT015 |
  | Store Manager (Tech) | `tech.store@waypoint.lk` / `pass123` | OUT021 |
  | Loader (Peliyagoda) | `loader01@waypoint.lk` / `pass123` | — (VEH001) |

- [ ] Update `docs/architecture.md` and `docs/reference/data-model.md` with Store Manager + Loader flows
- [ ] Push final branch, confirm `docker compose up` works from scratch on a clean pull

---

## Complete Screen Inventory

### Store Manager Screens (Dev A + Dev B)

| Screen | Owner | Trigger |
|--------|-------|---------|
| Order Placement | Dev A | User lands on dashboard, clicks "New Order" |
| Order History / Dashboard | Dev A | Default landing screen |
| Order Detail + ETA | Dev A | Click any order in history |
| Notification Panel | Dev A | Bell icon, or redirected from deferral email/push |
| Receipt Confirmation | Dev B | Order status changes to `delivered` — CTA appears |
| Issue Report | Dev B | Part of Receipt Confirmation flow |
| Offline Sync Banner | Dev B | On reconnect, if offline receipts pending |
| Service Degradation Screen | Dev B | API unreachable (loading or receipt flow) |

### Loader Screens (Dev B)

| Screen | Owner | Trigger |
|--------|-------|---------|
| Loading List (vehicle view) | Dev B | Loader logs in, selects vehicle/date |
| Item Verification | Dev B | Tap into an order on loading list |
| Shortfall Flag | Dev B | Loaded quantity < ordered quantity |
| Loading Complete Confirmation | Dev B | All items checked, tap "Complete" |
| Offline Degradation Screen | Dev B | API unreachable at loading dock |

---

## Integration Points at a Glance

These are the exact handoffs between Dev A and Dev B's slices. Agree on these signatures on Day 1 and **do not change them** without telling the other person:

```ts
// Dev A exposes — Dev B must call these exactly
OrderService.getOrdersByDate(date: string, depot: string): Order[]
OrderService.updateOrderStatus(orderId: string, status: OrderStatus): void
NotificationService.send(outletId: string, type: NotificationType, meta: object): void

// Dev B exposes — Dev A may read (e.g., for order detail showing loading status)
LoadingService.getLoadingStatusByOrder(orderId: string): LoadingStatus
ReceiptService.getReceiptByOrder(orderId: string): DeliveryReceipt | null
```

Cross-module (with teams working on other modules):

| Event | Who fires | Who listens |
|-------|-----------|-------------|
| Dispatcher finalizes plan → ETAs known | Dispatcher team | Dev A (updates order detail ETA display) |
| Dispatcher defers an order | Dispatcher team | Dev A (`NotificationService.send` → store manager) |
| Driver marks delivery complete | Driver team | Dev B (unlocks receipt screen) |
| Loader flags shortfall | Dev B | Dev A (`NotificationService.send` → store manager) |
| Store Manager submits receipt with issue | Dev B | Dispatcher team (can see issue log) |

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Dev B waiting for `OrderService` to read real orders | High | Seed 20 dummy orders on Day 1; replace with real service on Day 2 EOD |
| Interface signature mismatch between A and B | Medium | Commit interface stubs on Day 1; no changes without telling each other |
| Offline sync edge cases eating Day 3 | Medium | Ship basic `localStorage` version first; handle batch sync as stretch goal |
| Dispatcher team not ready to fire notifications | Medium | Dev A's `NotificationService` is self-contained; test it independently with a seeded trigger |
| Driver team not marking deliveries → receipt screen never unlocks | Medium | Add a manual "force-complete" override in seed data for judge walkthrough |
