# Phase 05 evidence — event store and projections

Date: 2026-11-15 (Asia/Calcutta)  
Host: Windows 10 x64, Node 26.5.0, pnpm 11.18.0, Python 3.13 / uv, Java 17.0.12.  
Sanitization: logs below contain no credentials, Firebase tokens, event payloads or user data.

## Checks run

| Command | Exit | Observed result |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | All 3 workspace projects already up to date. |
| `pnpm -r lint` (approved process execution) | 0 | Contracts and web lint passed; informational React/pages config warnings only. |
| `pnpm -r typecheck` (after fix; approved process execution) | 0 | Contracts and web typechecks passed. |
| `pnpm -r test` (approved process execution) | 0 | 2 shared contract tests passed. |
| `pnpm --filter @nexus-titan/web build` (after fix; approved process execution) | 0 | Next 16.4.5 compiled, typechecked, and generated 5 static routes. |
| `pnpm firebase:check` (approved process execution) | 0 | Static rules/config and inference-source checks passed; this is not Firestore integration. |
| `uv sync --project services/api --locked` (repo-local environment) | 0 | 68 locked dependencies audited; `nats-py` included. |
| `uv run --project services/api --locked pytest -q` (final run) | 0 | 39 passed; 4 deprecation/cache warnings. |
| `python -m compileall -q services/api/src/nexus_titan_api services/api/alembic scripts/task.py` | 0 | Python source compiled. |
| `python scripts/generate-contracts.py --check` | 0 | Generated OpenAPI and language bindings current. |
| `docker compose --profile core --profile distributed --profile graph --profile observe config --quiet` | 0 | All profiles parsed. |
| `python scripts/task.py compose-check` | 0 | Compose configuration check passed. |
| `docker info --format 'Docker engine: {{.ServerVersion}}'` | 1 | Cannot connect to `npipe:////./pipe/dockerDesktopLinuxEngine`; Linux engine is absent. |

An initial web typecheck/build exposed the shared package's `.ts` import extension not permitted in the web TypeScript config (exit 2); `allowImportingTsExtensions` was added and both checks passed. Initial sandboxed pnpm subprocess attempts returned `EPERM`; the checks were rerun with approved process execution. No integration check was counted from static/unit test evidence.

The final regression test covers projection delivery arriving after a tenant rebuild has advanced the checkpoint, plus in-order and gap delivery classification. Rebuild holds the tenant and projection checkpoint locks and Firestore writes/deletes compare sequence before changing derived state.

## Not run / blocked

- Live `001_core.sql` + `002_event_store_sync.sql` migration, concurrency/rollback, seed idempotence, API readiness and database-backed append: blocked by unavailable Docker Linux engine; no independent PostgreSQL server was configured.
- Real NATS JetStream ACK/retry/crash-replay and durable consumer test: blocked by unavailable Docker engine; only Compose config and Python/unit checks ran.
- Real Firestore emulator/cloud projection ACL, monotonic writes and rebuild/checksum repeatability: blocked by unavailable Docker engine and no configured Firebase service credentials. `pnpm firebase:check` checks static configuration only.
- CI workflow execution and multi-process worker race/load tests: not run.
- API test coverage is unit/route-level. The signed route test monkeypatches the append boundary; it does not prove Postgres transactions or device registration against a live database.

No credentials or actual event payloads are included in this evidence file.
