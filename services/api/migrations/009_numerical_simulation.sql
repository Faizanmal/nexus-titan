CREATE TABLE simulation_runs (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
 site_id varchar(63) NOT NULL,
 actor_id varchar(128) NOT NULL,
 idempotency_key varchar(128) NOT NULL,
 state varchar(16) NOT NULL CHECK (state IN ('queued','completed','cancelled','failed')),
 fixture_id varchar(64) NOT NULL CHECK (fixture_id='TITAN-WTP-01'),
 graph_version varchar(256) NOT NULL,
 input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
 input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot)='object'),
 result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
 output_hash char(64) CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
 seed bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(tenant_id,site_id,idempotency_key),
 UNIQUE(id,tenant_id,site_id),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX simulation_runs_scope_idx ON simulation_runs(tenant_id,site_id,created_at DESC);

CREATE TABLE simulation_approvals (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL,
 tenant_id text NOT NULL,
 site_id varchar(63) NOT NULL,
 requester_id varchar(128) NOT NULL,
 requester_role varchar(16) NOT NULL CHECK (requester_role IN ('owner','admin','operator')),
 action jsonb NOT NULL CHECK (jsonb_typeof(action)='object'),
 action_hash char(64) NOT NULL CHECK (action_hash ~ '^[0-9a-f]{64}$'),
 snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
 state varchar(16) NOT NULL CHECK (state IN ('pending','approved','consumed','expired')),
 idempotency_key varchar(128) NOT NULL,
 expires_at timestamptz NOT NULL,
 approved_by varchar(128),
 approved_at timestamptz,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,requester_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,approved_by) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(run_id,tenant_id,site_id) REFERENCES simulation_runs(id,tenant_id,site_id) ON DELETE CASCADE
);
CREATE INDEX simulation_approvals_expiry_idx ON simulation_approvals(tenant_id,state,expires_at);

CREATE TABLE simulation_audit (
 sequence bigserial PRIMARY KEY,
 run_id uuid NOT NULL,
 tenant_id text NOT NULL,
 site_id varchar(63) NOT NULL,
 actor_id varchar(128) NOT NULL,
 event_type varchar(32) NOT NULL CHECK (event_type IN ('queued','executed','cancelled','proposal','approved','applied')),
 details jsonb NOT NULL CHECK (jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(run_id,tenant_id,site_id) REFERENCES simulation_runs(id,tenant_id,site_id) ON DELETE CASCADE
);
CREATE INDEX simulation_audit_run_idx ON simulation_audit(run_id,sequence);
