CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{2,62}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    schema_version text NOT NULL,
    event_type text NOT NULL,
    source text NOT NULL CHECK (source IN ('DEVICE', 'API', 'AGENT', 'SIMULATOR', 'PEER')),
    classification text NOT NULL CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (tenant_id, event_id),
    UNIQUE (tenant_id, sequence)
);

CREATE TABLE IF NOT EXISTS event_outbox (
    tenant_id text NOT NULL,
    event_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    PRIMARY KEY (tenant_id, event_id),
    FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS events_tenant_sequence_idx ON events(tenant_id, sequence);
CREATE INDEX IF NOT EXISTS event_outbox_pending_idx ON event_outbox(created_at) WHERE published_at IS NULL;
