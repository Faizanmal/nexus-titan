# ADR 0030: End-to-End Flagship Incident Scenario Orchestration Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Phase 23 requires an isolated, repeatable, seeded end-to-end flagship incident scenario for NEXUS TITAN. Industrial operators and contest evaluators need a guided verification workflow proving the full operational lifecycle: baseline SCADA telemetry → synthetic fault injection → edge anomaly detection → technician evidence capture → offline local AI inference with strict privacy boundaries → user-approved redaction → honest local peer mesh check → canonical cloud sync with cryptographic device signatures → actual Cloud Vertex AI inference on sanitized payloads → multi-agent causal DAG execution → counterfactual hydraulic solvers → concurrency conflict detection → supervisor simulator signoff → digital twin mitigation → deterministic incident timeline replay.

- **Decisions:**
  1. **Deterministic 14-Step Guided Scenario Lifecycle (`apps/web/src/app/demo/page.tsx` & `/v1/demo/scenario/step`)**:
     The guided demo orchestrates the entire operational lifecycle through 14 verifiable stages without hardcoded success states:
     - **Baseline**: Plant TITAN-WTP-01 nominal intake telemetry (Flow 450 gpm, Pressure 412.5 kPa, Vibration 1.18 mm/s, Temp 41.8°C).
     - **Fault Injection**: Selectable synthetic faults: primary cavitation & vibration (vibration 8.42 mm/s, cavitation index 0.38) vs alternate bearing thermal runaway (94.6°C) vs discharge seal breach (pressure 182 kPa, 4.8 L/min leak).
     - **Field Evidence Capture**: QR marker scanning (`QR-TITAN-WTP-01-P-101`) with agreeing physical observation vs disagreeing physical observation (identifying telemetry sensor/transducer calibration drift).
     - **Offline Local AI & Privacy Boundary**: Disconnected operation evaluating edge models while retaining raw badge photos and PII in local AES-256-GCM vault with `classification: "restricted"`; zero raw restricted bytes egress.
     - **User-Approved Redaction**: Interactive de-identification diff; operator signs consent downgrading classification from `restricted` to `sanitized_share`.
     - **Peer Mesh Check**: Honest local subnet check. When physical peer nodes are absent, reports `BLOCKED: NO_PEER_AVAILABLE` with explicit fixture label, strictly refusing to fabricate peer connections.
     - **Canonical Sync**: Signs batch with Ed25519; syncs to `/sync/events` verifying deduplication idempotency.
     - **Cloud Vertex AI Inference**: Cloud root cause triage on sanitized context; reports genuine source attribution (`IN_CLOUD` or `MOCK_EXPLICITLY_LABELED`), strictly prohibiting fixture masquerading as Firebase.
     - **Causal Agent DAG**: Constructs directed causal propagation graph and executes a 4-agent DAG: Triage Agent → Diagnostic Agent → Solver Agent → Safety Supervisor Agent.
     - **Counterfactual Hydraulic Solvers**: Solves Scenario A (Controlled Throttled Bypass: 320 gpm, 45 min downtime, $1,250 cost) vs Scenario B (Standby Switchover to P-102: 450 gpm, +14.5% pressure surge, $4,200 cost) vs Wrong-Plan/No-Action Failure Branch (catastrophic seal blowout at T+22m, motor seizure, 240 hrs downtime, $65,400 repair cost).
     - **Stale Approval Concurrency Conflict**: Proves race condition protection: approving an invalidated proposal against diverged topology triggers HTTP 409 `SIMULATION_SNAPSHOT_STALE`.
     - **Supervisor Approval Gate**: Authorized operator signs off on chosen plan with strictly verified simulator-only execution (`no_actuator_path: true`).
     - **Digital Twin Update**: Spatial twin assets transition to mitigated/throttled state; projection version increments.
     - **Deterministic Replay**: Timeline scrubber computing bit-for-bit identical SHA-256 state hashes across runs.

  2. **Contest Judge Sandbox Onboarding (`/v1/demo/judge/onboard`)**:
     Evaluators and contest judges are provisioned into an isolated sandbox session with `role: "judge"`. Enforces a strict rate limit of 30 requests/minute, an allocated quota of 50 simulation units and 20 agent DAG runs, with read/simulate/replay permissions and explicit denial of production mutation (`production:write`, `tenant:delete`).

  3. **Isolated Demo Session Reset (`/v1/demo/session/reset`)**:
     Provides an isolated session-level reset that flushes only the active demo run state, preserving the global database, other tenant datasets, and baseline plant fixtures intact.

  4. **Source-Aware Cryptographic Trace**:
     Every step captures a cryptographic event ID, correlation ID, execution source, device type, network isolation state, and measured latency in ms.

- **Consequences:**
  - Complete, verifiable end-to-end incident lifecycle demonstrated live with authentic source attribution.
  - Zero tolerance for simulated mobile binaries or false cloud masquerading.
  - Clear, reproducible judge onboarding ensuring fair evaluation within strict rate and quota bounds.
