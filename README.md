# Waypoint Logistics

Waypoint Logistics is a role-based operations platform for planning and fulfilling deliveries across Waypoint Group. It supports the full journey from a store's goods request to depot allocation, loading, driver delivery, and receiving confirmation.

## What it supports

- Store goods requests, stock visibility, delivery tracking, receiving, and issue reporting
- Depot inventory, catalogue, outlets, vehicles, delivery runs, and allocations
- Dispatcher planning, route sequencing, fleet management, exceptions, and live tracking
- Loader loading checklists, plan changes, shortfall reporting, and offline sync
- Driver trip execution, GPS, proof of delivery, photos, signatures, SOS, and offline recovery
- Keycloak single sign-on, role-based access, operational email alerts, and audit records

## Workspaces

| Role | Route | Main responsibility |
| --- | --- | --- |
| System Administrator | `/admin` | Users, roles, depots, outlets, fleet, settings, and audits |
| Dispatcher | `/dispatcher` | Plans, allocations, delivery runs, fleet, and exceptions |
| Loader | `/loader` | Dock queue, load checks, issues, and release readiness |
| Driver | `/driver` | Trip execution, proof of delivery, and delivery issues |
| Store Manager | `/store` | Goods requests, deliveries, receipts, stock, and notifications |

## Architecture

```text
Next.js frontend (frontend/)
        ↕
FastAPI API (backend/)
        ↕
PostgreSQL / Neon database

Keycloak → authentication and roles
SMTP     → operational email outbox worker
R2       → optional driver-photo storage
```

## Quick start

### 1. Configure the Environment (`.env`)

A single consolidated `.env` file at the root of the project configures both the backend and frontend services (database connection, Keycloak SSO, Cloudflare R2 photo storage, and operational alerts).

If you are cloning freshly, initialize the `.env` from the provided example template:

```powershell
Copy-Item .env.example .env
```
*(On Linux/macOS: `cp .env.example .env`)*

Review the `.env` file to ensure the `DATABASE_URL` matches your Neon PostgreSQL database instance.

---

### 2. Run with Docker (Recommended)

Run the entire application in one command:

```powershell
docker compose up --build
```

Docker will:
1. Automatically connect to your cloud **Neon PostgreSQL** database.
2. Run database migrations via Alembic.
3. Start the FastAPI backend and verify its health.
4. Launch the Next.js frontend once the backend is ready.

#### Access Points:
- **Frontend App**: [http://localhost:3000](http://localhost:3000)
- **Backend API Docs (Swagger)**: [http://localhost:5000/api/v1/docs](http://localhost:5000/api/v1/docs)
- **API Health Check**: [http://localhost:5000/api/v1/health](http://localhost:5000/api/v1/health)

*(Optional: If you ever want to run an offline local PostgreSQL container instead of Neon, run `docker compose --profile local-db up`)*

---

### 3. Alternative: Run Locally Without Docker

If you prefer running services directly on your host machine:

#### Backend:
```powershell
cd backend
uv pip install -e ".[dev]"
uvicorn app.main:app --reload --port 5000
```

#### Frontend:
```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Login and access

The main application login uses **Keycloak SSO** (connected to `https://auth.tenderease.me`). Create real users, assign their roles, and reset passwords through **Admin → Users** when the backend Keycloak client secret is configured.

Supported roles are:

```text
admin, dispatcher, driver, loader, store_manager
```

Dispatchers also require a depot assignment; Store Managers require an outlet assignment.

For a disposable local legacy-API demo, run `backend/scripts/seed_driver.py`. It creates:

```text
driver@waypoint.com / driver123
```

The current frontend signs in through Keycloak, so this seeded account is intended for local API/testing use rather than production SSO.

Never commit live `.env` files or credentials into public repositories.

## Configuration Reference

All settings can be configured centrally in the root `.env`:

| Key | Description | Default |
| --- | --- | --- |
| `FRONTEND_PORT` | Port exposed by Next.js | `3000` |
| `BACKEND_PORT` | Port exposed by FastAPI | `5000` |
| `DATABASE_URL` | Neon PostgreSQL pooled connection | Neon connection string |
| `DATABASE_URL_UNPOOLED` | Neon PostgreSQL direct connection for migrations | Neon unpooled connection |
| `KEYCLOAK_URL` | Keycloak Identity Provider | `https://auth.tenderease.me` |
| `KEYCLOAK_REALM` | Keycloak Realm | `waypointlogistics` |
| `NEXT_PUBLIC_STORE_DATA_SOURCE` | Store Manager data mode (`api` or `mock`) | `api` |
| `R2_*` | Cloudflare R2 credentials for photo proof of delivery | Configured in root `.env` |
| `EMAIL_*` | SMTP credentials for dispatch notifications | Configured in root `.env` |

## Project structure

```text
frontend/          Next.js role workspaces and offline-capable UI
backend/           FastAPI API, business logic, models, and migrations
docs/              Feature contracts, data model, operational documentation
database/          Local database initialization resources
keycloak-theme/    Custom Keycloak login theme
```

## Documentation

- [How the complete system works](docs/reference/HOW_THIS_PROJECT_WORKS.md)
- [Backend API and local development](backend/README.md)
- [Store Manager contract](docs/reference/store-manager-contract.md)
- [Loader documentation](docs/reference/loader/)

## Production checklist

- Disable `KEYCLOAK_DEV_MODE`.
- Replace all default credentials and secrets.
- Limit backend CORS origins to approved frontend URLs.
- Verify Keycloak realm roles, clients, redirect URLs, and logout URLs.
- Apply migrations through the release process.
- Configure durable photo storage and the email worker when needed.
- Test each role's complete operational journey.
