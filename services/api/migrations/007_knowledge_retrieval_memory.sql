CREATE TABLE knowledge_document_versions (
 tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
 site_id varchar(63) NOT NULL,
 document_id varchar(128) NOT NULL,
 source_version varchar(64) NOT NULL,
 fixture_id varchar(64),
 title varchar(240) NOT NULL,
 content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL')),
 license varchar(64) NOT NULL,
 source varchar(64) NOT NULL CHECK (source IN ('synthetic_fixture','approved_artifact')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
 is_current boolean NOT NULL DEFAULT true,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,document_id,source_version),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX knowledge_one_current_version ON knowledge_document_versions(tenant_id,site_id,document_id) WHERE is_current AND revoked_at IS NULL;
CREATE INDEX knowledge_docs_scope_idx ON knowledge_document_versions(tenant_id,site_id,classification,is_current,document_id);
CREATE TABLE knowledge_source_audit (
 id bigserial PRIMARY KEY,
 tenant_id text NOT NULL,
 site_id varchar(63) NOT NULL,
 document_id varchar(128) NOT NULL,
 source_version varchar(64) NOT NULL,
 actor_id varchar(128) NOT NULL,
 action varchar(24) NOT NULL CHECK (action IN ('revoked')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,document_id,source_version) REFERENCES knowledge_document_versions(tenant_id,document_id,source_version) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE knowledge_chunks (
 tenant_id text NOT NULL,
 site_id varchar(63) NOT NULL,
 document_id varchar(128) NOT NULL,
 source_version varchar(64) NOT NULL,
 chunk_index integer NOT NULL CHECK (chunk_index>=0),
 start_offset integer NOT NULL CHECK (start_offset>=0),
 end_offset integer NOT NULL CHECK (end_offset>=start_offset),
 content text NOT NULL,
 content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,document_id,source_version,chunk_index),
 FOREIGN KEY(tenant_id,document_id,source_version) REFERENCES knowledge_document_versions(tenant_id,document_id,source_version) ON DELETE CASCADE
);
CREATE INDEX knowledge_chunks_scope_idx ON knowledge_chunks(tenant_id,site_id,document_id,source_version);
CREATE INDEX knowledge_chunks_fts_idx ON knowledge_chunks USING gin(to_tsvector('english',content));

CREATE TABLE knowledge_embeddings (
 tenant_id text NOT NULL,
 site_id varchar(63) NOT NULL,
 document_id varchar(128) NOT NULL,
 source_version varchar(64) NOT NULL,
 chunk_index integer NOT NULL,
 embedding vector(64) NOT NULL,
 provider varchar(64) NOT NULL CHECK (provider IN ('fixture-hash-v1')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,document_id,source_version,chunk_index),
 FOREIGN KEY(tenant_id,document_id,source_version,chunk_index) REFERENCES knowledge_chunks(tenant_id,document_id,source_version,chunk_index) ON DELETE CASCADE
);
CREATE INDEX knowledge_embeddings_tenant_site_idx ON knowledge_embeddings(tenant_id,site_id,document_id,source_version);
CREATE INDEX knowledge_embeddings_cosine_idx ON knowledge_embeddings USING hnsw(embedding vector_cosine_ops);

CREATE TABLE knowledge_memory_facts (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
 site_id varchar(63) NOT NULL,
 subject varchar(256) NOT NULL,
 fact text NOT NULL CHECK (length(fact)<=4000),
 classification text NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL')),
 conflict_group uuid NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 state text NOT NULL CHECK (state IN ('current','superseded','disputed')),
 verified_by text NOT NULL,
 provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='array' AND jsonb_array_length(provenance)>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,site_id) REFERENCES sites(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,verified_by) REFERENCES memberships(organization_id,user_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,site_id,conflict_group,revision)
);
CREATE INDEX knowledge_memory_scope_idx ON knowledge_memory_facts(tenant_id,site_id,subject,state,revision DESC);
