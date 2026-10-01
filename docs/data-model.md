# Data Model Documentation

## Delivery Receipts (`delivery_receipts`)

Migration `0005_delivery_receipts`. Depot loading and shortfalls are not tracked here: they live in the loader module (`run_stop_orders`, `loading_checks`, `loader_issues`).

Outlet-side confirmation of what was delivered, submitted by the store manager. One receipt per order (enforced by unique constraint on order_id). May be submitted offline and synced later.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK | Auto-increment |
| order_id | INTEGER | FK → orders.id, unique, indexed | One receipt per order |
| outlet_id | INTEGER | FK → outlets.id, not null | Outlet confirming receipt |
| units_received | INTEGER | nullable | Actual units received at the outlet |
| weight_received_kg | DECIMAL(10,2) | nullable | Actual weight received |
| has_issues | BOOLEAN | not null, default false | Whether the store manager flagged an issue |
| issue_type | VARCHAR(30) | nullable | short_delivery / damaged / wrong_items / other |
| issue_description | TEXT | nullable | Free text description of the issue |
| confirmed_at | TIMESTAMP | nullable | When the manager confirmed receipt |
| synced_from_offline | BOOLEAN | not null, default false | True if submitted via the offline sync batch |
| created_at | TIMESTAMP | not null | Row creation timestamp |
