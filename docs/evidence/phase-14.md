# Phase 14: Numerical simulation and approvals

Date: 2026-11-16

## Commands and results

| Command | Exit | Result |
|---|---:|---|
| `\.venv\Scripts\python.exe -m pytest -p no:cacheprovider tests/test_simulation.py -q` (cwd `services/api`) | 0 | 9 passed. Analytical pressure/flow, continuity, repeatability, variant tradeoffs, malformed networks, approved action allowlist, expiry, self-approval, role and snapshot binding. |
| `\.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q` (cwd `services/api`) | 0 | 96 passed, 3 deprecation warnings, 13.04s (final run). |
| `\.venv\Scripts\python.exe -m compileall -q src/nexus_titan_api` (cwd `services/api`) | 0 | API modules compile. |
| `python scripts/generate-contracts.py --check` | 0 | Existing shared contract generator outputs remain current; historical v1.3.0 schema was not changed. |
| Node TypeScript `transpileModule` for `apps/web/src/app/simulation/page.tsx` | 0 | TSX syntax transpilation passed; semantic typecheck and browser render are not covered. |
| `$env:PYTHONPATH='src'; .\.venv\Scripts\python.exe -c "from nexus_titan_api.main import app; d=app.openapi(); print([p for p in d['paths'] if p.startswith('/v1/simulations/scenarios')])"` (cwd `services/api`) | 0 | Runtime OpenAPI exposes 8 scenario, execute/cancel/status, replay and approval/application paths. API was not started. |
| API venv `importlib.util.find_spec('wntr')` | 0 | `wntr_available=False`; simplified fallback used. |
| `docker compose ps` | 1 | Docker Desktop Linux engine pipe unavailable; Postgres migration and API integration gates could not run. |

## Measured synthetic numerical result

Fixture seed 20261115; fixed synthetic input and one-hour horizon (60 × 60 seconds). Baseline solved junction/consumer heads are 370/250 kPa gauge, both link flows 4 m³/h, energy proxy 0.714285714 kWh and downtime proxy 0 h. Virtual backup yields 300 kPa consumer pressure, 0.734126984 kWh and 0 h downtime. Resistance ×1.5 yields 190 kPa, 0.714285714 kWh and 1 h downtime. The maximum continuity residuals were approximately 6.22e-15, 1.15e-14 and 2.66e-15 m³/h respectively, below the documented 1e-9 m³/h tolerance. These are outputs of the fictional linear model only.

## Not run / blocked

- No Postgres service: migration 009, stored run/approval state transitions, concurrent idempotency, tenant/site database isolation, cancel/replay persistence and audit FKs were not integration-tested.
- No browser/Playwright: organization/site selection, charts/cards and separate-user supervisor workflow are unverified. Full package-linked semantic TypeScript check was not run.
- No WNTR/EPANET compatible dependency or calibrated plant model; no actual hydraulic accuracy validation. Real-device/live infrastructure checks are not applicable and were not claimed.
- The authoritative master spec, contracts prompt, and official requirements prompt are missing. Existing shared `SimulationRequest` is a particle-body contract and remains unchanged; new typed Pydantic paths are exposed in runtime OpenAPI only.

No mocked or unexecuted check is represented as passing.
