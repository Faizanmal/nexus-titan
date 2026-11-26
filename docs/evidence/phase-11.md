# Phase 11 — Durable agent runtime evidence

Date: 2026-11-16 (Asia/Calcutta). Sanitized; no tokens or user payloads included.

## References and scope

Read `AGENTS.md` and `docs/BUILD_STATE.md`. The required `prompts/reference/master-spec.md`, `prompts/reference/contracts.md`, and `prompts/reference/official-requirements.md` are absent. The implementation therefore follows only the supplied phase prompt and existing contracts. Temporal package resolution was attempted but blocked by denied access to the configured venv/cache; no Temporal worker/service was run.

## Commands

| Command | Exit | Result |
|---|---:|---|
| `services/api/.venv/Scripts/python.exe -m pytest -q` (cwd `services/api`) | 0 | 72 passed, 4 warnings (Starlette httpx deprecation, two FastAPI `on_event` deprecations, pytest cache permission warning) |
| `services/api/.venv/Scripts/python.exe -m compileall -q services/api/src/nexus_titan_api services/api/tests` | 0 | Python source compilation passed |
| `python scripts/generate-contracts.py --check` | 0 | Contract codegen current |
| `git diff --check` | 0 | No whitespace errors in tracked diff; new files are not included in Git diff because repository is uncommitted/untracked |
| `uv lock --project services/api --offline --python 3.13` | 1 | Cannot open global uv cache `.git`: access denied |
| `UV_CACHE_DIR=.uv-cache-phase11 uv lock --project services/api --offline --python 3.13` | 1 | Existing `services/api/.venv/Scripts/python.exe` interpreter query denied |
| `pnpm --filter @nexus-titan/web typecheck` | 1 (interrupted) | Registry requests refused while pnpm attempted workspace integrity verification; web typecheck did not run |
| `docker compose ps` | 1 | Docker Desktop Linux engine pipe unavailable; Postgres migration could not be run |
| Temporal worker/replay and Postgres migration integration | SKIPPED | SDK/runtime and local database unavailable; not represented as passed |
| Playwright, Firebase client inference and real end-to-end DAG | SKIPPED | No worker, eligible client lease API, or browser acceptance run |

## Measured results

- DAG registry: 13 roles and deterministic topological order validated by unit tests.
- DAG cycle/unknown dependency rejection and output schema field/size bounds passed.
- Agent API paths appear in generated OpenAPI.
- No runtime latency, cost, or throughput measured.

## Sanitized test excerpt

```text
..............                                                           [100%]
72 passed, 4 warnings in 10.62s
```

