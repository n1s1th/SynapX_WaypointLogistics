# Waypoint Logistics — Project Context (Loader Module)

Team SynapX · Loader module owners: Sachintha and Sanduni
Repo: https://github.com/n1s1th/SynapX_WaypointLogistics

## 1. What the product is

Waypoint Logistics is the logistics management system for **Waypoint Group (Pvt) Ltd**. It plans outlet orders, allocates a limited fleet under constraints, loads vehicles, delivers, and closes the loop with store managers.

The group runs three brands, each with different delivery needs:

| Brand | Ordering pattern | Logistics impact |
| --- | --- | --- |
| Fresh | Daily dry goods + separate chilled/frozen orders several days a week | Needs reefer (chilled) vehicles; same outlet can have a dry and a chilled order on one day |
| Style | Weekly, larger before seasonal peaks | Volume spikes |
| Tech | As needed, often a single item | Small, irregular orders |

Depots: **Peliyagoda** (dispatch office) and **Kandy**. Orders close at the **4 PM cutoff**; Fresh deliveries must arrive before outlets open at **8 AM**. Demand usually exceeds fleet capacity, so some orders are deferred.

## 2. The four roles

| Role | Persona | Device | Core job |
| --- | --- | --- | --- |
| Dispatcher | Kasun Perera | Large screen, office | Allocate vehicles/trips under constraints, defer orders with a reason, monitor deliveries, handle exceptions |
| **Loader** | **Saman Jayawardena** | **Shared tablet/terminal at the loading dock** | **Load each trip in stop-sequence order, verify quantities, flag shortfalls, confirm ready to depart** |
| Driver | Tharindu Fernando | Mobile, often offline | Follow stop sequence, confirm deliveries, proof of delivery, offline sync |
| Store Manager | Chamari Gunawardena | Desktop or phone at outlet | Place orders, track ETA, read deferral notices, confirm receipt |

End-to-end flow:

```
Store Manager places order → 4 PM cutoff → Dispatcher allocates vehicle + trip (stop sequence)
  → LOADER loads trip by stop sequence → Ready to depart → Driver delivers → Store Manager confirms receipt
```

## 3. The Loader role in detail (our module)

> "The vehicle should leave with exactly what the order requires, loaded in the order it needs to come off."

**Profile:** Depot worker at Peliyagoda or Kandy, standing at a loading dock, using a shared tablet or terminal. Works one trip at a time from a checklist. Loads runs the dispatcher has already planned.

**Goals**
- Load the correct goods in the correct stop-sequence order.
- Catch missing or damaged items before the vehicle leaves.
- Keep vehicles departing on schedule.
- Know immediately if the dispatcher changes the plan mid-load.

**Pain points today**
- Printed loading lists go out of date as soon as the dispatcher changes the plan.
- Fresh outlets can have a dry and a chilled order the same day — easy to mix up or put on the wrong vehicle.
- Late plan changes cause rework after loading has started.
- Shortages are found mid-load with no fast way to report them.

**Information the loader needs on screen**
- Vehicle ID, trip number, stop sequence of the run.
- Item names and quantities (with units) per stop.
- Outlet dock type (affects how goods are arranged for unloading).
- Changes made to the run since loading started.
- Loading completion status per stop.

**Key tasks**
1. Open the loading queue for today's trips.
2. Load each stop in the correct sequence.
3. Verify quantities per stop.
4. Flag a shortage, damage or mismatch.
5. Acknowledge any plan change made mid-load.
6. Confirm the vehicle is ready to depart.

**Key system interactions**
- Delivery Run → Stop-Sequence Loading Checklist → Item Check → Shortfall Flag (if needed) → Ready to Depart
- Shortfall Flag → Dispatcher Exception Queue

