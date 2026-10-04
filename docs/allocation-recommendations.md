# Dispatcher allocation planning

The backend provides depot-scoped candidate groups, explainable vehicle recommendations, and atomic confirmation. Dispatcher Orders now uses these endpoints for both suggested groups and manual order selection. The legacy two-step allocation endpoints remain available to other clients, but they retain their previous checks and are not atomic; clients needing the new hard constraints must use `/allocations/confirm`.

## Data and setup

Apply Alembic revisions through `0019_route_plan_snapshots` (`cd backend; alembic upgrade head`). Revision 0018 adds verified weekly fuel balances and confirmed stop codes; 0019 stores the complete route calculation on allocations and dispatch trips. Copies of the official competition files from `data/General Data/` are committed at `backend/app/reference_data/service_allowance.csv` and `backend/app/reference_data/district_travel.csv` so the backend Docker image includes them. Their paths can be changed with `SERVICE_ALLOWANCE_CSV` and `DISTRICT_TRAVEL_CSV`.

Allocation uses the existing vehicle fields `km_per_l`, `weekly_fuel_quota_l`, and `weekly_fuel_status`. It does not query or require weekly fuel records. Unverified fuel usage displays `WARNING · Not verified` and does not block selection or confirmation; an explicit `Exceeded quota` status fails. Route fuel estimates use distance and fuel economy without inventing a remaining weekly balance. Missing driver assignments display `WARNING · Not assigned`; existing assigned drivers are copied automatically, and a missing driver can be assigned before dispatch/loading.

## API flow

1. `GET /api/v1/allocation-recommendations/groups?operating_date=YYYY-MM-DD` lists eligible unallocated, non-late order groups for the signed-in dispatcher's depot.
2. `POST /api/v1/allocation-recommendations` with `{"order_ids":[1,2],"departure_time":"2026-10-05T06:00:00+05:30"}` returns each depot vehicle's hard-constraint evidence, route summary, violation reasons, and a score only if eligible. Omitting `departure_time` is useful for early review, but leaves date and window checks unknown.
3. `POST /api/v1/allocations/confirm` with the same order IDs and departure plus `vehicle_id` and the selected recommendation's `route_fingerprint` locks the vehicle and orders, rechecks all constraints, writes the allocation, route snapshot and order links, and commits once. Failed checks return HTTP 422 with `detail.code=ALLOCATION_CONSTRAINT_FAILED` and `detail.violations`; changed routing inputs return `ALLOCATION_ROUTE_STALE`. No partial allocation is saved.

The recommendation is advisory. Confirmation rechecks against current data, so a vehicle or order changed by another dispatcher can no longer be confirmed from a stale recommendation.

## Planning rules

Groups share depot, brand, district, and operating date. Orders need an outlet, recorded positive weight and volume, and an ambient/chilled temperature class. The vehicle must be in the same depot, available, appropriately cooled, within both capacities and structured outlet access rules, and have fewer than **two trips** on that operating day. The official Task 2B checker sets cumulative daily trip-time budgets of **270 minutes for Fresh** and **480 minutes shared by Style/Tech**, using its per-order district travel and service formula. These limits remain hard checks. A loading dock must exist at the depot. Free-text delivery restrictions produce an unknown access result pending structured rules. API checks include `blocking` so clients can distinguish advisory warnings from checks that prevent allocation.

The official district reference supplies `depot_to_district_freeflow_min + inter_stop_freeflow_min × (number_of_orders - 1)` for travel time and `depot_to_district_km + inter_stop_km × (number_of_outlets - 1)` for distance. Service minutes are summed per order using `(brand, dock_type)` from `service_allowance.csv`. Outlet receiving hours, order delivery windows, and mall hours are intersected for each visit. Missing district, allowance, or window evidence still blocks confirmation. Exact outlet-to-outlet legs are not required.

The confirmed route snapshot, including ETAs and fuel, is copied into the dispatch trip and consumed by Loader. Recommendations and Delivery Runs share the deterministic internal router described in [Route planning](route-planning.md). Extra-order handling at the same outlet is included inside its receiving window. Exact roads and live traffic remain future provider work.
