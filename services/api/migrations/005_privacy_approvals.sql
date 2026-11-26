CREATE TABLE privacy_approvals (
    id uuid PRIMARY KEY,
    tenant_id text NOT NULL,
    site_id varchar(63) NOT NULL,
    actor_id varchar(128) NOT NULL,
    actor_role varchar(16) NOT NULL CHECK (actor_role IN ('owner','admin','operator')),
    action varchar(32) NOT NULL CHECK (action = 'simulated_action'),
    aggregate_type varchar(16) NOT NULL CHECK (aggregate_type IN ('asset','incident')),
    aggregate_id varchar(128) NOT NULL,
    payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    snapshot_digest char(64) NOT NULL CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    snapshot_revision bigint NOT NULL CHECK (snapshot_revision >= 0),
    idempotency_key varchar(128) NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','consumed','revoked','expired')),
    expires_at timestamptz NOT NULL,
    approved_by varchar(128),
    approver_role varchar(16) CHECK (approver_role IS NULL OR approver_role IN ('owner','admin')),
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_privacy_approval_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT fk_privacy_approval_site FOREIGN KEY (tenant_id, site_id)
        REFERENCES sites(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_privacy_approval_actor FOREIGN KEY (tenant_id, actor_id)
        REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_privacy_approval_approver FOREIGN KEY (approved_by)
        REFERENCES identity_users(id)
);
CREATE INDEX privacy_approvals_expiry_idx ON privacy_approvals(tenant_id, state, expires_at);
