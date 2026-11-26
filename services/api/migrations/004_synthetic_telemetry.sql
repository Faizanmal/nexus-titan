CREATE TABLE telemetry_samples (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    site_id varchar(63) NOT NULL,
    fixture_id varchar(64) NOT NULL CHECK (fixture_id = 'TITAN-WTP-01'),
    asset_id varchar(128) NOT NULL CHECK (asset_id ~ '^WTP01-PMP-[0-9]{3}$'),
    sampled_at timestamptz NOT NULL,
    sample_sequence bigint NOT NULL CHECK (sample_sequence > 0),
    metric text NOT NULL CHECK (metric IN ('pressure','flow','vibration','temperature')),
    value double precision,
    unit text NOT NULL CHECK (
        (metric='pressure' AND unit='kPa') OR
        (metric='flow' AND unit='m3/h') OR
        (metric='vibration' AND unit='mm/s') OR
        (metric='temperature' AND unit='degC')
    ),
    quality text NOT NULL CHECK (quality IN ('good','suspect','missing')),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,site_id,asset_id,metric,sampled_at),
    UNIQUE (tenant_id,site_id,sample_sequence),
    CHECK ((quality='missing' AND value IS NULL) OR (quality <> 'missing' AND value IS NOT NULL)),
    CHECK (value IS NULL OR value > '-Infinity'::float8 AND value < 'Infinity'::float8)
);
CREATE INDEX telemetry_samples_window_idx ON telemetry_samples
    (tenant_id,site_id,asset_id,metric,sampled_at DESC);

CREATE TABLE telemetry_alerts (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    site_id varchar(63) NOT NULL,
    asset_id varchar(128) NOT NULL,
    metric text NOT NULL CHECK (metric IN ('pressure','flow','vibration','temperature')),
    window_start timestamptz NOT NULL,
    event_id uuid NOT NULL,
    triggered_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,site_id,asset_id,metric,window_start),
    UNIQUE (tenant_id,event_id)
);

CREATE INDEX telemetry_alerts_cooldown_idx ON telemetry_alerts
    (tenant_id,site_id,asset_id,metric,triggered_at DESC);
