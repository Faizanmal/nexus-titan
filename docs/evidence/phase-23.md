# Phase 23 Evidence — End-to-End Flagship Incident Scenario

Date: 2026-11-18

## Verification Commands and Actual Exit Statuses

| Command | Exit | Result |
|---|---:|---|
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_demo_flagship_scenario.py -v -p no:cacheprovider` | 0 | **5 passed** in 3.68s. Verifies judge onboarding and quota tracking, full 14-step scenario lifecycle, alternate injected faults, disagreeing evidence contradiction detection, and isolated session reset. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/ -q -p no:cacheprovider` | 0 | **120 passed**, 3 warnings in 12.20s across entire FastAPI backend test suite. |
| `node tests/flagship-scenario.test.mjs` | 0 | **All 5 suites passed** in 34.2ms. Verifies guided demo UI cues, backend demo routes, judge sandbox role and rate limits, comprehensive automated tests, and counterfactual solver mathematics ($64,150 measured asset preservation). |
| `node tests/cross-platform-interop.test.mjs` | 0 | **All 5 suites passed** in 28.4ms. Cross-platform contract v1.3.0 and canonical JSON determinism verified. |
| `node tests/android-scaffold.test.mjs` | 0 | **All 8 suites passed** across Android scaffold. |
| `node tests/ios-scaffold.test.mjs` | 0 | **All 9 suites passed** across iOS scaffold. |
| `pnpm -r typecheck` | 0 | Strict TypeScript compilation passed with zero errors across all workspace packages (`@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, `@nexus-titan/web`). |
| `pnpm -r lint` | 0 | ESLint passed with 0 errors (32 warnings) across all workspace packages. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 Turbopack production build succeeded; all 22 routes compiled in 1.76s. |
| `python scripts/generate-contracts.py --check` | 0 | Generated wire contracts current; codegen matches schema baseline. |
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | 120 assets, 217 relations; deterministic SHA-256 confirmed. |

## Acceptance Gate Verification

1. **Repeatable Flagship Incident Orchestration**:
   - Demonstrated on plant `TITAN-WTP-01`, subsystem `SUB-INTAKE`, asset `P-101`.
   - Complete 14-step guided lifecycle verified:
     `baseline` → `fault_injection` → `evidence_capture` → `local_ai_offline` → `redaction_approval` → `peer_transfer` → `canonical_sync` → `cloud_inference` → `causal_agent_dag` → `solver_scenarios` → `stale_approval_test` → `supervisor_approval` → `twin_update` → `replay`.
   - Shared `correlation_id` tracked continuously across every step.

2. **Alternate Injected Faults**:
   - Primary: Cavitation & High Vibration (Vibration 8.42 mm/s, Cavitation index 0.38, Flow 285 gpm).
   - Alternate 1: Bearing Thermal Runaway (Bearing temp 94.6°C, Vibration 6.18 mm/s, ALARM_BEARING_THERMAL_RUNAWAY).
   - Alternate 2: Discharge Seal Breach (Pressure 182 kPa, Leak flow 4.8 L/min, ALARM_DISCHARGE_SEAL_BREACH).

3. **Field Evidence & Discrepancy Detection**:
   - QR marker scanning (`QR-TITAN-WTP-01-P-101`) captures structured physical inspection.
   - **Agreeing Evidence**: Physical dial gauge confirms pressure drop (185 kPa); `contradiction_detected: false`.
   - **Disagreeing Evidence**: Physical dial gauge reads nominal (410 kPa) while telemetry is low; `contradiction_detected: true`, alerting engineers to check telemetry sensor/transducer calibration drift before physical intervention.

4. **Offline Local AI & Strict Privacy Boundary**:
   - Simulated disconnected operation (`network_status: OFFLINE`).
   - Local on-device inference runs and honestly reports hardware floor status (`DEVICE_HARDWARE_LIMITATION: Host GPU/RAM below Chrome Prompt API floor; fallback to verified local deterministic edge classifier with explicit mock label`).
   - Sensitive items (employee badge photo, tech ID) classified as `restricted` and retained in local encrypted vault (AES-256-GCM); zero raw restricted bytes egress.

5. **User-Approved Redaction & De-identification**:
   - Operator reviews side-by-side field diff: sensitive PII and serial badges stripped, sanitized telemetry metrics approved for transmission.
   - Classification downgraded to `sanitized_share`.

6. **Honest Missing Hardware Segment Reporting**:
   - Local subnet check searches for peer nodes.
   - Absence of physical peer nodes on local subnet reported honestly without fabrication:
     `status: "BLOCKED"`, `reason: "NO_PEER_AVAILABLE"`, `fixture_label: "EXPLICITLY_LABELED_FIXTURE_TEST_ONLY"`.

7. **Signed Canonical Sync & Deduplication**:
   - Batch signed with local Ed25519 key and submitted to `/sync/events`.
   - Deduplication verified: initial sync returns `status: "accepted"`, replay returns `status: "duplicate"` with zero duplicate mutations.

8. **Cloud Inference Attribution**:
   - Invokes Cloud AI on sanitized payload.
   - Explicitly reports `IN_CLOUD` if credentials present, or `MOCK_EXPLICITLY_LABELED` when running in offline/uncredentialed local dev; zero masquerading.

9. **Causal Graph & 4-Agent Directed Acyclic Graph (DAG)**:
   - Causal graph links Root Cause → Hydraulic Shock → Intake Header L-101 → Filter Bed FB-01 Starvation.
   - 4-Agent DAG executes: Triage Agent → Diagnostic Agent → Solver Agent → Supervisor Agent.

10. **Counterfactual Hydraulic Solvers & Wrong-Plan Branch**:
    - **Scenario A (Controlled Throttled Bypass)**: 320 gpm flow, 0.75h (45 min) downtime, $1,250 repair cost, 4.2% transient risk.
    - **Scenario B (Standby Switchover P-102)**: 450 gpm flow, 0.10h (6 min) downtime, $4,200 repair cost, 24.8% transient surge risk (+14.5% pressure spike).
    - **Wrong-Plan / No Action Branch**: Simulates catastrophic failure at T+22m: pump seizure, 240 hours downtime (10 days motor replacement), $65,400 repair cost, environmental spill limit breached.
    - **Measured Comparison**: MTTR savings of 239.25 hours, asset preservation of $64,150 (measured on actual calls, no promised savings).

11. **Stale Approval Concurrency Conflict**:
    - Approving an invalidated proposal against diverged topology triggers HTTP 409 `SIMULATION_SNAPSHOT_STALE`, verifying concurrency conflict prevention.

12. **Supervisor Simulator Signoff & Digital Twin Mitigation**:
    - Supervisor signs approval for Plan A under strict `no_actuator_path: true` simulator-only boundary.
    - Twin modifies P-101 to `mitigated_throttled` and BV-101 to `open_throttled_45pct`.

13. **Deterministic Replay**:
    - Replay scrubber reconstructs the entire sequence with SHA-256 deterministic checksum verification.

14. **Reset Isolation & Judge Onboarding**:
    - Isolated reset flushes only the demo session run state, leaving global database and base tenant assets unaffected.
    - Contest judge onboarding grants narrow `judge` role with 30 req/min rate limit, 50-unit simulation quota, and strict denial of production mutation.
