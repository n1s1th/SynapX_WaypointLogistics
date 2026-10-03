# Driver — offline delivery & sync

What the driver app does without signal, how records reach the server, and
what reviewers from other modules need to know before merging.

## Before you run this branch against Neon

The shared Neon database needs one additive schema change first, otherwise
every driver trip request fails with `column delivery_stops.outcome_reason does
not exist` (HTTP 500).

1. Neon console → **SQL Editor** (runs as `neondb_owner`; the app role
   `waypoint_app` is not allowed to alter these tables).
2. Paste and run `backend/scripts/sql/0006_driver_offline_sync.sql`.
   It adds the `driver_sync_events` table and three nullable columns
   (`delivery_stops.outcome_reason`, `proof_of_delivery.delivered_items`,
   `proof_of_delivery.captured_at`). No existing rows change, it does not touch
   `alembic_version`, and it is safe to run twice.
3. Check from `backend/`: `python scripts/apply_driver_offline_sync.py --dry-run`
   should print "Nothing to do".

To avoid touching the shared database at all, test on a Neon branch: create
one from `main`, point `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in
`backend/.env` at its host, run the SQL there, delete the branch afterwards.

Why not `alembic upgrade`? Neon is stamped with store-manager's
`0006_delivery_issues`, and `dev` has `0006_run_dispatch_trip_unique`; this branch
adds `0006_driver_offline_sync`. All three revise `0005`. Whoever merges them
runs `alembic merge heads` once. `0006_driver_offline_sync` skips anything
that already exists, so it is safe after the SQL above.

## Try it

```
cd backend && python scripts/seed_colombo.py --reset   # test run DT-CMB-001: 3 Colombo stops with orders
```

Sign in at `/driver/login` as `driver@waypoint.com` / `driver123`.
Offline reload needs the service worker: `npm run build && npm start`
(or `NEXT_PUBLIC_DRIVER_SW=1` under `next dev`). In Chrome DevTools use
Network → **Offline**, and Application → IndexedDB → **WaypointOfflineSync** to
see `sync_queue`, `trip_cache` and `offline_files`. Clear site data afterwards.

The seed only creates/resets its own data (run `DT-CMB-001`, orders
`CMB-ORD-001..003`), but teammates on the same database will see that run.

## How it works

**Online preparation.** Opening a trip caches it in IndexedDB: stops, addresses,
coordinates, order items and the POD rules. A trip can only be started online.

**Recording.** Every write — arrival, delivery, trip completion, issue — is saved
to IndexedDB first (in one transaction with its photos) and only then reported
as saved. A delivery is a single `deliver` record: outcome, units delivered,
recipient, signature and photos. Outcomes: `delivered`, `partial`, `refused`,
`failed` (refused is stored as `failed` with reason "Refused by outlet"; no enum
change). Any open stop can be recorded, in any order.

**Delivery status vs sync status.** Each stop shows its delivery status and,
separately, `PENDING_SYNC` / `SYNCING` / `SYNCED` / `SYNC_FAILED` / `CONFLICT`.
Nothing is shown as server-confirmed until the server says so.

**Sync.** Starts automatically when `/api/v1/health` is reachable (not just
`navigator.onLine`), plus a manual Retry. Photos upload first (idempotent by a
client file id), then the record goes to `POST /driver/sync`.

- Every record carries a client-generated `action_id`. The server stores each
  result in `driver_sync_events` (unique on `action_id`), so a retry — including
  after a lost response — returns the stored answer instead of applying twice.
- Each record is applied in its own transaction with its ledger row.
- The server re-checks driver, trip assignment, stop, outcome, quantities and
  POD evidence (photo files must exist on the server). Event time (phone) and
  receipt time (server) are stored separately.
- Server errors retry with bounded exponential backoff (8 automatic attempts).
  Rejected records stay on the phone with the reason. One failure never blocks
  the others. A trip completion is sent only after that trip's stop records.
- Expired session (401/403): nothing is lost; the app asks the driver to sign
  in and sync resumes.

**Conflicts.** If dispatch reassigned the trip or removed the stop while the
driver was offline, nothing is applied: the record is stored as a conflict,
the phone keeps the evidence, and the dispatcher reviews it in the run panel.
The driver can remove it from the phone only after that review.

**Logout.** Warns about unsynced records and keeps them on the phone. Cached
trips (customer data) are cleared only when nothing is waiting to sync.

**Maps.** Map tiles (`tiles.openfreemap.org`) and routing
(`router.project-osrm.org`) need a connection; offline the stop list,
addresses and coordinates still work. Offline maps would need a cached tile
pack (e.g. PMTiles); not included.

## Changes outside the driver module (please review)

| Area | Change |
|---|---|
| All APIs | `backend/app/core/error_middleware.py`, registered in `app/main.py`: unhandled errors return a JSON 500 *inside* CORS, so browsers see the real error instead of "Failed to fetch". |
| Dispatcher | `dispatch.py`: `GET /delivery-runs/{id}/deliveries` (server-confirmed outcomes, quantities, POD, timestamps, conflicts) and `POST /delivery-runs/{id}/sync-conflicts/{event_id}/review`. `DeliveryRunDetailPanel` shows a "Driver deliveries" section; the Delivery Runs page refreshes every 30 s. Driver progress updates `dispatch_trips.status`, `stop_count`, `stops_completed`. |
| Store manager | A delivered/partial stop moves its order DISPATCHED → DELIVERED through `OrderService.update_order_status` (sends the store notification). Failed/refused stops leave the order DISPATCHED. |
| Database | Migration `0006_driver_offline_sync` (see above). |

## Key files

- Backend: `app/services/driver_service.py` (sync section), `app/models/driver.py`
  (`DriverSyncEvent`), `app/schemas/driver.py`, `app/api/v1/endpoints/driver.py`
- Frontend: `lib/driverSync/engine.ts` (pure sync logic), `lib/syncQueue.ts`
  (IndexedDB), `lib/useSyncQueue.ts`, `lib/driverStop.ts` (server-or-cache
  loaders), `app/driver/queue/*`, `app/driver/trip/{arrived,outcome,proof}`,
  `components/driver/*`, `public/driver-sw.js`

## Tests

```
cd backend  && .venv/Scripts/python.exe -m pytest tests/api/test_driver_sync.py tests/unit/test_error_middleware.py -q
cd frontend && npm run test:driver-sync
```

Backend tests use an isolated in-memory SQLite database, never Neon. The full
backend suite has 3 failures (`test_allocations`, `test_auth`, `test_tracking`)
that predate this work.

## Not done yet

- Creating driver trips from a released loader run (today they come from seed
  scripts). Needs the loader/dispatcher code on `dev`.
- Showing the driver's delivered quantities / POD on the store receipt page.
