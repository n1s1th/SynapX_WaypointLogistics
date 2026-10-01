# Run the loader demo

The whole loader against the real API on **local** Postgres: sign in, the
queue, the checklist, ticks, and the Log. It never touches Neon (see
[Seeding Neon](#seeding-neon) for the shared database).

**You need:** Python 3.11+, Node.js 20+, and PostgreSQL running on
`localhost:5432` with user `postgres` / password `postgres` (a local install, or
`docker compose up -d database` from the repo root). Windows PowerShell.

## Once, after cloning

```powershell
# Backend: settings and dependencies
cd backend
Copy-Item .env.example .env            # its DATABASE_URL is already localhost
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .

# Frontend: dependencies
cd ..\frontend
npm install
```

## Set up the demo data (and reset it any time)

```powershell
cd backend
.\scripts\loader_demo_up.ps1
```

It checks `backend/.env` points at this machine (it **refuses** Neon or any
remote database), points the session at local Postgres (`local_db.ps1`),
creates `waypoint_loader_dev` if it is missing, runs `alembic upgrade head`,
and seeds the Figma scenario with `seed_loader_demo.py --reset`.

If PowerShell blocks the script ("running scripts is disabled"), run it as
`powershell -ExecutionPolicy Bypass -File .\scripts\loader_demo_up.ps1`.

## Run it

Two terminals:

```powershell
# 1. Backend, from backend/
. .\scripts\local_db.ps1
.\.venv\Scripts\python.exe main.py

# 2. Frontend, from frontend/
$env:NEXT_PUBLIC_LOADER_TRANSPORT = "api"
npm run dev
```

Open <http://localhost:3000/loader/sign-in> and sign in as **Saman J.**,
PIN **4417**. The queue shows Dock 3's six runs; open **RUN-021** and tick an
order.

The other seeded loaders are Tharindu J. (2290) and Nimal S. (7735).

**Reset:** run `.\scripts\loader_demo_up.ps1` again.

**Without the backend:** leave `NEXT_PUBLIC_LOADER_TRANSPORT` unset and the
frontend uses its mock data instead.

## Seeding Neon

Everything above is local. To demo the loader against the **shared Neon
database**, `backend/scripts/seed_loader_neon.py` adds one run's worth of loader
data. Only Devmith runs it there.

It is **insert-only**: each row is looked up by its natural key first and
skipped if it is already there. It never updates, deletes or truncates, never
touches other teams' rows, and changes no schema. Running it twice changes
nothing, even after a demo has ticked, flagged and released the run.

What it adds for one operating day (`--date`, default today in depot time):

| Table | Rows |
|---|---|
| `docks`, `dock_tablets` | Dock 3 (Peliyagoda), "Dock tablet 3" |
| `loader_users` | Saman J. **4417**, Tharindu J. **2580**, Nimal S. **1357** (the PINs in `mock-data.ts`) |
| `orders` | `LDR-<MMDD>-01`…`08` on the run (a dry and a chilled order per stop), plus `LDR-<MMDD>-09`, deferred and not on the plan |
| `delivery_runs` and below | `LDR-RUN-<MMDD>`: Fresh, Gampaha, night wave, departs 03:30, four stops, plan v1 acknowledged, every order still to load |

It reuses the first Peliyagoda reefer truck in fleet (VEH014 on Neon) without
changing it; only if there is none does it add `LDR-VEH-01`. It reuses the
outlets OUT026, OUT027, OUT028, OUT030 and OUT031, and stops if any is missing
(outlets come from `seed_reference_data.py`). The `LDR-` orders carry a note,
"Loader demo order (scripts/seed_loader_neon.py)", so they are easy to find.

From `backend/`, with `backend/.env` pointing at Neon:

```powershell
# 1. Read-only: prints every row it would add, writes nothing
.\.venv\Scripts\python.exe scripts\seed_loader_neon.py --dry-run --i-know-this-is-neon

# 2. Add them
.\.venv\Scripts\python.exe scripts\seed_loader_neon.py --i-know-this-is-neon
```

Without `--i-know-this-is-neon` it refuses any non-local database. Add
`--date 2026-10-02` to seed a different operating day (a new run and new
orders; the dock, tablet and loaders are shared). For a daytime demo, the next
day's date gives a run that has not departed yet.

**The demo**, with the frontend in API mode against that backend: sign in as
Saman J. / 4417 and open `LDR-RUN-<MMDD>`. Tick orders, flag one (Missing).
Release stays locked until the dispatcher decides; with no dispatcher UI yet,
the dev endpoints stand in for them (`$API` is the backend's `/api/v1` URL,
`$ID` the flag's issue id):

```powershell
# Dispatcher decides the flag (applies the default option)
Invoke-RestMethod -Method Post "$API/loader/dev/issues/$ID/decide" -ContentType application/json -Body '{}'

# Dispatcher adds the deferred order: plan v2 for the loader to acknowledge
Invoke-RestMethod -Method Post "$API/loader/dev/runs/LDR-RUN-1002/plan-change" -ContentType application/json `
  -Body '{"load_new_order_numbers": ["LDR-1002-09"], "recheck_order_numbers": [], "summary": "OUT028 added to tonight''s run."}'
```

Then acknowledge v2, tick the new order and release. The dev endpoints exist
only when `LOADER_DEV_ENDPOINTS` is on and `ENVIRONMENT` is not `production`.
