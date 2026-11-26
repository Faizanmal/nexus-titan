# ADR 0026: Agent Studio DAG, Peer Mesh, Governance Audit Stream, and Event Replay

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Phase 19 requires an interactive agent studio with a 13-role DAG, clear placement explanations (`client_model` vs `deterministic`, `local` vs `cloud` vs `server` vs `mock`), bounded run lifecycle controls (`pause`, `continue`, `retry`, `cancel`, `step`), real registered/connected peer device matrix on `/mesh`, centralized `/governance` policy and tamper-evident audit streams with two-actor consent approvals, sequence-scrubbed deterministic `/replay` with bit-for-bit SHA-256 state matching, and privacy-preserving OpenTelemetry metrics without raw user prompt logging.

- **Decisions:**
  1. **13-Role Agent Studio DAG**: The execution DAG follows `agent_runtime.py` with 13 typed roles: `supervisor`, `vision`, `sensor`, `spatial`, `knowledge`, `privacy`, `causal`, `simulation`, `planning`, `critic`, `memory`, `recovery`, `verification`. Every role tracks planned placement versus actual placement with human-readable explanations.
  2. **Bounded Lifecycle Controls**: `cancel`, `pause`, `continue`, `retry`, and `step` are enforced through strict state transitions on `agent_runs` (`queued` -> `running` -> `completed` / `paused` / `cancelled` / `failed`). Run stepping allows advancing individual roles deterministically with attempt tracking.
  3. **Strict Sanitization & Zero Restricted Export**: Run trace exports via `GET /v1/agents/runs/{id}/export` strip all keys matching `restricted`, `secret`, `credential`, or `token`. No raw user prompts or unredacted binary bytes are transmitted to cloud or client exports.
  4. **Mesh Device Capability Matrix & Offline Caveat**: Peer nodes advertise capabilities (WebRTC DataChannel, Prompt API, IndexedDB quota, Ed25519 keys) and send heartbeats with RTT latency. The `/mesh` interface prominently documents the offline caveat: peer-to-peer data synchronization operates over local subnets without cloud dependency; unverified or revoked devices fail closed.
  5. **Tamper-Evident Governance Audit Stream**: Governance events are cryptographically chained using SHA-256 (`h_i = SHA256(h_{i-1} : id : timestamp : action : result)`). Supervisor consent approvals require two-actor signoff and snapshot binding.
  6. **Deterministic Event State Replay**: Replaying events from sequence $0 \dots 120$ reconstructs the projection state. Deterministic SHA-256 checksums of the replayed asset list match the canonical head projection bit-for-bit.
  7. **Observability Isolation**: Observability metrics strictly isolate mock fixture executions from real local or cloud inferences (`source_counts.mock` separate from `local`/`cloud`/`server`).

- **Consequences:**
  - Full visibility into agent placement decisions and policy denial reasons.
  - Provable tamper-evidence for security audits and administrative changes.
  - Zero raw prompt leakage or restricted data exfiltration.
  - High confidence in deterministic projection rebuilds from immutable event logs.