**Design requirements (from the personas' traceability table)**

| Loader need | System requirement | Screen implication |
| --- | --- | --- |
| Accurate, correctly ordered loading list | Stop-sequence-ordered, order-linked item quantities | Vehicle- and trip-specific loading checklist in stop-sequence order |
| Know immediately if a locked plan changes | Live plan-change propagation | Plan-change alert banner on the loading screen |
| Report problems fast | Shortfall/damage flag reaching the dispatcher immediately | One-tap flag flow → dispatcher exception queue |
| Unambiguous departure state | Distinct "loaded" vs "ready to depart" states | Explicit ready-to-depart confirmation |

**UX rules for loader screens**
- Large, scannable information; touch targets at least 44px high.
- Quick confirmations, not multi-step forms.
- One trip at a time; checklist-style.
- Plan-change alerts must be hard to miss.
- Clearly separate chilled vs dry items/orders.

## 4. Tech stack

| Layer | Tech | Location |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind, shadcn/ui, lucide-react | `frontend/` |
| Backend | FastAPI, SQLAlchemy 2, Pydantic 2, Alembic, Python 3.11 | `backend/` |
| Database | PostgreSQL on Neon (shared team dev database) | via `DATABASE_URL` in `backend/.env` |
| Auth | Keycloak (realm `waypointlogistics`) with dev mode fallback | `backend/app/core/security.py`, `api/deps.py` |
| Code graph | Graphify (`graphify-out/`, gitignored) | repo root |

Local URLs: backend http://localhost:5000/api/v1/docs · frontend http://localhost:3000 · loader page http://localhost:3000/loader

## 5. Where loader code goes

**Frontend**
- Page: `frontend/app/loader/page.tsx` (currently a placeholder mock — "Loader Staging & Manifest Verification" with barcode/pallet wording that does not match the persona; to be rebuilt from the Figma loader screens).
- Shared primitives: `frontend/components/ui/*` (shadcn). Waypoint patterns: `frontend/components/domain/*` (`status-pill`, `metric-card`, `temperature-badge`).
- Put loader-specific components in `frontend/components/loader/` (convention to agree on).

**Backend** (layered: endpoint → service → model/schema)
- Endpoints: `backend/app/api/v1/endpoints/` — add a `loader.py` router and register it in `api/v1/api.py` under prefix `/loader`.
- Business logic: `backend/app/services/`
- ORM models: `backend/app/models/` · Pydantic schemas: `backend/app/schemas/`
- Tests: `backend/tests/api/` and `backend/tests/unit/`

## 6. Current data model vs what the loader needs

Existing models (`backend/app/models/`):
- `Order` (order_number, client_name, destination_address, status, items) and `OrderItem` (sku, item_name, quantity, unit_price)
- `DispatchTrip` (trip_code, vehicle_number, driver_name, origin, destination, times) and `Shipment` (order ↔ trip link, status)
- `inventory`, `user`

**Gaps for the loader module** (to agree with the dispatcher team, since they own trip planning):
- No **stops** / **stop sequence** on a trip (Shipment links order → trip but has no sequence).
- No **outlet** entity (dock type, brand).
- No **temperature class** (chilled/frozen/dry) on orders or items.
- No **loading status** per trip, stop or item (not started → loading → loaded → ready to depart).
- No **shortfall/damage flag** record (type, item, quantity, note, reported by, time).
- No **plan revision** tracking to detect "plan changed after loading started".
- No **vehicle** entity (vehicle_number is a plain string).

Coordinate any shared-model change (Order, DispatchTrip, Shipment) with the dispatcher and driver teams before changing it — every role reads these tables.

## 7. Design and coding rules

- **Figma loader screens are the UI source of truth.** Follow them for layout, content and states.
- Read `frontend/AGENTS.md` / `frontend/CLAUDE.md` before frontend work: use semantic tokens from `app/globals.css` (`bg-primary`, `bg-warning-muted`, etc.), shadcn primitives, Lucide icons only, Inter font, no hardcoded brand colors, light mode first.
- Next.js 16 has breaking changes vs older versions — check `node_modules/next/dist/docs/` when unsure.
- Backend: keep endpoints thin; put logic in services; validate with Pydantic schemas; add tests.
- The Neon database is shared: no destructive scripts or table drops without telling the team.
- Never commit `.env` or `.env.local`.
