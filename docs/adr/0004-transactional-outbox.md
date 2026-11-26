# ADR-0004: NATS delivery uses a transactional outbox

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
Writing Postgres and publishing NATS in separate operations can lose or duplicate events on process failure.

## Decision
Write the canonical event and an outbox row in one Postgres transaction. A relay publishes the row to NATS and marks it delivered only after broker acknowledgement. Consumers are idempotent by tenant and event ID.

## Consequences
Delivery is at least once; consumers tolerate replay through a durable JetStream consumer and tenant/event inbox key. The relay uses JetStream publish acknowledgement and `Nats-Msg-Id`; a crash after broker acknowledgement but before PostgreSQL marking can republish, and the inbox prevents duplicate business state. A per-tenant projection checkpoint rejects gaps and holds snapshot cursors behind projection lag. Firestore has its own derived projection outbox and sequence/revision guard. Failures use capped retries and sanitized dead-letter diagnostics.

The relay and worker are implemented in source and Compose's `distributed` profile. They have not been run against live NATS/Postgres/Firestore in this environment because the Docker Linux engine is unavailable. Firestore is never authoritative.
