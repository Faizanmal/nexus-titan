# TITAN-WTP-01 synthetic world ontology

`TITAN-WTP-01` is an original, deterministic synthetic fixture. It is not a real facility, validated engineering design, maintenance procedure, or operational guidance. The generator and complete bundle live in `scripts/generate-world-fixture.py` and `tests/fixtures/world/TITAN-WTP-01/`.

## Contents and integrity

- Seed `20261115` produces 120 assets: 24 pumps, 12 tanks, 16 filters, 30 valves, 28 sensors, and 10 subsystem nodes. Each has a stable WTP01-prefixed ID, fake `SYN-` serial, label, site/subsystem, classification-safe metadata, units, capacity bounds, local coordinates, and typed dependencies.
- 217 directed relationships use `PART_OF`, `DEPENDS_ON`, `FEEDS`, `MONITORS`, and `CONTROLLED_BY`. The generator rejects malformed/duplicate IDs, dangling/self edges, impossible capacities, and critical assets without a directed path to the illustrative utilities root.
- `world.json`, `events.json`, `manifest.json`, and `scene.json` are deterministic. Scene entities use the same IDs and procedural geometry URIs; coordinates are in metres under `TITAN_LOCAL_PLANT_GRID_V1` (x east, y north, z up, local origin). This is a fictional plant-local frame, not a surveyed/geodetic reference.
- Five original synthetic SVG inspection illustrations carry fixture asset IDs and fake serials. Three original fictional handouts are CC0-1.0. No third-party manuals or photographs are used. Engineering topology/capacity values are generated assumptions only.
- The pump-degradation scenario separates its public observations from `scenarios/pump-degradation/hidden_truth.json`. The static web preview and per-run input bundles exclude the ground-truth file. Never add that file to a model prompt or user-facing retrieval path.

## Contracts, persistence, and APIs

Wire contracts are currently versioned at v1.3.0; v1.0.0, v1.1.0, and v1.2.0 remain immutable and v1.3 readers accept supported historical event versions. Migration `003_world_ontology.sql` records fixture seed hashes and creates tenant/site-scoped original documents plus chunk metadata with an optional, dimension-unspecified pgvector embedding. Embedding columns remain null until a retrieval/model phase chooses an embedding contract. No retrieval API or vector index is implemented here.

`python scripts/task.py world-seed` requires the local demo organization to exist. It appends the stable asset-created event IDs in one tenant-locked transaction, creates the fixture site if needed, and upserts only the allowlisted synthetic manuals and chunks. Repeating the same seed is idempotent; a different dataset hash under the same fixture ID is rejected.

Authenticated, membership/site-scoped read APIs are `/v1/world/assets`, `/v1/world/topology`, `/v1/world/incidents`, and `/v1/world/snapshot`. They read PostgreSQL aggregate projections, redact deleted states and enforce viewer classification limits. The hidden truth is not stored in Postgres.

Neo4j is derived. The `graph` Compose profile includes PostgreSQL migrations, NATS, the outbox consumer, Neo4j and a watcher that reads accepted PostgreSQL projections. Firestore projection writes stay disabled unless explicitly enabled with an emulator/project. `python scripts/task.py graph-rebuild --tenant demo-nexus --confirm demo-nexus` performs an explicitly confirmed tenant rebuild. Cypher data is parameterized; relation labels are selected from a fixed allowlist; nodes/edges and `WorldGraph.graph_version` are idempotently upserted. Graph properties contain operational fixture metadata only, never manual text or inspection evidence. Rebuild is limited to `APP_ENV=local`.

## Local QA and isolated runs

```powershell
python scripts/generate-world-fixture.py --check-deterministic
docker compose --profile core up --build --wait
python scripts/task.py world-seed
docker compose --profile core --profile graph up --build --wait
python scripts/task.py graph-rebuild --tenant demo-nexus --confirm demo-nexus
pnpm --filter @nexus-titan/web dev
```

Visit `/world` for an accessible static table preview. Create an isolated run input bundle with `python scripts/task.py fixture-run --run-id <uuid-v4>` and reset only that bundle with `python scripts/task.py fixture-reset --run-id <uuid-v4> --confirm <same-uuid-v4>`. Run data is local and ignored by Git; reset refuses path escapes, symlinks, mismatched confirmations, and missing/mismatched run markers. It does not touch Postgres or other runs.

The source generator/schema/unit gates are separate from PostgreSQL migration/seed idempotence and live Neo4j rebuild/query checks. Do not mark database or graph integration gates passed unless run against the configured services.

## Knowledge, retrieval, and memory

`world_seed` also writes each public CC0 fixture manual as an immutable fixture version with exact paragraph offsets and deterministic vectors. `/knowledge` exposes tenant/site scoped search, source panels, deep-link citations, bounded asset/dependency/incident graph queries, and explicitly human-verified resolution facts. Citation lookups reject stale/revoked versions and mismatched chunk hashes. Fixture vectors are tagged `fixture-hash-v1`; they are deterministic evaluation data, not a supported semantic embedding model. Approved manuals can be cached in IndexedDB for lexical-only offline search and are visibly stale until refreshed. See [knowledge retrieval guide](knowledge-retrieval.md) and ADR-0020.
