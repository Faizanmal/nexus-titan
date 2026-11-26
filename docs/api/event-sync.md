# Event synchronization API (contract v1.1.0)

`POST /sync/events` accepts a signed `SyncEventBatch`. `POST /v1/events` remains as a deprecated alias with the same behavior. Authorization uses the verified Firebase user, PostgreSQL organization membership and site scope, and an active registered device key. Sign the exact UTF-8 request body bytes with the registered P-256 ECDSA key and send the base64 signature in `X-Nexus-Device-Signature`. The browser helper `syncSignedEventBatch` signs and sends this body.

Each event is committed independently. It carries a tenant-global `sequence`, an aggregate identity (`site_id`, `aggregate_type`, `aggregate_id`) and `expected_revision`. The server locks the tenant head, requires the next sequence, checks the aggregate revision, validates idempotency by `(tenant_id,event_id)` plus canonical event hash, then writes the event, aggregate head and outbox row in one Postgres transaction. Same ID and same canonical event payload is a duplicate; same ID with another payload, stale sequence, or stale aggregate revision is a conflict. A batch can therefore contain accepted, duplicate, conflict, and policy-denied results. The client must fetch a cursor/snapshot and explicitly resolve a revision conflict.

The current device sync policy accepts only `source=device`, aggregate types `asset` or `incident`, and actions `created`, `updated`, or `deleted`. Device sync may append only PUBLIC or INTERNAL events. Viewers receive per-event `ROLE_FORBIDDEN`; event site access must match the server membership scope. CONFIDENTIAL/RESTRICTED events are denied and never enter the Firestore projection path. Aggregate classification is monotonic toward more restrictive levels.

Reducer behavior is intentionally small and provisional until the absent master spec supplies domain semantics: `*.created` establishes the event payload object; `*.updated` shallow-merges the patch; `*.deleted` writes a tombstone; updates cannot overwrite deleted state. Projections are derived and can be rebuilt. The consumer uses a durable JetStream consumer plus a Postgres inbox primary key to make redelivery idempotent. Firestore projections contain only aggregate metadata and PUBLIC state under `organizations/{tenant}/sites/{site}/projections/{stable-hash}`. Firestore writes compare sequence/revision transactionally; stricter classification and deletion remove public documents.

`GET /sync/events?tenant_id=...&after_sequence=...&limit=...` returns site/classification-scoped replay pages. `GET /sync/snapshot/{tenant_id}` returns current authorized asset/incident projections, `cursor` (the last sequence fully applied by the Postgres projection consumer), and `event_head` (canonical write head). A client can request events after the snapshot cursor to close projection lag; it must not advance to `event_head` until it has reconciled that gap. Organization admins can inspect event delivery dead letters at `/v1/organizations/{organization_id}/events/dead-letters` and requeue a selected event through the sibling `/retry` route. Logs report request and batch counts only, never event payloads.

The `projection-rebuild` task requires both tenant confirmation flags and replays canonical events in sequence order into the Postgres projection table while holding the tenant and projection checkpoint locks. It advances the projection checkpoint atomically, then sequence-guards Firestore writes/deletes so a concurrent newer relay update cannot be overwritten. It prints a deterministic SHA-256 over sorted projection documents. It never deletes events or other tenants' data.

## Local commands

```powershell
python scripts/task.py dev core
docker compose --profile core --profile distributed up --build --wait
python scripts/task.py projection-rebuild --tenant demo-nexus --confirm demo-nexus
```

```bash
python scripts/task.py dev core
docker compose --profile core --profile distributed up --build --wait
python scripts/task.py projection-rebuild --tenant demo-nexus --confirm demo-nexus
```

The worker needs `FIREBASE_PROJECT_ID`; for local projection writes, point `FIRESTORE_EMULATOR_HOST` at the loopback Firestore emulator and set `FIRESTORE_PROJECTIONS_ENABLED=true`. With the flag false (the local default), Firestore delivery remains queued and does not attempt cloud/emulator access; Postgres remains canonical. Keep test project IDs separate from production. Outbox retries use capped exponential backoff and expose a dead-letter queue after ten delivery attempts.
