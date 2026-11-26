# ADR 0031: Distributed Failure, Chaos Injection, and Disaster Recovery Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Industrial water plant systems are subjected to severe operating constraints: power interruptions, intermittent cellular/WAN connectivity, hardware failure, out-of-order telemetry packets, message broker drops, and database restarts. Phase 24 requires a comprehensive, controlled chaos test suite, automated disaster recovery procedures, and strict enforcement of seven core safety invariants to guarantee zero data loss and safe operations under adverse distributed failure scenarios.

- **Decisions:**
  1. **Controlled Chaos Injection Matrix (16 Vectors)**:
     Implemented in `/v1/recovery/chaos/simulate` and rendered on `/recovery`:
     - **Dropped WAN**: Offline transition with local AES-256-GCM outbox buffering; cloud calls safely rejected; zero data loss.
     - **Peer Disconnect**: Immediate WebRTC DataChannel severance handled cleanly; pending transfer aborted without phantom states.
     - **Expired Lease**: Simulation intervention lease TTL enforced; expired proposals rejected with HTTP 409 `LEASE_EXPIRED`.
     - **Duplicate Event**: Natural UUID idempotency keys guarantee exactly-once store semantics; second attempt returns `status: "duplicate"`.
     - **Out-of-Order Event**: Monotonic sequence gap detection holds out-of-sequence events (e.g. sequence 125 before 124), preventing aggregate projection corruption.
     - **Worker Crash Mid-Activity**: Atomic PostgreSQL transactions roll back uncommitted activity on SIGKILL; task remains retryable.
     - **Outbox Publish Crash**: Crash between DB write and NATS message publish safely resolved via unacknowledged outbox polling with deduplicated message IDs (`Nats-Msg-Id`).
     - **NATS Unavailable**: Message broker outage triggers bounded exponential backoff (`min(2^attempt, 900)`s) up to 10 attempts, then routes to Dead Letter Queue (`event_dead_letters`).
     - **Postgres Restart**: Connection reset caught (`psycopg.OperationalError`); readiness probe reports 503 `DEPENDENCY_UNAVAILABLE`; reconnects automatically upon database recovery.
     - **Firestore Projection Stale**: Monotonic sequence lag reconciled via `projection_rebuild.rebuild()`; non-public data strictly deleted from cloud projection.
     - **Model Quota Error**: Vertex AI HTTP 429 quota exhaustion gracefully falls back to deterministic local edge rule engine with explicit mock attribution.
     - **Schema Malformed**: Contract violations rejected with HTTP 422 `SCHEMA_VIOLATION` with exact JSON path violations, preserving database purity.
     - **Stale Policy**: Role downgrade or revocation immediately invalidates cached permissions; subsequent calls fail with HTTP 403 `ROLE_FORBIDDEN`.
     - **Clock Skew**: Device clock drift (>5 min future, >24 hr past) rejected with HTTP 400 `CLOCK_SKEW_EXCESSIVE`.
     - **Browser Refresh**: Tab reloads mid-scenario restored from IndexedDB local vault without losing un-synced outbox events.
     - **Storage Failure**: Local quota exhaustion (`QuotaExceededError`) caught; engages emergency in-memory buffer with user warning.

  2. **Seven Core Resiliency Invariants**:
     - `no_duplicate_interventions`: Simulations/actuators cannot execute more than once (`consumed_at` timestamp).
     - `restricted_data_never_transferred`: Restricted PII/credentials never sent to cloud egress unredacted.
     - `no_silent_lost_accepted_event`: Every accepted sequence is durably committed in PostgreSQL.
     - `no_stale_approval`: Approvals against diverged snapshots fail with HTTP 409 `SIMULATION_SNAPSHOT_STALE`.
     - `eventual_projection_convergence`: Replaying events produces bit-for-bit identical SHA-256 projections.
     - `bounded_retry`: Failed deliveries back off exponentially and dead-letter after 10 attempts.
     - `trace_accurate`: Every event and step preserves correlation ID, event ID, latency, and source.

  3. **Disaster Recovery UI & Runbook Operations (`/recovery` & `docs/runbooks/chaos-recovery.md`)**:
     - **DLQ Remediation & Poison Quarantine**: Requeuing dead-lettered events with new generation IDs, or quarantining poison payloads to prevent retry storms.
     - **Bounded Task Requeue**: Allows task requeuing up to a strict 5-attempt ceiling (`TASK_MAX_ATTEMPTS_EXCEEDED` on 6th attempt).
     - **Deterministic Projection Replay**: Reconstructs state bit-for-bit from canonical PostgreSQL events.
     - **Device Identity Key Rotation**: Rotates Ed25519/ECDSA keypairs with a 5-minute grace period.
     - **Scratch Backup Restore**: Restores snapshot backups onto isolated scratch environments for non-destructive forensics.

- **Consequences:**
  - Guaranteed zero silent data loss under network, database, broker, and worker crashes.
  - Provable eventual consistency with bit-for-bit deterministic SHA-256 state convergence.
  - Complete runbook and operational tooling for operator incident remediation.
