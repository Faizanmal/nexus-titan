# Phase 03 evidence — local developer platform and CI

Date: 2026-11-15 (Asia/Calcutta). Output below is sanitized; no `.env` values or credentials are included.

## Checks run

| Command | Exit | Observed result |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | All three workspace projects current; pnpm 11.18.0. |
| `pnpm -r lint` | 0 | Contracts and web lint passed. Existing ESLint config emitted React/pages informational warnings for contracts. |
| `pnpm -r typecheck` | 0 | Contracts and web typechecks passed. |
| `pnpm -r test` | 0 | Shared contracts test suite: 2 passed. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next 16.4.5 compiled, typechecked, and generated `/`, `/_not-found`, `/firebase-spike`. |
| `pnpm contracts:check` | 0 | Deterministic generated artifacts current. |
| `pnpm firebase:check` | 0 | Auth/Firestore/Storage emulator config and deny rules; source mapper and fixture routing assertions passed. Node 26 module-type warnings. |
| `uv lock --project services/api --python 3.13` | 0 | Added psycopg 3.3.9, psycopg-binary 3.3.9, tzdata 2026.6 to lock. |
| `uv sync --project services/api --locked --python 3.13` (repo-local isolated environment/cache) | 0 | 36 packages audited; isolated at `services/api/.venv-phase03` and ignored by Git. |
| `uv run --project services/api --locked pytest -q` (same isolated env/cache; recovery rerun) | 0 | 16 passed, 1 Starlette/httpx deprecation warning. Includes task-runner exit propagation regression. |
| `python -m compileall -q services/api/src/nexus_titan_api scripts/task.py` | 0 | Python syntax compilation passed. |
| `docker compose --profile core --profile distributed --profile graph --profile observe config --quiet` | 0 | Profiles parse and render. No services started. |
| `python scripts/task.py --help` | 0 | Cross-platform task CLI loads and lists required tasks. |
| Parse `.github/workflows/ci.yml` with PyYAML | 0 | Workflow YAML parses successfully. |
| Final `pnpm --filter @nexus-titan/web build` after provider flag change | 0 | Production build and typecheck/static generation passed. |
| Final `pnpm firebase:check` after provider flag assertion | 0 | Emulator config, no-token fixture mode, inference source and fixture routing assertions passed. |
| `docker info --format 'Docker engine: {{.ServerVersion}}'` | 1 | Docker Desktop engine named pipe missing; daemon unavailable. |
| `python scripts/task.py integration core` (recovery reproduction) | 1 | Stopped before service start: Docker API pipe `npipe:////./pipe/dockerDesktopLinuxEngine` absent. Classified infrastructure, not app/database/credentials/quota. |
| `uv sync` with pre-existing default environment/cache | 1 | Sandbox could not access pre-existing `services/api/.venv` / user uv cache; rerun succeeded in repo-local isolated environment. |
| Initial pnpm checks in restricted sandbox | 1 | Windows `spawn EPERM`; reran under approved local process access and checks passed. |

## Not run / blocked

- Compose container startup, API readiness over HTTP, PostgreSQL migration idempotence, seed idempotence, and demo reset were not run because Docker Engine is unavailable. No health evidence is claimed.
- CI-hosted dependency review/audit and optional Swift/Kotlin jobs were not executed locally. No native application projects or compiled artifacts were created.
- Resource consumption was not measured. Last host audit: 4 logical CPUs, about 7.2 GiB free on workspace drive; RAM not measured. Docker images/services are not pulled.

## Recovery notes

- The first recovery pytest collection failed (exit 1) because `scripts` was not importable from the API test root; the test now adds the repository root to `sys.path`, and the rerun passed 16 tests.
- Reproduced `python scripts/task.py integration core`; exit 1 occurs at `docker compose up` before any service is created. The runner now exits with the child status and avoids a Python traceback. The external Docker engine is still the root blocker and cannot be repaired by a repository change.
- Manual unblock: start Docker Desktop, ensure the Linux engine is running, confirm `docker info --format 'Docker engine: {{.ServerVersion}}'` succeeds, then rerun `python scripts/task.py integration core`. Do not clear or delete volumes as part of this recovery.

## Limits

Phase 02 Firebase gates are unchanged. Compose includes `change-me-local-only` placeholders; replace them in ignored `.env` for local use and never use them in deployment. OTel config includes key/body redaction before a local debug exporter, but it has not been exercised with live telemetry. Temporal is a local dev server with file persistence, not a production cluster. The default Storage emulator rules deny all access. Seed now prints and checks its synthetic fixture event row count; the live database count remains unobserved until Docker is available.
