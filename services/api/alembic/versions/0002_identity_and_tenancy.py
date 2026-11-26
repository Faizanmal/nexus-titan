"""Identity and tenancy baseline. Downgrade intentionally refuses data loss."""

from alembic import op

revision = "0002_identity"
down_revision = None
branch_labels = None
depends_on = None

DDL = (
    "CREATE TABLE organizations (id varchar(63) PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{2,62}$'), display_name varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE identity_users (id varchar(128) PRIMARY KEY, email varchar(320) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX ix_identity_users_email ON identity_users(email)",
    "CREATE TABLE sites (id varchar(63) PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,62}$'), organization_id varchar(63) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_sites_org_id UNIQUE (organization_id,id))",
    "CREATE TABLE memberships (organization_id varchar(63) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id varchar(128) NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE, role varchar(16) NOT NULL CHECK (role IN ('owner','admin','operator','viewer')), status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,user_id))",
    "CREATE TABLE membership_sites (organization_id varchar(63) NOT NULL, user_id varchar(128) NOT NULL, site_id varchar(63) NOT NULL, PRIMARY KEY (organization_id,user_id,site_id), FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE, FOREIGN KEY (organization_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE)",
    "CREATE TABLE devices (id uuid PRIMARY KEY, organization_id varchar(63) NOT NULL, user_id varchar(128) NOT NULL, client_device_id varchar(128) NOT NULL, label varchar(120) NOT NULL, public_key_pem varchar(4096) NOT NULL, status varchar(16) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','revoked')), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, CONSTRAINT uq_devices_org_user_client_id UNIQUE (organization_id,user_id,client_device_id), FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE)",
    "CREATE INDEX ix_devices_organization_id ON devices(organization_id)",
    "CREATE INDEX ix_devices_user_id ON devices(user_id)",
    "CREATE TABLE device_challenges (id uuid PRIMARY KEY, organization_id varchar(63) NOT NULL, user_id varchar(128) NOT NULL, nonce bytea NOT NULL CHECK (octet_length(nonce)=32), expires_at timestamptz NOT NULL, consumed_at timestamptz, FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE)",
    "CREATE INDEX ix_device_challenges_organization_id ON device_challenges(organization_id)",
    "CREATE INDEX ix_device_challenges_user_id ON device_challenges(user_id)",
    "CREATE TABLE organization_invites (id uuid PRIMARY KEY, organization_id varchar(63) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, email varchar(320) NOT NULL, role varchar(16) NOT NULL CHECK (role IN ('admin','operator','viewer')), token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32), invited_by varchar(128) NOT NULL REFERENCES identity_users(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz, CONSTRAINT uq_invites_org_id UNIQUE (organization_id,id))",
    "CREATE INDEX ix_organization_invites_organization_id ON organization_invites(organization_id)",
    "CREATE INDEX ix_organization_invites_email ON organization_invites(email)",
    "CREATE TABLE invite_sites (invite_id uuid NOT NULL, organization_id varchar(63) NOT NULL, site_id varchar(63) NOT NULL, PRIMARY KEY (invite_id,site_id), FOREIGN KEY (organization_id,invite_id) REFERENCES organization_invites(organization_id,id) ON DELETE CASCADE, FOREIGN KEY (organization_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE)",
    "CREATE TABLE identity_rate_limit_buckets (key varchar(192) PRIMARY KEY, window_started_at timestamptz NOT NULL, hits integer NOT NULL CHECK (hits > 0))",
    "CREATE TABLE upload_authorizations (id varchar(96) PRIMARY KEY, organization_id varchar(63) NOT NULL, site_id varchar(63) NOT NULL, user_id varchar(128) NOT NULL, status varchar(16) NOT NULL CHECK (status IN ('approved','consumed','revoked')), max_bytes integer NOT NULL CHECK (max_bytes > 0 AND max_bytes <= 15728640), content_type varchar(96) NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')), classification varchar(16) NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL')), expires_at timestamptz NOT NULL, FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE, FOREIGN KEY (organization_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE)",
)


def upgrade() -> None:
    for statement in DDL:
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError(
        "Identity downgrade is disabled to prevent accidental membership/device data loss"
    )
