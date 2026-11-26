# Phase 06 evidence — synthetic world and operational ontology

Date: 2026-11-15 (Asia/Calcutta)  
Host: Windows 10 x64. Sanitization: outputs contain no credentials or private evidence.

## Checks run

| Command | Exit | Result |
|---|---:|---|
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | Deterministic fixture validated: 120 assets, 217 directed relations; SHA-256 `9afabb7bebaaa290d096f3e4299e4c9874d413651da8a30d6c97399deeeb2acc`. |
| `python scripts/generate-contracts.py --check` | 0 | v1.2 generated artifacts are current. |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies current. |
| `pnpm -r lint` | 0 | Contracts and web lint passed; existing informational framework detection warnings remain. |
| `pnpm -r typecheck` | 0 | Contracts and web typecheck passed. |
| `pnpm -r test` | 0 | 2 contract package tests passed. |
| `pnpm --filter @nexus-titan/web build` | 0 | Production build passed; `/world` is included. |
| `pnpm firebase:check` | 0 | Static Firebase/config checks passed; this is not a live Firebase test. |
| `uv sync --project services/api --locked` | 0 | Locked dependencies installed, including Neo4j driver 6.4.1. |
| `uv run --project services/api --locked pytest -q` | 0 | 50 passed, 4 warnings (full suite before final graph-verify task-runner wiring). |
| `uv run --project services/api --locked pytest -q services/api/tests/test_world_fixture.py services/api/tests/test_world_graph.py` | 0 | 10 passed after graph-verify task-runner wiring. |
| `python -m compileall -q services/api/src/nexus_titan_api services/api/alembic scripts/task.py scripts/generate-world-fixture.py scripts/world-run-fixture.py` | 0 | Python syntax compilation passed (before final task-runner wiring); targeted world tests import and exercise graph module after wiring. |
| `docker compose --profile core --profile distributed --profile graph --profile observe config --quiet` | 0 | Compose profiles parse; no services started. |
| `uv run --project services/api --locked alembic -c services/api/alembic.ini upgrade head --sql` | 0 | Alembic generated SQL for revisions 0002/0003; not applied to a database. |
| Static SQL statement parser for `003_world_ontology.sql` | 0 | Parsed 4 statements and confirmed expected table definitions; not a database migration test. |
| `docker info --format 'Docker engine: {{.ServerVersion}}'` | 1 | Docker Desktop Linux engine named pipe is absent. |
| `uv run --project services/api --locked pytest -q ...` with shared cache/default sandbox | 2 | Attempt blocked before test collection by Windows access denied while opening uv shared cache; retried successfully with escalation and repository-local uv cache. |
| Direct repository `.venv` pytest invocation | 1 | This older environment lacked `neo4j`; not used as a passing result. Locked uv sync installed the driver and the targeted suite then passed. |

## Live acceptance still blocked

No Postgres migration or repeated world seed, API world endpoint, Neo4j rebuild/tenant-scoped live verification, or Firestore projection was run. Docker engine is not available. The Neo4j integration test is source/unit-level only. Two-run reset isolation is unit-tested; no live tenant database reset was exercised. These gates remain open.
| `python -m compileall -q scripts/task.py` and `python scripts/task.py --help` | 0 | Final task-runner syntax and `graph-verify` command registration passed. |
| `git diff --check` | 0 | No whitespace errors in tracked changes; repository files are currently untracked in Git, so this does not validate their contents. |
