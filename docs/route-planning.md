# Internal route planning

`RoutePlanningService` adapts orders, outlet windows/access, service allowances and vehicle fuel efficiency into a provider-independent `RoutePlanRequest`. `InternalRouteProvider` is the default and requires no API key or external routing service. Its `RoutePlan` result is used by recommendations, constraint review, atomic confirmation, Delivery Runs and Loader.

## Algorithm and validation

1. Intersect receiving windows for the Colombo operating date with outlet, order and mall restrictions. Sum the CSV service allowance per order. Additional orders at one outlet add the challenge's inter-stop handling allowance, inside the window, without adding kilometres.
2. Construct a deterministic sequence. Rank feasible next stops ahead of infeasible ones; use one-step lookahead to avoid making other windows impossible, prioritize tight closing-window margins, then compare incremental travel, waiting and service time. Window end and outlet code break ties.
3. Make at most two passes of strictly improving adjacent swaps. Compare failed windows, at-risk windows, elapsed time including waiting, then distance. Delivery Run preview retains the current sequence if it scores better than the heuristic proposal.
4. Independently evaluate the selected sequence, including every manual movement: accumulate each travel leg, wait until opening when early, add service and handling, and require completion by the window's end. `AT_RISK` means 0–10 minutes of completion margin and remains feasible. Missing evidence and missed windows produce `FAIL`; access failures/unknown rules block the route too.
5. Calculate estimated fuel once as route distance / vehicle km per litre. Allocation fuel quota validation consumes this result.

The sequence search is a heuristic, not a proof of a globally optimal route or of global infeasibility. Hard validation is deterministic for the chosen sequence and supplied estimates; it does not guarantee real-world arrival times. No frontend sorting or locally fabricated SLA recovery remains.

District references provide depot-to-district travel and equal average inter-stop costs within that district. Same-district reordering therefore often changes window compliance and waiting but saves **zero kilometres**. Unsupported cross-district legs and missing CSV rows are unknown; no geographic proximity is inferred from outlet names. Estimates end after handling at the final outlet and exclude a return-to-depot leg.

## Storage and API

Run `alembic upgrade head` in `backend` to apply `0019_route_plan_snapshots` before starting this version against an existing database. No external provider configuration is required.

- Recommendation responses include arrivals, service start, window start/end, service/handling minutes, departure, PASS/AT_RISK/FAIL, duration with and without waiting, distance, fuel, warnings, source and stable fingerprints.
- Atomic confirmation optionally checks the recommendation's `route_fingerprint` (the Orders UI always sends it) and persists the complete snapshot plus stop codes.
- Creating a Delivery Run copies the snapshot. Changed inputs since confirmation produce `409 ALLOCATION_ROUTE_STALE` instead of silently changing the sequence or ETAs.
- `POST /delivery-runs/{id}/route-preview` accepts `{}` for an optimized proposal or `{"stop_order":["OUT031","OUT014"]}` to evaluate a manual sequence. Every active outlet must occur exactly once. The response contains current/proposed results, the Loader base version and the current route fingerprint.
- `POST /delivery-runs/{id}/plan` receives the existing `plan` payload and the proposed `route_fingerprint`. It calls `loader_service.publish_dispatcher_plan`, revalidates the route and saves timing in the same transaction. Failure rolls back both plans. A changed version remains `PLAN_VERSION_STALE`; changed inputs are `ROUTE_STALE`. Replays retain existing Loader behavior.
- The Loader-side dispatcher plan endpoint also validates route/departure changes and updates timing. PATCH of a Delivery Run cannot bypass route validation.

Invalid and unknown routes cannot be applied; there is no override. Window margin warnings may be accepted explicitly with Apply Optimized Route. Loader stop order, reversed load positions, rechecks after resequencing, plan versions, acknowledgement and gate-out locks remain owned by LoaderService. Departure-only changes retain the existing no-new-version behavior.

## Verified API scenario

`tests/api/test_route_planning.py::test_complete_order_allocation_dispatch_loader_trace` uses the actual API and an isolated SQLite database with recorded fuel, fleet, dock, outlet and order data:

