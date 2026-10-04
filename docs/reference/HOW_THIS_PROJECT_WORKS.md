# Waypoint Logistics: How the Project Works

Last reviewed: 4 October 2026  
Audience: project owners, operators, and developers taking over the system.

## 1. What this system does

Waypoint Logistics is an operational platform for moving goods from a depot to retail outlets. It brings together ordering, depot planning, loading, delivery execution, proof of delivery, stock visibility, and exception handling.

The project has three main parts:

| Part | Technology | Responsibility |
| --- | --- | --- |
| `frontend/` | Next.js, React, TypeScript | Web and mobile-friendly workspaces for each operational role. |
| `backend/` | FastAPI, SQLAlchemy, Pydantic | API, business rules, authentication checks, and integrations. |
| PostgreSQL / Neon | PostgreSQL plus Alembic | Shared operational data and migration history. |

Supporting services are Keycloak for sign-in and roles, SMTP for operational alerts, and optional Cloudflare R2 storage for driver photos. Docker Compose can run a local PostgreSQL database plus the frontend and backend.

## 2. The end-to-end operational flow

```text
Store Manager creates goods request
        ↓
System applies delivery-date and cutoff rules
        ↓
Dispatcher reviews demand, inventory, fleet, and capacity
        ↓
Dispatcher assigns orders to a delivery run, vehicle, driver, and stop sequence
        ↓
Loader checks and loads the run in stop order; flags shortages or damage
        ↓
Run is released as ready to depart
        ↓
Driver performs the route, captures GPS/proof of delivery, and reports issues
        ↓
Store Manager confirms what arrived and raises any receiving issue
```

The key order lifecycle is:

```text
draft → submitted → confirmed / allocated → processing
      → ready_for_dispatch → dispatched → delivered → completed
```

`deferred` and `cancelled` are alternate outcomes. The backend rejects unsupported status changes rather than allowing screens to change the lifecycle freely.

## 3. Workspaces and who uses them

| Role | Main route | What they do | Important access scope |
| --- | --- | --- | --- |
| System Administrator | `/admin` | Manages users, roles, depots, outlets, vehicles, operational settings, and audit data. | All system data. |
| Dispatcher | `/dispatcher` | Plans orders, allocations, runs, routes, fleet, live tracking, forecasts, and exceptions. | Assigned depot; an admin can switch depot scope. |
| Loader | `/loader` | Works the dock queue, loading checklist, shortfalls, plan changes, release readiness, and offline sync. | Assigned operational/dock context. |
| Driver | `/driver` | Runs trips, handles arrival, proof of delivery, photos, signatures, SOS, and sync recovery. | Driver's own route/trip. |
| Store Manager | `/store` | Requests goods, sees stock and incoming deliveries, receives goods, sees history, and reports issues. | Assigned outlet only. |

The portal route (`/portal`) is the launch area. A user with more than one Keycloak role can move to each workspace they are entitled to use.

## 4. How sign-in and permissions work

### Primary sign-in: Keycloak SSO

The frontend sends users to Keycloak using the secure Authorization Code + PKCE flow. Once Keycloak returns an access token, the frontend stores the active session locally and sends it as a Bearer token to the API. The backend validates the token, maps its realm role to a local operational user, and creates a local shadow user the first time a valid Keycloak user signs in.

Required Keycloak realm roles are exactly:

```text
admin, dispatcher, driver, loader, store_manager
```

Role assignment alone is not enough for two roles:

- A dispatcher also needs a depot assignment (`peliyagoda` or `kandy`).
- A store manager also needs an outlet assignment.

Create and maintain live user accounts from the **Admin → Users** screen. The application creates/updates the Keycloak user, gives them the requested role, and keeps the PostgreSQL shadow record aligned. Password resets are also available there when the backend has Keycloak administration access.

### Development fallback

`KEYCLOAK_DEV_MODE=true` makes local API work easier: requests without a token use the first active local admin (or another active user). This is for development only. Set it to `false` outside a protected local environment.

### Legacy API login

The backend still exposes `POST /api/v1/auth/login` for a local email/password JWT. The current frontend does **not** use it; it uses Keycloak SSO. Treat it as a development/API compatibility path, not the normal production login.

## 5. Login and credential register

### Accounts that are safe to record

