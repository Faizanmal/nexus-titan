# Phase 12 — Operational knowledge and memory evidence

Date: 2026-11-16 (Asia/Calcutta). Sanitized outputs; no tenant data or credentials.

## Reference and environment gates

- Read `AGENTS.md` and `docs/BUILD_STATE.md`.
- Missing: `prompts/reference/master-spec.md`, `prompts/reference/contracts.md`, `prompts/reference/official-requirements.md`.
- Docker Desktop Linux engine unavailable; no Postgres, pgvector, Neo4j or browser service run is claimed.

## Commands and results

| Command | Exit | Result |
|---|---:|---|
| `services/api/.venv/Scripts/python.exe -m pytest -p no:cacheprovider -q` (cwd `services/api`) | 0 | 80 passed, 3 warnings (Starlette/httpx deprecation and two FastAPI lifespan deprecations) |
| `services/api/.venv/Scripts/python.exe -m pytest -p no:cacheprovider tests/test_migration_order.py -q` | 0 | 1 passed; ordered migration orchestration verified with patched boundaries, not a live database |
| `services/api/.venv/Scripts/python.exe -m compileall -q services/api/src/nexus_titan_api services/api/tests scripts/evaluate_knowledge.py` | 0 | Python source compiled |
| `services/api/.venv/Scripts/python.exe scripts/evaluate_knowledge.py` | 0 | 3 query fixture; 9 chunks; fixture-hash-v1; document macro precision@2 0.50, recall@2 1.00 |
| `python scripts/generate-contracts.py --check` | 0 | Contract codegen current |
| TypeScript `transpileModule` syntax check for `apps/web/src/app/knowledge/page.tsx` | 0 | TSX transpilation syntax passed; this is not semantic typecheck |
| `git diff --check` | 0 | No whitespace errors in tracked diff; repository content is untracked on `master`, so this does not inspect untracked files |
| `node .../typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` | 1 | Full typecheck blocked by missing React/Next and workspace package links; `next/types.js`, `react`, `@nexus-titan/hybrid-web`, and other modules unresolved |
| `docker compose ps` | 1 | Cannot connect to Docker Desktop Linux engine named pipe |
| Live migration 007, manual ingestion, pgvector query/index, tenant DB isolation, Neo4j graph query/rebuild parity, browser offline cache | SKIPPED | Docker/browser runtime unavailable; no mocked result counted as live proof |

## Retrieval evaluation output

```json
{
  "fixture_id": "TITAN-WTP-01",
  "provider": "fixture-hash-v1",
  "chunks": 9,
  "k": 2,
  "macro_precision_at_k": 0.5,
  "macro_recall_at_k": 1.0
}
```

Each labeled query retrieved its relevant synthetic manual in the top two documents; one unrelated manual also appears in that top-two set. This measures only three hand-labeled synthetic queries and is not real-world or production semantic quality evidence.

## Test development note

An initial focused test run exited 1 due the paragraph chunk offset assertion and stale expected fixture chunk count; the chunker was corrected to preserve exact offsets at blank-line boundaries. The migration-order unit test initially failed because its fake Alembic config lacked `set_main_option`; the test fake was corrected and then passed. Final full API suite passed.
