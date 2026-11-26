CREATE TABLE world_fixture_seeds (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    fixture_id varchar(64) NOT NULL,
    dataset_sha256 char(64) NOT NULL CHECK (dataset_sha256 ~ '^[a-f0-9]{64}$'),
    seed_sequence_start bigint NOT NULL CHECK (seed_sequence_start >= 0),
    asset_count integer NOT NULL CHECK (asset_count >= 100),
    complete boolean NOT NULL DEFAULT false,
    seeded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, fixture_id)
);

CREATE TABLE world_documents (
    tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    site_id varchar(63) NOT NULL,
    document_id varchar(128) NOT NULL,
    fixture_id varchar(64),
    title varchar(240) NOT NULL,
    content text NOT NULL,
    classification text NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL')),
    license varchar(64) NOT NULL,
    source varchar(64) NOT NULL CHECK (source IN ('synthetic_fixture','approved_artifact')),
    content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, document_id)
);

CREATE TABLE world_document_chunks (
    tenant_id text NOT NULL,
    document_id varchar(128) NOT NULL,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    content text NOT NULL,
    embedding vector,
    embedding_model varchar(128),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    PRIMARY KEY (tenant_id, document_id, chunk_index),
    FOREIGN KEY (tenant_id, document_id) REFERENCES world_documents(tenant_id, document_id) ON DELETE CASCADE,
    CHECK ((embedding IS NULL AND embedding_model IS NULL) OR (embedding IS NOT NULL AND embedding_model IS NOT NULL))
);

CREATE INDEX world_documents_fixture_idx ON world_documents(tenant_id, site_id, fixture_id);
