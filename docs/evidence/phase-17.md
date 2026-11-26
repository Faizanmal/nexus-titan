# Phase 17: Mission Control and incident workspace evidence

Date: 2026-11-16

## Commands and actual results

| Command/check | Exit | Result |
|---|---:|---|
| `node tests/design-system.test.mjs` (cwd `apps/web`) | 0 | 8/8 static assertions passed: shell route pages exist, primary token contrast, semantic legacy colors, accessibility primitives, fixture isolation, mission/cursor API wiring, field alias/telemetry export, guarded demo reset UI. These are source checks, not browser tests. |
| `services/api/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` (cwd `services/api`) | 0 | Final full API suite: 98 passed, 3 existing deprecation warnings, 12.67 s. Includes demo reset policy and runtime OpenAPI registration tests. No live Postgres or HTTP reset operation was exercised. |
| `python -m compileall -q services/api/src/nexus_titan_api/demo_routes.py services/api/src/nexus_titan_api/main.py` | 0 | Python syntax compilation passed. |
| `python scripts/generate-contracts.py --check` | 0 | Shared contract artifacts remain current; v1.3 wire schemas were not changed. |
| `git diff --check` | 0 | No whitespace errors. Workspace files remain untracked on `master`; this does not establish a clean baseline diff. |
| `pnpm --filter @nexus-titan/web typecheck` | 1 | pnpm retried npm registry metadata requests and received `ECONNREFUSED`; command was interrupted before TypeScript diagnostics. |
| `pnpm install --offline --frozen-lockfile` | 1 | pnpm 11 still attempted npm registry metadata for supply-chain verification, received `ECONNREFUSED`, and was interrupted. No lockfile changes were made. |
| Focused demo/agent API check before OpenAPI merge correction | 1 | 1 failed, 6 passed: the new `/v1/demo/reset` route was not yet included in the custom runtime OpenAPI merge. Added the `/v1/demo/` merge path; focused rerun passed 7 tests and the final full suite passed. |
| Dependency availability checks | 0 | Local Next, TypeScript, and Playwright package links are absent. |

## Acceptance checks not run

- Playwright mission → incident → investigation → simulation → approval interaction, tenant switching, viewer/denied-role and duplicate-click browser tests.
- Screenshots and rendered overflow/freshness/error/reconnect checks.
- Postgres-backed authorization, event cursor reconciliation, simulation approval lifecycle, and destructive demo-reset HTTP flow.
- Lint, semantic TypeScript check, and production Next build.

The static fixture tests are not presented as acceptance proof. Mission projections, incident history, and telemetry are fetched from existing authenticated APIs; no mock fallback is used. Device rows indicate registered identities only, not active peer connectivity. Agent runs may remain queued without the Temporal worker. All provided world/telemetry values remain synthetic.
