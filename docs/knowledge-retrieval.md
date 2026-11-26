# Operational knowledge and collective memory

The `/knowledge` workspace reads versioned synthetic manuals and accepted events from tenant/site scoped APIs. It provides lexical + pgvector candidate retrieval with transparent lexical/vector/graph scores, exact citations, an operational graph view, and explicit human verification for reusable resolution facts.

## Ingestion and source safety

`world_seed` ingests only the original `TITAN-WTP-01` CC0-1.0 synthetic manuals. Source metadata records document ID, fixture version, title, license, source and PUBLIC classification. Paragraph chunks preserve exact source offsets and SHA-256. The source version is immutable: a changed body must use a new version; old versions are kept as stale history and are not searchable. Admin revocation is audited. The retrieval and memory APIs reject confidential/restricted records; no such document path is implemented.

Migration `007_knowledge_retrieval_memory.sql` adds versioned documents, chunks, fixture vectors, version/revocation audit and memory facts. It adds a tenant/site scope B-tree, full-text GIN and pgvector HNSW cosine index. Every retrieval query additionally filters the authorized tenant, site, classification, current version and non-revoked status. The index does not replace authorization predicates.

The only embedding implementation is `fixture-hash-v1`, a deterministic signed token-hash vector used for reproducible test/evaluation behavior. API and UI label it as fixture-only. There is no real semantic embedding provider or production vector model configured. Graph relation score is used when an asset graph query succeeds; unavailability is returned as a status and does not pretend a graph result was present.

## Retrieval and citations

Search context is limited to 8,000 characters. Snippets are escaped and surrounded by source tags after a warning that retrieved source is untrusted data, not instructions. Manual citations include source version/chunk/offset/hash. Event evidence includes canonical event ID, sequence and occurrence timestamp. Citation endpoints recheck tenant/site visibility; old/revoked manual versions return stale status and changed chunk hashes are rejected. Event citation links return only accepted visible PUBLIC/INTERNAL event records.

Offline client cache holds only manuals returned by the authorized current-documents endpoint. Offline fallback uses lexical matching only, marks cached rows stale, and cannot certify a citation's current version until the server can be reached.

## Human-verified memory

Operators/admins explicitly submit a resolution fact and at least one current document citation or accepted visible event ID. The server validates each source before storing the reviewer and provenance. Facts carry a tenant/site, classification, revision, conflict group and state. Conflicting facts are preserved and marked disputed. They are not silently learned from model output and are not training data.

## Evaluation

Run `python scripts/evaluate_knowledge.py` (or the API venv's Python executable) to measure the labeled synthetic fixture in `tests/fixtures/knowledge/retrieval-eval.json`. The fixture currently contains three queries over nine paragraph chunks at k=2. It is not representative of real operational knowledge and says nothing about a production embedding model. Live DB/Neo4j, tenant-isolation, stale-revocation persistence and browser/offline gates must be recorded separately.
