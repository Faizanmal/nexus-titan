# ADR-0002: Postgres is canonical event storage

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
The project phase requires a canonical event store and derived Firestore views. Tenant isolation and deterministic replay require one authoritative write path.

## Decision
Postgres owns canonical tenant-scoped events, idempotency keys, event sequence, and transactional outbox rows. Event history is append-only. The application enforces unique `(tenant_id,event_id)` and tenant-scoped sequence constraints.

## Consequences
Migration `002_event_store_sync.sql` adds tenant sequence heads, aggregate revision/head metadata, append payload hashes, device/correlation provenance, projection checkpoints and rebuildable projection tables. v1.0 events remain readable; rows without aggregate metadata are retained and are represented as already traversed in the projection checkpoint. Existing rows are not rewritten or removed. Rollback is forward-only and requires application rollback or a reviewed compensating migration, not destructive downgrade.

The API now writes events to PostgreSQL and snapshot/replay reads are implemented. Live Postgres migration/concurrency checks remain blocked until a Docker-enabled database is available. Retention, partitioning, encryption and official tenant rules still need confirmation against the missing master spec.
