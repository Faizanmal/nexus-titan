CREATE TABLE agent_runs (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 site_id text NOT NULL,
 actor_id text NOT NULL,
 idempotency_key varchar(128) NOT NULL,
 workflow_id varchar(256) NOT NULL,
 state varchar(24) NOT NULL CHECK (state IN ('queued','running','waiting_client','paused','needs_review','completed','failed','cancelled')),
 input jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deadline_at timestamptz NOT NULL,
 UNIQUE (tenant_id, idempotency_key), UNIQUE (workflow_id),
 FOREIGN KEY (tenant_id, site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX ix_agent_runs_tenant_created ON agent_runs(tenant_id, created_at DESC);
CREATE TABLE agent_run_roles (
 run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 role_name varchar(32) NOT NULL, executor varchar(24) NOT NULL CHECK (executor IN ('deterministic','client_model')),
 state varchar(24) NOT NULL DEFAULT 'pending', result jsonb, evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id, role_name)
);
CREATE TABLE agent_role_attempts (
 id bigserial PRIMARY KEY, run_id uuid NOT NULL, role_name varchar(32) NOT NULL,
 attempt integer NOT NULL, state varchar(24) NOT NULL, trace jsonb NOT NULL DEFAULT '{}'::jsonb,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(run_id, role_name) REFERENCES agent_run_roles(run_id, role_name) ON DELETE CASCADE,
 UNIQUE(run_id, role_name, attempt)
);
CREATE TABLE agent_run_events (
 sequence bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 event_type varchar(48) NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_client_tasks (
 id uuid PRIMARY KEY, run_id uuid NOT NULL, role_name varchar(32) NOT NULL,
 tenant_id text NOT NULL, device_id uuid NOT NULL REFERENCES devices(id), state varchar(24) NOT NULL,
 lease_hash bytea, lease_generation integer NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 policy_version varchar(128) NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id, role_name) REFERENCES agent_run_roles(run_id, role_name) ON DELETE CASCADE
);
CREATE INDEX ix_agent_client_tasks_claim ON agent_client_tasks(tenant_id, state, lease_expires_at);
