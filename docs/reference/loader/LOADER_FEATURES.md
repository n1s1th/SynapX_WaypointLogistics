# Loader Module — Feature Breakdown (Sachintha & Sanduni)

Figma: `High-Fidelity-Designs` → page **02 — Loader** (https://www.figma.com/design/Auh46U8b9rsTI4XKBwoqpy/High-Fidelity-Designs?node-id=243-3570). Frame numbers below match the Figma frame names; open them through the Figma connection in Claude Code for the UI details.

Each person owns whole features (backend + frontend), so you don't edit the same files.

## Tech stack

| Layer | Tech |
| --- | --- |
| App type | Progressive Web App (installable on the dock tablet) |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS, shadcn/ui (`components/ui`), lucide-react icons, Inter font |
| Backend | FastAPI, Python 3.11, SQLAlchemy 2, Pydantic 2, Alembic, pytest |
| Database | PostgreSQL on Neon (shared dev database) |
| Auth | Keycloak (realm `waypointlogistics`), dev-mode fallback |
| PWA (proposed, agree with team) | Next.js `app/manifest.ts`, a service worker in `public/sw.js`, IndexedDB for the offline action queue, Web Push (`web-push` style VAPID keys; `pywebpush` on the backend) |
| Tooling | Git + GitHub PR flow, Graphify, Figma connected to Claude Code |

## Feature split

| # | Feature | Figma frames | Owner |
| --- | --- | --- | --- |
| L0 | Data foundation, seed data, loader API skeleton | — | **Sachintha** |
| L1 | App shell & shared loader components | Loader components section | **Sanduni** |
| L2 | Sign-in (who's loading + PIN) | 00, 1a.1, 1a.2 | **Sanduni** |
| L3 | Loading queue | 1b, 1b.1, 7, 13, 19, T1b | **Sanduni** |
| L4 | Loading checklist | 1c, 1c.1, 9, 10, 16 | **Sachintha** |
| L5 | Flag an issue + Issues tab | 1d, 1d.1, 3·f, 3·f2, T1d, T1d.1 | **Sanduni** |
| L6 | Confirm & release + Ready to depart | 1e, 1f, 11, 12, 17, 18, T1e, T1f | **Sanduni** |
| L7 | Plan changed mid-load / after Ready | 2a, 2b, 2c, 2d, T2a, T2b, T2d | **Sachintha** |
| L8 | Waiting on Dispatcher decision | 3a, 3b, 3c, T3b | **Sachintha** |
| L9 | Activity log | Log tab, 2c item 5 | **Sachintha** |
| PWA-0 | PWA base (manifest, icons, service worker, install) — shared by all roles | — | **Team** (agree who, merge once into `dev`) |

## What each feature covers

**L0 — Data foundation (Sachintha)**
- Models: dock/tablet, loader user (PIN), vehicle, outlet (dock type, van_only, window), run (plan version, status), run stop (sequence, ETA), order fields (chilled/ambient, units, kg, m³), loading check, loader issue, plan revision, loader activity.
- Migration, seed script for the Figma scenario (from vehicles.csv, outlets.csv, calendar.csv), `/loader` router + service.
- Dev-only endpoints to simulate a dispatcher plan change and decision.

**L1 — App shell & shared components (Sanduni)**
- Layout: app bar, plan source strip, bottom nav (Queue · Loading · Issues · Log · More), mobile + tablet.
- Reusable components in `components/loader/` (order row with all states, stop header, capacity card, cab-to-door diagram, badges, pills, chips, buttons, tracker step, decision option, PIN key, search input).
- Built with mock data first.
- **PWA (loader side):** installable loader start page (`/loader`), cache the app shell and the open run for offline use, queue checks and flags in IndexedDB when offline and sync on reconnect, online / pending-sync indicator in the source strip.

**L2 — Sign-in (Sanduni)**
- Name search, PIN pad, wrong PIN, "Not you?", idle sign-out, Switch-user flow.
- `GET /loader/users`, `POST /loader/session`.

**L3 — Loading queue (Sanduni)**
- Runs for the dock by departure, metrics, brand filters, run cards with status, progress and alerts.
- `GET /loader/runs`, `GET /loader/summary`.

**L4 — Loading checklist (Sachintha)**
- Stops in reverse load order, check/uncheck per order, live capacity, cab-to-door diagram, review button locked until all checked or flagged.
- `GET /loader/runs/{id}`, `POST/DELETE …/orders/{order_id}/check`.

**L5 — Flag an issue + Issues tab (Sanduni)**
- Missing / Short / Damaged / Won't fit, units, quick notes, photo, send to Dispatcher; flagged row; Issues list.
- `POST /loader/issues`, `GET /loader/issues`, photo upload.

**L6 — Confirm & release + Ready to depart (Sanduni)**
- Final load, issues + answers, driver unload order, handover, mark ready (10 s undo), success screen.
- `GET /loader/runs/{id}/release-summary`, `POST …/release`, `POST …/release/undo`.

**L7 — Plan changes (Sachintha)**
- Detect new plan version, blocking diff + acknowledge, pinned unload task, re-checks, release lock, reopen after Ready, no action after gate-out.
- `GET …/plan/diff`, `POST …/plan/{version}/acknowledge`, `POST …/orders/{order_id}/unload`.
- **PWA:** web push when the plan changes (bell + notification even if the tablet is on another screen); push subscription endpoint `POST /loader/push/subscribe`.

**L8 — Waiting on Dispatcher decision (Sachintha)**
- Waiting card with tracker, decide-by countdown, decision screen, default applied on timeout, flag resolved → release unlocked.
- `GET /loader/issues/{id}`, decision endpoint from dispatcher, scheduler for defaults.
- **PWA:** web push + chime when the decision arrives or the default is applied.
- **Offline sync (backend):** make check, flag and acknowledge endpoints safe to retry (client-generated action ID), so queued offline actions are never saved twice.

**L9 — Activity log (Sachintha)**
- Log tab timeline and the activity feed the Dispatcher sees.
- `GET /loader/runs/{id}/activity`.

## Order of work

| Phase | Sachintha | Sanduni |
| --- | --- | --- |
| 1 | L0 | L1 (mock data) |
| 2 | L4 | L2, L3 |
| 3 | L7 | L5 |
| 4 | L8, L9 | L6 |
| 5 | Both: test the full story flow on mobile and tablet → PR `loader` → `dev` | |

- Merge L0 and L1 first. One feature = one PR into `loader`.
- PWA-0 should land in `dev` during phase 1–2 so L1's offline shell and L7/L8's push notifications can build on it.
- Hand-offs: L3 shows plan-change and flag alerts from L7/L8; L4's flag button opens L5; L6's lock states come from L7/L8. Agree API response shapes in phase 1.

## Agree before starting

- **Sign-in:** name + PIN (Figma) vs Keycloak (repo setup).
- **PWA base:** who builds the manifest + service worker once for all roles, which PWA approach/library to use, and VAPID keys for push.
- **Dispatcher team:** run/stop/plan-version models, how plan changes and decisions reach the loader, exceptions queue for flags.
- **Driver team:** what "Ready to depart" hands over.
- **Not designed yet:** Issues tab list, Log tab, More tab, bell notifications.

## Rules for Claude Code (both of us)

- Read the three files in `docs/reference/loader/` before starting any task.
- Plan first; show the plan and wait for OK before changing code.
- Only touch your own features (table above). Ask before editing the other person's files.
- UI: use the Figma connection (page "02 — Loader") and follow `frontend/AGENTS.md`; loader touch targets are 48 px; shared loader components live in `frontend/components/loader/`.
- Backend: endpoint → service → model/schema; add tests.
- `backend/.env` points at the **shared Neon database** — never run migrations, seed scripts or deletes against it without asking. Use a local Postgres for development.
- Migrations: the DB lead (Devmith) owns migrations; that overrides anything in `docs/reference/loader/` about migrations. In short: only Devmith runs `alembic upgrade`/`downgrade` on Neon; never edit a migration already on `dev`, write a new one; one model per table and one alembic head; no `Base.metadata.create_all()`, tables come from migrations only.
- Don't change shared models (`Order`, `DispatchTrip`, `Shipment`) without flagging it first.
- Use `graphify query "<question>"` to find code before grepping.
- Small commits: `type(loader): description`. Never commit env files, `.venv/`, `node_modules/`, `graphify-out/`, `.gitattributes`.
