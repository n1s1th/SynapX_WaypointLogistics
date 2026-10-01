# Driver module

The driver collects the run the loader released, follows the stop sequence, records every stop with proof of delivery, and keeps working without signal. This is the **Deliver** stage of the brief's workflow (Challenge Booklet p7): "Follow the route and record each stop, including while offline."

Phone first: every screen is built for a phone held by a driver who is safely stopped.

## How a trip flows

```
Loader: loads in reverse stop order, flags shortfalls, marks the run "Ready to depart"
  -> Driver opens the run sheet and taps Start trip (the gate-out)
       run: ready_to_depart -> gated_out           (delivery_runs)
       orders on the truck: -> dispatched          (orders, via the order service)
       store: "ORD… is approaching, ETA 05:00"     (notifications)
       dispatcher: run en_route + "Left the gate"  (dispatch_trips)
  -> at each stop: I've arrived -> outcome -> proof of delivery
       full / partial: orders -> delivered, and the store is notified "arrived at the dock"
       not delivered: a reason, raised as an issue for dispatch; orders stay dispatched
  -> Finish trip -> summary -> back at the depot (check-in), ready for trip 2
```

| What happens | Where it is stored |
|---|---|
| Collecting the run | `delivery_runs.status = gated_out` and `gated_out_at` (loader's table, written once) |
| The driver's copy of the stops | `driver_trips`, `delivery_stops` (copied from `run_stops` at gate-out) |
| Proof of delivery | `proof_of_delivery`: recipient, signature, photo (JPEG/PNG data URLs) |
| Problems, failed and partial deliveries | `issue_reports` |
| SOS | `sos_alerts`, with the phone's location |
| Dispatcher visibility | `dispatch_trips`: `status`, `stops_completed`, `updated_at` and the event log |
| "Ready for tomorrow" | `driver_availability` (migration `0006`, see below) |

The driver sees a run through their vehicle: `users -> driver_profiles.assigned_vehicle_id -> delivery_runs.vehicle_id`.

### Rules the backend enforces

- **Collecting a run:** only a run on your own vehicle, and only once the loader marked it `ready_to_depart`.
- **Proof of delivery:** needs a full or partial outcome first, plus a signature or a photo.
- **Not delivered:** needs a reason.
- **Finishing the trip:** every stop must be done.
- **Times:** each stop keeps the three times the brief's route data uses (p27): departed, arrived, left. Arrival is checked against the outlet's window (p15): early means wait for the window to open; arriving after it closes is late.
- **Repeats:** every write can be safely repeated. A record already applied answers "applied" again, so an offline record can never land twice.

## API (`/api/v1/driver`)

| Method and path | Purpose |
|---|---|
| `GET /me` | Signed-in driver, vehicle, depot |
| `GET /runs` | Your open trips (being loaded, ready, on the road, done in the last 18 h) |
| `GET /runs/{code}` | Run sheet before departure: stops, windows, docks, orders |
| `POST /runs/{code}/start` | Collect the run (gate-out). Repeating it returns the same trip |
| `GET /trips/{id}` | The trip with every stop |
| `PATCH /stops/{id}/arrive` | Arrival (keeps the tap time) |
| `PATCH /stops/{id}/outcome` | `delivered`, `partial` (units per order) or `failed` (reason) |
| `POST /stops/{id}/pod` | Proof of delivery; closes the stop |
| `POST /trips/{id}/complete`, `POST /trips/{id}/checkin` | Finish the trip; back at the depot |
| `POST /trips/{id}/issues`, `POST /sos` | Problem report; emergency alert |
| `POST /sync` | Records made offline, oldest first; each answered `applied`, `conflict` or `failed` |
| `POST /stops/{id}/resolve` | Answer a conflict: `keep_record` or `flag_review` |
| `GET` and `POST /ready-tomorrow` | Availability for the next operating day (Saturday's "tomorrow" is Monday) |
| `GET /monitor` | Dispatcher view: trips on the road, progress, open issues and SOS |
| `POST /dev/runs/{code}/stops/{n}/defer` | **Dev only** (not mounted in production): dispatch removes a stop after departure, to rehearse a conflict |

Errors use the shared envelope: `{"detail": {"code": "...", "message": "..."}}`.

## Working offline

Coverage drops in the hill country, the Kandy corridor and rural districts (brief p5). The phone keeps working:

- **Data** (`frontend/lib/driver/offline/`): IndexedDB keeps the last copy of each trip and run sheet, the run list, the profile, and an **outbox**.
- **Recording:** every record (arrival, outcome, proof, problem, SOS, check-in) is saved to the outbox with its own id and shown on screen at once.
- **Sending:** the outbox goes to `POST /sync` in order whenever there's signal, every 30 seconds while anything is waiting, and on "Sync now". Records keep the time they were made, not the time they synced.
- **Conflicts:** if dispatch removed a stop while the phone was offline, the server answers `409 STOP_REMOVED`. The **Sync queue** shows the conflict, and the conflict screen offers "Keep my delivery record" or "Flag for dispatcher review". Nothing is dropped without the driver's choice, and dispatch gets an issue either way.
- **App shell** (`frontend/public/driver-sw.js`, scope `/driver`): every driver page is cached, so the app opens without signal. Map tiles the driver has already looked at are cached too; there's no bulk download, per the OpenStreetMap tile policy. The service worker is off in `next dev` unless `NEXT_PUBLIC_DRIVER_SW=1`.
- **Starting a trip** needs a connection, because it happens at the depot. Everything after that works offline.

## The map

`outlets.csv` has no coordinates, so each outlet is pinned near its district's main town at a fixed offset derived from its code (`backend/app/services/geo.py`). Coastal districts keep their pins inland. The map labels the positions as approximate, and it shows the stop order rather than a road route. The phone's GPS position shows once the driver allows it.

## Setup and demo

- **Driver login.** `backend/scripts/seed_driver.py` adds a DRIVER user with a profile on the loader's demo vehicle (the first Peliyagoda reefer truck). It's insert-only and does a dry run unless `--yes` is passed. Writing to the shared Neon database needs the DB lead's OK.
  ```
  python scripts/seed_driver.py          # dry run
  python scripts/seed_driver.py --yes    # driver@waypoint.com / driver123
  ```
- **Migration `0006_driver_availability`.** It creates the table behind "Ready for tomorrow" and is **not applied yet**: per `docs/database-migrations.md`, the DB lead applies migrations to Neon. Until then that one feature answers "isn't set up on this database yet"; the rest of the driver app works.
- **Demo tools.** Set `NEXT_PUBLIC_DRIVER_DEMO_TOOLS=1` to show them on the driver's profile screen. They're on by default in `next dev`:
  - **Simulate no signal** behaves like a coverage drop, for showing offline work on a real phone.
  - **Rehearse a sync conflict:**
    1. Switch "Simulate no signal" on.
    2. Make dispatch remove a stop.
    3. Deliver that stop.
    4. Switch the signal back on. The conflict screen appears.

### Walkthrough (driver part)

1. **Release the run.** The loader finishes loading the demo run and marks it **Ready to depart**.
2. **Sign in** at `/driver/login`. The run shows as **Ready to collect**.
3. **Start the trip** from **Open run sheet**. The run leaves the loader's queue, the orders become *In transit* for the store with an ETA, and the dispatcher's run shows *en route*.
4. **Deliver the stops.** At each stop: **I've arrived**, then the outcome, then proof of delivery (recipient, signature, photo). The store sees *Arrived* and can confirm receipt.
5. **Finish.** **Finish trip**, then **I'm back at the depot**.

## Tests

`backend/tests/api/test_driver.py` (16 tests, in-memory SQLite). Run them with `pytest tests/api/test_driver.py` from `backend/`. They cover:
- the gate-out hand-off
- order statuses and store notifications
- full, partial and failed deliveries
- proof-of-delivery rules
- repeated syncs never applying twice, and the removed-stop conflict with both answers
- trip completion and check-in
- SOS
- availability over a weekend
- the dispatcher monitor
- the map positions

## Departures from the Designathon design

- **Real map with approximate pins** instead of an illustration. The outlet data has no coordinates, so the map says the positions are approximate.
- **Arrival is a tap**, not a geofence, for the same reason: there are no exact outlet positions to detect.
- **The trip overview is a static page** (`/driver/trip/overview?code=…`), so it opens offline.

## Open items for other teams

- **Store manager:** a failed delivery has no way out of `dispatched` in the order lifecycle (`order_service.TRANSITIONS`). A `dispatched -> deferred` move would let dispatch re-plan it with the store told. Also, `receipt_service.submit_receipt` sets `delivered`, but the contract says `completed`.
- **Dispatcher:** `GET /driver/monitor` and the `dispatch_trips` fields above are ready for the live-tracking screen.
- **DB lead:** apply `0006_driver_availability`.
