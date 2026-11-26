# Phase 19 Evidence — Agent Studio, Mesh, Governance and Replay

Date: 2026-11-18

## Verification Commands and Actual Exit Statuses

| Command | Exit | Result |
|---|---:|---|
| `pnpm -r typecheck` | 0 | All TypeScript packages (`@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, `@nexus-titan/web`) passed strict typecheck. |
| `pnpm -r lint` | 0 | ESLint passed with 0 errors across all workspace packages. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 Turbopack production build succeeded; all 22 routes compiled (including `/agents`, `/mesh`, `/governance`, `/replay`). |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_agent_studio_mesh_governance_replay.py -v -p no:cacheprovider` | 0 | **7 passed** in 3.20s. Verifies OpenAPI routes, OTel metric privacy & source isolation, readiness diagnostics, governance policies & audit SHA-256 chain, mesh capabilities & pairing challenges, replay reconstruction & checksum matching, and sanitized trace export without restricted data. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/ -q -p no:cacheprovider` | 0 | **106 passed**, 3 warnings in 6.75s across full backend API test suite. |
| `node apps/web/tests/agent-studio-mesh-replay.test.mjs` | 0 | **5 passed** in 14.40ms. Verifies 13-role DAG dependencies, trace sanitization, mesh capability matrix, governance audit stream SHA-256 chaining, and deterministic replay emergence. |
| `node apps/web/tests/design-system.test.mjs` | 0 | **8 passed** in 14.03ms. Verifies all command-center destinations (including `/replay` and `/governance`). |
| `node apps/web/tests/spatial-twin.test.mjs` | 0 | **10 passed** in 11.62ms. Scene-to-asset integrity and spatial twin parity. |
| `pnpm -r test` | 0 | **3 passed** in contracts, **15 passed** in hybrid-web. |
| `python scripts/generate-contracts.py --check` | 0 | Generated wire contracts current; codegen matches schema baseline. |
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | 120 assets, 217 relations; deterministic SHA-256 confirmed. |

## Acceptance Gate Verification

1. **Interactive Agent Studio DAG (`/agents`)**:
   - 13 typed roles rendered: `supervisor`, `vision`, `sensor`, `spatial`, `knowledge`, `privacy`, `causal`, `simulation`, `planning`, `critic`, `memory`, `recovery`, `verification`.
   - Planned vs actual placement tracking (`client_model` -> `local` / `cloud`; `deterministic` -> `server` / `deterministic`; `mock` strictly isolated).
   - Placement explanations and policy denial reasons surfaced in dedicated role inspector.
   - Bounded lifecycle controls: `step`, `pause`, `continue`, `retry`, `cancel` with attempt tracking and strict state transitions.
   - Filter bar by state (`queued`, `running`, `completed`, `failed`, `cancelled`) and actual source (`local`, `cloud`, `server`, `deterministic`, `mock`).
   - Strict export sanitization: `GET /v1/agents/runs/{id}/export` withholds all restricted records and secrets.
2. **Peer Intelligence Mesh (`/mesh`)**:
   - Real registered vs actively connected device tracking.
   - Comprehensive Capability Matrix: WebRTC DataChannel, Prompt API, IndexedDB quota, Camera/QR, Key Algorithm.
   - Transport indicators (`webrtc_datachannel`, `local_loopback`, `none`) and live RTT heartbeat latency monitor.
   - Sync backlog metrics: pending outgoing mutations, unacknowledged envelopes, sync generation.
   - Provisional vs accepted data counters and item inspection.
   - Explicit pairing challenge generation and device revocation controls.
   - Offline caveat clearly documented: local subnet P2P operation without cloud servers.
3. **Governance Control (`/governance`)**:
   - 4 versioned policies: Data Classification v1.2.0, Hybrid Placement v1.1.0, Mesh Exchange v1.0.0, Consent & Sharing v1.0.0.
   - Cryptographically chained audit stream using SHA-256 with verifiable chain head.
   - Consent & share artifact approval history with two-actor supervisory signoff and redacted previews.
   - Security denial log displaying exact reason codes (`ROLE_FORBIDDEN`, `SELF_APPROVAL_PROHIBITED`, `DEVICE_PROOF_INVALID`, `RESTRICTED_DATA_WITHHELD`).
   - Organization member management panel supporting role reassignment (`owner`, `admin`, `operator`, `viewer`) and site scoping.
4. **Deterministic Event State Replay (`/replay`)**:
   - Event scrubber ($0 \dots 120$) with Play, Pause, Step (-1/+1), Reset (#0), and Head (#120) controls with variable playback speed (1x, 2x, 5x, 10x).
   - Synchronized 2D plant layout and telemetry snapshot (pressure, flow, vibration, quality) at the scrubber sequence.
   - Bit-for-bit SHA-256 state checksum comparison between replayed asset projection and canonical head slice with verified match badge.
5. **Observability & Diagnostics (`/v1/observability/*`)**:
   - Privacy-preserving OTel metric summaries: API latency percentiles (p50: 14.2ms, p95: 48.7ms, p99: 112.5ms), agent task durations, solver convergence residual ($\le 1.2 \times 10^{-10}\text{ m}^3/\text{h}$), queue lag, and robust Z-score synthetic anomaly measure.
   - Source counts strictly isolate `mock` from real `local`, `cloud`, and `server` executions.
   - Strict privacy assertions: zero raw user prompts logged; local private traces withheld from cloud; restricted bytes redacted.
