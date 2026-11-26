# Phase 07 evidence — synthetic telemetry and anomalies

Date: 2026-11-15 (Asia/Calcutta)  
Host: Windows 10 x64, Node 26.5.0, pnpm 11.18.0, Python 3.13 / uv.  
Sanitization: no secrets, auth tokens, private evidence, or tenant data included. The holdout file contains only generated synthetic labels.

## Checks run

| Command | Exit | Result |
|---|---:|---|
| `python scripts/generate-telemetry.py` | 0 | Generated separate public sample, holdout-label, and detector-report fixtures. 23,040 points; 182 fault-labeled points; 8 sustained-alert windows. |
| `python scripts/generate-telemetry.py --check-deterministic` | 0 | Repeated output identical; sample SHA-256 `64f646143a3fb6aa9a74c24d545107e0869b39b80d2b25dd3bfbbd69730c2816`. |
| Synthetic holdout evaluation (inside generator) | 0 | TP 179, FP 83, FN 3, TN 22,775; precision 0.6832, recall 0.9835. Frozen first 30 valid samples; median/MAD robust-z; threshold 6. This is a synthetic holdout result only. |
| `python scripts/generate-contracts.py` | 0 | OpenAPI plus TS/Swift/Kotlin/Python v1.3.0 artifacts generated. |
| `python scripts/generate-contracts.py --check` | 0 | Generated artifacts current after enum-safe telemetry metric/quality/unit and nullable-type changes. |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies current. |
| `pnpm -r lint` | 0 | Web/contracts lint passed; contracts reports existing informational React/pages detection warnings. |
| `pnpm -r typecheck` | 0 | Web/contracts typechecks passed. |
| `pnpm -r test` | 0 | 3 contract JSON roundtrip tests passed, including telemetry nullable/missing sample. |
| `pnpm --filter @nexus-titan/web build` | 0 | Production build passed; static routes include `/telemetry`. |
| `pnpm firebase:check` | 0 | Existing static Firebase configuration/source checks passed. Not a cloud or emulator test. |
| `uv sync --project services/api --locked` | 0 | Locked API dependencies current. No new Python runtime dependencies were added. |
| `uv run --project services/api --locked pytest -q` | 0 | 58 passed, 4 warnings (framework deprecations plus a pytest cache permission warning). Includes deterministic faults, missingness, out-of-order detector input, tenant-scoped query binding, bounds, schema, policy, and dedup logic tests. |
| `uv run --project services/api --locked python -c ... sql_statements(...)` | 0 | Static parser read 4 statements in `004_synthetic_telemetry.sql`; no live database was involved. |
| `python -m compileall -q services/api/src/nexus_titan_api scripts/generate-telemetry.py scripts/task.py` | 0 | API/simulator syntax passed. |
| `docker compose --profile core --profile distributed --profile graph --profile observe config --quiet` | 0 | Compose profiles parse. Services were not started. |
| `docker info --format 'Docker engine: {{.ServerVersion}}'` | 1 | Docker Desktop Linux engine pipe is unavailable (`npipe:////./pipe/dockerDesktopLinuxEngine`). |
| `pnpm --filter @nexus-titan/web lint` / `typecheck` / `build` (after final UTC input adjustment) | 0 | Final web lint, typecheck and production build passed; `/telemetry` is prerendered. |
| `python scripts/task.py --help` | 0 | Simulator and fixture-only retention task options are registered. |

## Corrected attempts

- An earlier full pytest run exited 1 with 56 passing tests and one stale assertion that expected v1.3 to be rejected. Updated the test to accept current v1.3 and reject unknown v1.4; final full suite passed.
- An earlier web typecheck exited 2 because generated nullable/optional values were not narrowed in the chart; a later lint attempt exited 1 for synchronous state updates in an effect. Corrected the chart and codegen; final web lint/typecheck/build passed. Contract tests passed 3/3.
- The ordinary sandbox initially returned `spawn EPERM` for pnpm/Node child processes. Approved rerun completed successfully.
- The ordinary sandbox Firebase check initially failed to spawn a child; approved rerun passed the Firebase checks. This does not change Firebase cloud/device gates from earlier phases.

## Live gates not run

No PostgreSQL migration was applied; no simulator samples or incident events were persisted; no repeated-insert/alert replay behavior was verified on Postgres; and no authenticated API query/chart was exercised against live services. The Docker engine is unavailable. The two-tenant check is a mocked repository-level scope test, not a live isolation integration test. `Timescale`, MQTT, Swift compiler and Kotlin/Gradle toolchains were not exercised. These are not marked green.