| Purpose | Username | Password | How it is created / changed |
| --- | --- | --- | --- |
| Seeded driver demo (legacy API only) | `driver@waypoint.com` | `driver123` | Run `backend/scripts/seed_driver.py`; change the values in that script only for a disposable local demo, or use Admin → Users for a real Keycloak account. |
| Local Docker PostgreSQL | `postgres` | `postgres` | Default only; change `DB_USER` and `DB_PASSWORD` in the root `.env` before first database creation. |

The Store Manager email/password pairs found in the older planning document are not generated by an active seed script, so they are **not guaranteed working accounts**. Do not rely on them. Create the actual users in Keycloak/Admin instead.

### Real credentials: where to change them later

Do not put real passwords, database URLs, SMTP app passwords, R2 keys, or Keycloak client secrets in this document or in Git. Keep them in the ignored `.env` files or a managed secret store.

| Credential/configuration | Editable location | Notes |
| --- | --- | --- |
| Frontend API address | `frontend/.env` → `NEXT_PUBLIC_API_URL` | Browser-visible value. Usually `http://localhost:5000` locally. |
| Keycloak server, realm, frontend client | `frontend/.env` → `NEXT_PUBLIC_KEYCLOAK_*` | These select the SSO tenant and public client. |
| Backend database login | `backend/.env` → `DATABASE_URL` | Application database connection. Use `DATABASE_URL_UNPOOLED` for Alembic against Neon when required. |
| Backend Keycloak client credential | `backend/.env` → `KEYCLOAK_CLIENT_*` | Required by the Admin user-management integration. Never expose `KEYCLOAK_CLIENT_SECRET` to the frontend. |
| Backend fallback JWT secret | `backend/.env` → `SECRET_KEY` | Required for the legacy local JWT route; use a strong, unique production value. |
| SMTP sender credentials | `backend/.env` → `EMAIL_*` | Used by the separate email worker. |
| Driver photo storage | `backend/.env` → `R2_*` | If blank, photos are stored locally under `backend/app/static/uploads`. |
| Docker database defaults/ports | root `.env` | Used by `docker-compose.yml` for local containers. |

Start from the committed templates: root [`.env.example`](../../.env.example), [`backend/.env.example`](../../backend/.env.example), and [`frontend/.env.example`](../../frontend/.env.example). Copy them to `.env` files and replace every placeholder before deployment.

## 6. Operational rules the system enforces

- All operating cutoffs use the **Asia/Colombo** timezone.
- A delivery must fall on an operating day in the calendar.
- The standard delivery date is at least two operating days ahead; high-priority requests can be next operating day, subject to the cutoff.
- Fresh outlets can have one chilled order and one ambient order for a delivery date. Style and Tech outlets can have one order per delivery date.
- An order containing chilled and ambient goods is split into separate temperature-zone orders at submission.
- A loader follows the dispatcher's stop sequence and must clearly distinguish temperature-controlled and ambient loads.
- Loader shortfalls, damage, or mismatches are recorded as issues; a dispatcher chooses a resolution or the documented default action applies at the decision deadline.
- Delivery confirmation/receipt closes the store side of the order after the driver has delivered it.
- Store managers cannot access another outlet, and non-admin dispatchers cannot operate outside their depot.

## 7. Data, APIs, and integrations

The FastAPI API is mounted at `/api/v1`; local interactive API documentation is normally at `http://localhost:5000/api/v1/docs`.

| API area | Purpose |
| --- | --- |
| `/auth` | Legacy API login, current user, and depot scope. |
| `/orders`, `/store`, `/notifications`, `/calendar` | Store requests, fulfillment lifecycle, notifications, and delivery-date rules. |
| `/inventory`, `/catalogue`, `/outlets` | Depot catalogue, stock, outlet directory, and store inventory. |
| `/allocations`, `/delivery-runs`, `/fleet`, `/tracking` | Dispatch plans, vehicles, assignments, and live route state. |
| `/loader` | Run queue, plans, checks, issue handling, readiness, activity, and offline-friendly loading flows. |
| `/driver`, `/issues`, `/operations`, `/api/receipts` | Mobile delivery flow, proof/issue capture, operational exceptions, and receiving records. |
| `/admin` | User administration, Keycloak sync, depot/outlet/fleet configuration, and audit data. |

The backend is layered deliberately:

```text
API endpoint → service/business rules → SQLAlchemy models → PostgreSQL
                  ↘ Pydantic schemas validate input/output
```

Keep business decisions in `backend/app/services/`, not in frontend components or router handlers.

