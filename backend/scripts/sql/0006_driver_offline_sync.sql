-- Driver offline sync schema (same as migration 0006_driver_offline_sync).
--
-- Run as the table owner (neondb_owner) — e.g. paste into the Neon console
-- SQL Editor. The app role (waypoint_app) is not allowed to ALTER these tables.
--
-- Additive and idempotent: safe to run more than once, touches no existing
-- rows, and does NOT change alembic_version (the shared DB is stamped with
-- another branch's 0006 revision; the team merges migration heads separately,
-- and migration 0006_driver_offline_sync skips whatever already exists).

BEGIN;

CREATE TABLE IF NOT EXISTS driver_sync_events (
	id SERIAL NOT NULL,
	client_action_id VARCHAR(64) NOT NULL,
	driver_id INTEGER NOT NULL,
	action_type VARCHAR(32) NOT NULL,
	trip_id INTEGER,
	stop_id INTEGER,
	status VARCHAR(16) NOT NULL,
	code VARCHAR(64),
	message VARCHAR(500),
	result JSON,
	payload_summary JSON,
	client_timestamp TIMESTAMP WITHOUT TIME ZONE,
	received_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
	reviewed_at TIMESTAMP WITHOUT TIME ZONE,
	reviewed_by_id INTEGER,
	review_note VARCHAR(500),
	PRIMARY KEY (id),
	CONSTRAINT fk_driver_sync_events_driver_id_users FOREIGN KEY (driver_id) REFERENCES users (id),
	CONSTRAINT fk_driver_sync_events_reviewed_by_id_users FOREIGN KEY (reviewed_by_id) REFERENCES users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_driver_sync_events_client_action_id ON driver_sync_events (client_action_id);
CREATE INDEX IF NOT EXISTS ix_driver_sync_events_driver_id ON driver_sync_events (driver_id);
CREATE INDEX IF NOT EXISTS ix_driver_sync_events_id ON driver_sync_events (id);
CREATE INDEX IF NOT EXISTS ix_driver_sync_events_trip_id ON driver_sync_events (trip_id);

ALTER TABLE delivery_stops ADD COLUMN IF NOT EXISTS outcome_reason VARCHAR(255);
ALTER TABLE proof_of_delivery ADD COLUMN IF NOT EXISTS delivered_items JSON;
ALTER TABLE proof_of_delivery ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITHOUT TIME ZONE;

-- The app connects as waypoint_app; give it the same access it has on the other tables
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON driver_sync_events TO waypoint_app;
GRANT USAGE, SELECT ON SEQUENCE driver_sync_events_id_seq TO waypoint_app;

COMMIT;
