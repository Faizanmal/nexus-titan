# Phase 13: Causal investigation evidence

Date: 2026-11-16 (workspace local date)

## Commands and results

| Command | Exit | Result |
|---|---:|---|
| `\.venv\Scripts\python.exe -m pytest -p no:cacheprovider tests/test_causal.py -q` (cwd `services/api`) | 0 | 7 passed. Covers directed propagation, alternate root, evidence uncertainty, time contradiction, missing data, duplicate conflicting citation, isolated spike, drift, invalid citation and dangling graph relation. |
| `\.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q` (cwd `services/api`) | 0 | 87 passed, 3 deprecation warnings, 28.43s (final run after scope validation change). |
| `\.venv\Scripts\python.exe ..\..\scripts\evaluate-causal.py` (cwd `services/api`) | 0 | 4 hidden-label root cases; top-1 accuracy 1.0000 and mean reciprocal rank 1.0000 for seed 20261115. Synthetic-only and not calibrated causal accuracy. |
| `\.venv\Scripts\python.exe -m compileall -q src/nexus_titan_api` (cwd `services/api`) | 0 | Python modules compile. |
| `uv run --project services/api pytest services/api/tests/test_causal.py -q` | 1 | Blocked before test execution by access denied opening `C:\Users\atoz\AppData\Local\uv\cache\sdists-v9\.git`; direct existing venv was used instead. |
| `python scripts/generate-contracts.py --check` | 0 | Shared contract code generation is current. |
| Node TypeScript `transpileModule` for `apps/web/src/app/causal/page.tsx` | 0 | TSX syntax transpilation passed; this is not semantic typecheck or browser rendering. |
| `docker compose ps` | 1 | Docker Desktop Linux engine named pipe unavailable; live Postgres migration and API checks could not run. |
| `git diff --check` | 0 | Command reported no whitespace errors; repository is entirely untracked on `master`, so this does not establish a baseline diff review. |

## Not run / blocked

- No Postgres service: migration 008 application, persistence, idempotency race, authorization query, cross-tenant and citation lookup integration are not verified.
- No browser/Playwright run: incident UI interaction/rendering is not verified; workspace dependencies were not restored.
- No production structured model, simulation, or real telemetry provider is configured. Model calls are explicitly `attempted: false`.
- Hidden label accuracy uses four fault-root groups in the deterministic fixture only; it is not a production metric and is not independent of fixture design.
- Prompt references required by project instructions are absent. No official causal policy/contract was available.

No mocked or unexecuted check is represented as passing.