## 8. Offline behavior and notifications

Loader and Driver views are designed for unreliable connectivity. They register service workers, cache operational data, queue actions/photos locally, and offer synchronization/recovery views when connection returns. Store Manager also has offline-related cleanup and defensive API rendering.

Operational email is optional and is queued in the same database transaction as the action that triggered it. To deliver it:

1. Configure `EMAIL_ENABLED=true` and the sender/SMTP values in `backend/.env`.
2. Ensure recipient email addresses and depot/outlet assignments are correct.
3. Run `python -m app.email.worker` as a separate long-running process.

The worker retries temporary failures and records delivery status in `email_outbox`.

## 9. Local setup and start-up

### Recommended local development setup

1. Create root, backend, and frontend `.env` files from their matching `.env.example` templates.
2. Start PostgreSQL either through Docker Compose or a local PostgreSQL server.
3. From `backend/`, install Python dependencies and run the API on port 5000.
4. From `frontend/`, install Node dependencies and run the Next.js app on port 3000.
5. Open `http://localhost:3000` and use Keycloak, or use development fallback only in a non-production local environment.

Useful commands:

```powershell
# Backend
cd backend
uv pip install -e ".[dev]"
uvicorn app.main:app --reload --port 5000

# Frontend, in a second terminal
cd frontend
npm install
npm run dev

# Optional local containers from the repository root
docker compose up --build
```

### Database migrations

Database schema changes use Alembic. Do not rely on application startup to create tables. The shared Neon database has a controlled migration process: only the DB lead should apply migrations to shared environments.

## 10. Where to safely change common things

| Change | Preferred place |
| --- | --- |
| Add/disable user, reset password, assign role | Admin → Users (with backend Keycloak client secret configured). |
| Assign dispatcher to depot | Admin → Users / depot assignment. |
| Assign store manager to outlet | Admin → Users / outlet management. |
| Add or update outlet, vehicle, catalogue, calendar configuration | Admin workspace; use its CSV imports/exports where available. |
| Change the default dispatcher depot in local development | `backend/.env` → `DISPATCHER_DEFAULT_DEPOT`. |
| Change application URLs/ports | Root `.env`, `frontend/.env`, and `backend/.env`; keep CORS origins in sync. |
| Change the default store demo/API behavior | `frontend/.env` → `NEXT_PUBLIC_STORE_DATA_SOURCE` and `NEXT_PUBLIC_STORE_OUTLET_ID`. |
| Change loader transport mode | `frontend/.env` → `NEXT_PUBLIC_LOADER_TRANSPORT=api` for the real loader API; leave unset for built-in mock data. |
| Change the Keycloak login page appearance | `keycloak-theme/waypoint/`; rebuild the theme JAR with the supplied PowerShell script. |

## 11. Repository map

```text
frontend/
  app/                 Routes and role screens
  components/          Shared UI plus admin, dispatcher, driver, loader, and store features
  lib/                 Authentication, API client, offline queues, GPS, and session helpers

backend/
  app/api/v1/          HTTP endpoints by business area
  app/services/        Business rules and workflow logic
  app/models/          Database models
  app/schemas/         Request/response validation
  app/email/           Email configuration, outbox service, and worker
  alembic/             Versioned database migrations
  scripts/             Local/demo data seed helpers

docs/                  Feature contracts, data-model notes, migrations, and this handover
keycloak-theme/        Custom Keycloak login appearance
database/              Local database initialization resources
```

## 12. Before releasing to production

- Set `KEYCLOAK_DEV_MODE=false`.
- Replace every example/default password, JWT secret, database login, client secret, SMTP credential, and R2 credential.
- Restrict `BACKEND_CORS_ORIGINS` to the real frontend origin(s).
- Confirm Keycloak redirect URLs, logout URLs, realm roles, and client settings.
- Run all database migrations through the approved release process.
- Configure a durable photo-storage provider (R2) and run the email worker where needed.
- Test one complete flow for each role: order → dispatch → load → drive → receive.
- Verify logout, expired-session handling, role restriction, depot restriction, and outlet restriction.

## 13. Important project notes

- Existing uncommitted work was present when this document was written; this document does not alter or replace it.
- The repository contains a mix of active implementation and historical planning notes. The source code, API documentation, and current environment templates take priority when there is a disagreement.
- Never commit `.env` files or paste live credentials into an issue, chat, or repository document.
