CREATE TABLE causal_investigations (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
 site_id varchar(63) NOT NULL,
 incident_id uuid NOT NULL,
 actor_id varchar(128) NOT NULL,
 idempotency_key varchar(128) NOT NULL,
 result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
 graph_version char(64) NOT NULL CHECK (graph_version ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,incident_id) REFERENCES events(tenant_id,event_id) ON DELETE CASCADE,
 UNIQUE(tenant_id,site_id,idempotency_key)
);
CREATE INDEX causal_investigations_scope_idx ON causal_investigations(tenant_id,site_id,created_at DESC);
