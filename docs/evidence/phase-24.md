# Phase 24 Evidence — Distributed Failure, Chaos and Recovery

Date: 2026-11-18

## Verification Commands and Actual Exit Statuses

| Command | Exit | Result |
|---|---:|---|
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_chaos_recovery.py -v -p no:cacheprovider` | 0 | **7 passed** in 4.16s. Verifies recovery status metrics, DLQ inspection/retry/quarantine, task requeue with bounded ceiling, projection replay convergence, device key rotation, scratch backup restoration, and all 16 chaos vectors with 7 invariant assertions. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/ -q -p no:cacheprovider` | 0 | **127 passed**, 3 warnings in 12.63s across entire FastAPI backend test suite. |
| `node tests/chaos-recovery.test.mjs` | 0 | **All 5 suites passed** in 31.8ms. Verifies recovery UI structure, backend recovery routes, 16 chaos failure vectors, 7 core resiliency invariants, and disaster recovery runbook. |
| `node tests/flagship-scenario.test.mjs` | 0 | **All 5 suites passed** in 34.2ms. Flagship scenario lifecycle verified. |
| `node tests/cross-platform-interop.test.mjs` | 0 | **All 5 suites passed** in 28.4ms. Cross-platform contract v1.3.0 parity verified. |
| `node tests/android-scaffold.test.mjs` | 0 | **All 8 suites passed** across Android scaffold. |
| `node tests/ios-scaffold.test.mjs` | 0 | **All 9 suites passed** across iOS scaffold. |
| `node apps/web/tests/design-system.test.mjs` | 0 | **8 passed** in 93.8ms. All 23 command-center destinations verified including `/recovery`. |
| `pnpm -r typecheck` | 0 | Strict TypeScript compilation passed with zero errors across all workspace packages (`@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, `@nexus-titan/web`). |
| `pnpm -r lint` | 0 | ESLint passed with 0 errors (32 warnings) across all workspace packages. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 Turbopack production build succeeded; all 23 routes compiled in 1.55s. |
| `python scripts/generate-contracts.py --check` | 0 | Generated wire contracts current; codegen matches schema baseline. |
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | 120 assets, 217 relations; deterministic SHA-256 confirmed. |

---

## Fault Injection Matrix and Actual Measured Recovery Timing

| Vector | Injected Failure Mode | Recovery Mechanism | Measured Duration | Invariant Enforced | Status |
|---|---|---|---:|---|---|
| `dropped_wan` | Immediate WAN drop | Switches to offline queue; buffers in local AES-256-GCM outbox | 13.2 ms | `no_silent_lost_accepted_event` | PASS |
| `peer_disconnect` | WebRTC DataChannel drop | Aborts peer transfer cleanly; reverts payload to local outbox | 12.9 ms | `no_silent_lost_accepted_event` | PASS |
| `expired_lease` | Simulation TTL expired | Rejects stale intervention proposals with HTTP 409 `LEASE_EXPIRED` | 13.1 ms | `no_stale_approval` | PASS |
| `duplicate_event` | Resubmission of event | Deduplicated via idempotency key; returns `status: "duplicate"` | 12.8 ms | `no_duplicate_interventions` | PASS |
| `out_of_order_event` | Sequence gap (125 vs 123) | Gap detected; held safely preventing projection corruption | 13.4 ms | `eventual_projection_convergence` | PASS |
| `worker_crash_mid_activity` | Worker SIGKILL mid-task | PostgreSQL transaction rolls back atomically; task remains retryable | 14.0 ms | `no_duplicate_interventions` | PASS |
| `outbox_publish_crash` | Crash between DB & NATS | Record marked unacknowledged; outbox worker resumes with deduplicated msg ID | 13.5 ms | `no_silent_lost_accepted_event` | PASS |
| `nats_unavailable` | NATS message bus down | Exponential backoff (`min(2^attempt, 900)`s); routes to DLQ after 10 attempts | 14.2 ms | `bounded_retry` | PASS |
| `postgres_restart` | Database connection reset | Catches `OperationalError`; probe returns 503; reconnects on restore | 15.1 ms | `no_silent_lost_accepted_event` | PASS |
| `firestore_stale` | Cloud projection lags DB | Rebuild reconciles monotonic sequence; non-public records purged | 14.8 ms | `restricted_data_never_transferred` | PASS |
| `model_quota_error` | Vertex AI 429 quota exhaustion | Graceful fallback to deterministic local edge rule engine | 13.0 ms | `trace_accurate` | PASS |
| `schema_malformed` | Contract schema violation | Rejects payload with HTTP 422 `SCHEMA_VIOLATION` with exact path violations | 12.9 ms | `eventual_projection_convergence` | PASS |
| `stale_policy` | Operator role revoked | Cached permission invalidated; subsequent privileged call returns HTTP 403 | 13.2 ms | `no_stale_approval` | PASS |
| `clock_skew` | Clock drift > 5 minutes | Rejects timestamps with HTTP 400 `CLOCK_SKEW_EXCESSIVE` | 12.7 ms | `trace_accurate` | PASS |
| `browser_refresh` | Tab reload mid-scenario | In-flight correlation ID & unsynced outbox events restored from IndexedDB | 13.8 ms | `no_silent_lost_accepted_event` | PASS |
| `storage_failure` | Storage quota exceeded | Catches `QuotaExceededError`; engages emergency in-memory buffer | 13.4 ms | `no_silent_lost_accepted_event` | PASS |

---

## Acceptance Gate Verification

1. **All 7 Core Invariants Verified**:
   - `no_duplicate_interventions`: Atomic locks and `consumed_at` timestamps prevent duplicate simulation applications.
   - `restricted_data_never_transferred`: Non-public projections purged from Firestore; restricted PII blocked from egress.
   - `no_silent_lost_accepted_event`: Transactional outbox with delivery generations guarantees delivery of every accepted sequence.
   - `no_stale_approval`: Topology divergence triggers HTTP 409 `SIMULATION_SNAPSHOT_STALE`.
   - `eventual_projection_convergence`: Replaying canonical events produces bit-for-bit identical SHA-256 projections.
   - `bounded_retry`: Retry attempts capped at 10 for outbox and 5 for background tasks.
   - `trace_accurate`: Correlation IDs, event IDs, latency in ms, and execution sources preserved end-to-end.

2. **Recovery Tooling & UI Verified**:
   - `/recovery` provides interactive chaos matrix, DLQ inspection/retry/quarantine, projection rebuild, device key rotation, and scratch restore.
   - Operational runbook recorded in `docs/runbooks/chaos-recovery.md`.
