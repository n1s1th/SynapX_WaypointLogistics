# Waypoint Logistics - Backend

FastAPI-powered backend service for Waypoint Logistics, managing order planning, warehouse inventory, dispatch operations, and shipment tracking.

## Architecture

```text
backend/
├── app/
│   ├── api/
│   │   ├── deps.py               # Dependency injection (Auth, DB session)
│   │   └── v1/
│   │       ├── api.py            # API router aggregator
│   │       └── endpoints/        # Domain endpoints (auth, orders, inventory, dispatch, tracking)
│   ├── core/
│   │   ├── config.py             # Application settings & environment vars
│   │   ├── database.py           # SQLAlchemy engine & session maker
│   │   └── security.py           # JWT & password hashing utilities
│   ├── crud/
│   │   └── base.py               # Reusable generic CRUD operations
│   ├── models/                   # SQLAlchemy ORM models
│   ├── schemas/                  # Pydantic schemas (validation & serialization)
│   ├── services/                 # Business logic layer
│   └── main.py                   # FastAPI initialization & middleware
├── tests/
│   ├── conftest.py               # Pytest fixtures & TestClient
│   ├── api/                      # Integration and endpoint tests
│   └── unit/                     # Unit tests
├── Dockerfile                    # Container configuration
├── main.py                       # Local entrypoint (uvicorn runner)
└── pyproject.toml                # Dependencies & package metadata
```

## Getting Started

Dispatcher allocation recommendations, reference data, fuel-input requirements, and atomic confirmation are documented in [allocation-recommendations.md](../docs/allocation-recommendations.md).

### Local Setup with UV or Pip

```bash
# 1. Install dependencies
pip install -e .

# Or with uv
uv pip install -e .

# 2. Run local development server
python main.py
# or: uvicorn app.main:app --reload --port 5000
```

### Interactive Documentation

Once the server is running, explore the interactive OpenAPI documentation:
- Swagger UI: `http://localhost:5000/api/v1/docs`
- ReDoc: `http://localhost:5000/api/v1/redoc`

### Running Tests

```bash
pytest
```

## Operational email

The backend uses one application SMTP account as the sender. Users do not need separate SMTP credentials. It queues email in `email_outbox` in the same database transaction as the related action, and a separate worker delivers it. Driver SOS, loader issues awaiting dispatcher decisions, and driver issues go to the active dispatcher assigned to the relevant depot. Store deferrals and partial allocations go to the active user assigned to the outlet, then the active store manager who placed the order, then an outlet manager contact. The store's `email_alerts_issues` preference controls those store messages. Assign outlet managers by user ID so two people with the same name cannot be confused. Set real email addresses on user or outlet contact records before enabling delivery. Messages with no recipient are logged and skipped; messages are not queued while `EMAIL_ENABLED=false`.

1. Apply migrations with `alembic upgrade head` before enabling email. Migration `0012_outlet_manager_user` adds the saved outlet manager user ID. Reassign existing managers by user ID to link existing name-only records.
2. Set `EMAIL_ENABLED=true`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, and any required `EMAIL_SMTP_USERNAME` / `EMAIL_SMTP_PASSWORD` in `backend/.env`. Existing `EMAIL_USER` and `EMAIL_APP_PASSWORD` values are also accepted; when `EMAIL_USER` is a Gmail address, the module selects `smtp.gmail.com:587` with STARTTLS by default. Explicit SMTP settings take precedence. Use `EMAIL_SMTP_SSL=true` for an implicit TLS server.
3. Run `python -m app.email.worker` as a separate long-running process. `--once` processes one batch for a scheduled job; `--interval` controls continuous polling (default 10 seconds).

The worker retries temporary failures with increasing delays and marks a message `failed` after eight attempts. Inspect application logs for missing recipients and `email_outbox` for failures and send status. Each operational event has a stable event key, so replayed loader actions do not enqueue another message. As with any SMTP outbox, a process crash after SMTP accepts a message but before the database records success can result in a duplicate delivery.

For an SMTP-only check, `python -m app.email.smoke` previews five sample subjects and `python -m app.email.smoke --send` sends them to `EMAIL_USER`. These messages are labeled `[TEST]` and do not create operational records or exercise the outbox. Use the automated tests to verify the event hooks; use a real sandbox event after deployment to verify the complete flow.