1. Two unallocated Fresh / Colombo orders appear in one suggested group.
2. Peliyagoda departure is 2026-10-05 06:00 Colombo. Vehicle `ALLOC-VEH` is recommended with all constraints passing.
3. Backend route: `ZZ-URGENT` arrives 06:24 and completes at 06:39; `ALLOC-OUT` arrives 06:47, waits until 07:00 and completes at 07:15. Estimated distance is 16 km; travel plus handling is 62 minutes, total elapsed 75 minutes, fuel 3.2 L at 5 km/L.
4. Atomic confirmation stores that exact result. After the allocation becomes READY, dispatch copies it into the Delivery Run.
5. Loader plan v1 retains the same stop sequence and UTC equivalents of the ETAs; load positions are 2 then 1. Acknowledgement is required.

A second endpoint scenario starts with the old, window-infeasible reverse sequence, previews the optimized result, publishes v2 and verifies reversed loading positions and pending acknowledgement. Manual reversal fails and leaves both v2 and the dispatch route unchanged. Stale versions, changed inputs and gate-out are covered separately.

## Remaining work

- Exact outlet road legs, cross-district routing, return trips, traffic and travel uncertainty need a richer travel provider. Only the internal provider is implemented.
- Route search is bounded greedy/local improvement; a solver could find feasible sequences that this heuristic misses.
- Ten minutes is a fixed risk threshold; it is not a statistical SLA probability.
- An allocation whose routing inputs change after confirmation currently needs to be replanned; there is no dedicated UI to review and replace its confirmed snapshot before dispatch.
- Legacy Loader-only runs without a dispatch route snapshot retain their existing stop fallback until explicitly planned. Operational issue-resolution mutations outside the Dispatcher route endpoints still use the existing Loader workflow.
- The frontend currently has no configured test runner. Build and scoped lint verify types/static rules; the API integration suite covers the complete route lifecycle. Browser interaction automation remains to be added.

## Files changed for this routing step

Backend:

- `alembic/versions/0019_route_plan_snapshots.py`
- `app/api/v1/endpoints/allocations.py`, `dispatch.py`, `loader.py`
- `app/models/allocation.py`, `shipment.py`
- `app/schemas/allocation.py`, `allocation_recommendation.py`, `shipment.py`
- `app/services/route_planning.py`, `dispatch_route_planning.py`
- `app/services/allocation_confirmation.py`, `allocation_constraints.py`, `allocation_recommendations.py`, `loader_service.py`
- `tests/unit/test_route_planning.py`
- `tests/api/test_route_planning.py`, `test_dispatch_loader_sync.py`, `test_loader_integration_endpoints.py`

Frontend:

- `components/dispatcher/RouteOptimizationDialog.tsx`, `RoutePlanDetails.tsx`
- `components/dispatcher/orders/ConstraintReviewModal.tsx`, `QuickAllocationDrawer.tsx`
- `lib/route-planning-api.ts`, `allocation-api.ts`
- `types/allocation.ts`

Documentation: `docs/route-planning.md`, `docs/allocation-recommendations.md`.

## Verification results

- Full backend suite: **516 passed, 2 failed**. Remaining failures are `test_assigned_dispatcher_cannot_change_depot_with_header` (existing depot authorization behavior) and `test_dispatcher_run_moves_store_orders_on_the_way_then_delivered` (fixture tries to publish an allocated trip without the dock run required by the existing guard).
- Focused route/allocation/Loader suite: **120 passed**.
- Frontend production build and lint of all files changed in this step pass. Full frontend lint still reports existing errors in Driver/Store screens, other Dispatcher components, auth/sync utilities and the bundled map script.
- No frontend test runner/script is configured; browser interaction tests were not run.
- A standalone 100-stop internal-provider calculation took about **1.2 seconds** in this workspace. Recommendation construction is shared across vehicle candidates, then each candidate evaluates that same sequence.

Backend tests ran with `DEBUG=false` because the execution environment's `DEBUG=release` value is not a valid boolean. Tests used their configured isolated SQLite database; the application's real database and migration state were not changed.
