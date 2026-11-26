# ADR-0011: Local platform profiles and CI gates

- Status: Accepted for local development; pending operational validation on a Docker-enabled host
- Date: 2026-11-15

## Decision

Use pinned local-only Compose services: PostgreSQL 17 with pgvector as canonical persistence, NATS JetStream for future outbox delivery, Temporal's local SQLite dev server for workflow experimentation, Neo4j Community for graph experiments, and an OTel collector that redacts sensitive attribute keys before its local debug exporter. Services use named volumes and loopback host ports. The API readiness route checks the database and required migration. Schema migration 001 owns tenant, event and outbox tables; the demo seed is synthetic and idempotent.

Use profile separation (`core`, `distributed`, `graph`, `observe`) to keep the default local workload small. Synthetic telemetry uses standard PostgreSQL tables and time buckets; Timescale and MQTT remain optional and are not required for the current fixture workload. Firebase emulators cover Auth, Firestore and Storage only; AI Logic remains remote.

## Security and ownership

Postgres is canonical. Local defaults are intentionally scoped to the Compose developer setup and must never be reused in deployments. Demo reset requires an exact tenant and confirmation string and rejects remote database hosts. Request logs omit payloads and secrets. OTel is local-only, uses a debug exporter, and applies key/body redaction before export. Tenant IDs scope all event and outbox primary/foreign keys.

## Migration and rollback

Migration `001_core.sql` is additive and safe to rerun. Existing Phase 00–02 databases have no application schema and require no data transform. For local rollback, stop services and use `docker compose down`; deleting named volumes is destructive and intentionally not part of normal reset. The `reset-demo` command only removes the `demo-nexus` tenant. Future production migration/rollback policy requires a separate decision.

## Consequences

Docker-enabled integration and resource measurements remain required. Temporal uses its dev server and local file persistence, not a production cluster. Derived synthetic telemetry is stored in tenant-scoped Postgres tables with explicit retention. CI separates web/contracts/API, adds core integration and dependency review/scanning; optional native tests are manual dispatch only.
