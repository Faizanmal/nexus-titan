ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_sequence bigint NOT NULL DEFAULT 0;

UPDATE tenants AS tenant
SET last_sequence = COALESCE((SELECT max(event.sequence) FROM events AS event WHERE event.tenant_id = tenant.tenant_id), 0);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_check;
ALTER TABLE events ADD CONSTRAINT events_source_check CHECK (source IN ('DEVICE', 'API', 'AGENT', 'WORKER', 'SIMULATOR', 'PEER'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS site_id varchar(63);
ALTER TABLE events ADD COLUMN IF NOT EXISTS aggregate_type varchar(16);
ALTER TABLE events ADD COLUMN IF NOT EXISTS aggregate_id varchar(128);
ALTER TABLE events ADD COLUMN IF NOT EXISTS aggregate_revision bigint;
ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE events ADD COLUMN IF NOT EXISTS device_id uuid;
ALTER TABLE events ADD COLUMN IF NOT EXISTS payload_hash bytea;
ALTER TABLE events ADD CONSTRAINT events_aggregate_type_check CHECK (aggregate_type IS NULL OR aggregate_type IN ('asset','incident'));
ALTER TABLE events ADD CONSTRAINT events_aggregate_revision_check CHECK (aggregate_revision IS NULL OR aggregate_revision > 0);
ALTER TABLE events ADD CONSTRAINT events_payload_hash_check CHECK (payload_hash IS NULL OR octet_length(payload_hash) = 32);
ALTER TABLE events ADD CONSTRAINT events_aggregate_revision_unique UNIQUE (tenant_id, site_id, aggregate_type, aggregate_id, aggregate_revision);

CREATE TABLE aggregate_heads (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    site_id varchar(63) NOT NULL,
    aggregate_type varchar(16) NOT NULL CHECK (aggregate_type IN ('asset','incident')),
    aggregate_id varchar(128) NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    last_sequence bigint NOT NULL CHECK (last_sequence > 0),
    PRIMARY KEY (tenant_id, site_id, aggregate_type, aggregate_id)
);

CREATE TABLE aggregate_projections (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    site_id varchar(63) NOT NULL,
    aggregate_type varchar(16) NOT NULL CHECK (aggregate_type IN ('asset','incident')),
    aggregate_id varchar(128) NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    last_sequence bigint NOT NULL CHECK (last_sequence > 0),
    classification text NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, site_id, aggregate_type, aggregate_id)
);

-- Snapshot cursors advance only after every earlier tenant event has been projected.
-- Existing v1.0 events have no aggregate contract and are treated as already folded.
CREATE TABLE projection_cursors (
    tenant_id text PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO projection_cursors(tenant_id,last_sequence)
SELECT tenant.tenant_id,COALESCE(max(event.sequence) FILTER (WHERE event.aggregate_type IS NULL),0)
FROM tenants AS tenant LEFT JOIN events AS event ON event.tenant_id=tenant.tenant_id
GROUP BY tenant.tenant_id;

CREATE TABLE event_inbox (
    consumer text NOT NULL,
    tenant_id text NOT NULL,
    event_id uuid NOT NULL,
    consumed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, tenant_id, event_id),
    FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, event_id) ON DELETE CASCADE
);

ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0);
ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS last_error_code varchar(96);
ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS delivery_generation integer NOT NULL DEFAULT 0 CHECK (delivery_generation >= 0);

CREATE TABLE event_dead_letters (
    tenant_id text NOT NULL,
    event_id uuid NOT NULL,
    attempts integer NOT NULL CHECK (attempts > 0),
    error_code varchar(96) NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    PRIMARY KEY (tenant_id, event_id),
    FOREIGN KEY (tenant_id, event_id) REFERENCES event_outbox(tenant_id, event_id) ON DELETE CASCADE
);

CREATE TABLE projection_outbox (
    tenant_id text NOT NULL,
    event_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error_code varchar(96),
    dead_lettered_at timestamptz,
    PRIMARY KEY (tenant_id, event_id),
    FOREIGN KEY (tenant_id, event_id) REFERENCES events(tenant_id, event_id) ON DELETE CASCADE
);

CREATE INDEX events_tenant_site_sequence_idx ON events(tenant_id, site_id, sequence);
CREATE INDEX events_aggregate_revision_idx ON events(tenant_id, site_id, aggregate_type, aggregate_id, aggregate_revision);
CREATE INDEX event_outbox_retry_idx ON event_outbox(next_attempt_at, created_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX projection_outbox_retry_idx ON projection_outbox(next_attempt_at, created_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
