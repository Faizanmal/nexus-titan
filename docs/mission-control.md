# Mission Control and incident workspace

## Mission Control

`/mission` reads the selected authorized organization's site snapshot, two-hour downsampled pressure series, agent run inventory, simulation runs/approvals and registered peer inventory from authenticated APIs. It labels peer inventory as registration only and does not imply an active link. Asset health is shown only when the source projection contains a health/status field. The overview also exposes snapshot freshness and a site-scoped canonical activity list.

Initial load and reconnect reconcile from the world snapshot. The client then reads `/sync/events` from the projection cursor in bounded batches; an event for the selected site triggers a fresh projection read. It does not cache a speculative snapshot or use fixtures as an operational fallback. Scope changes hide the prior tenant/site content.

## Incidents

`/incidents/[id]` uses stable incident IDs. It reads the selected site's canonical world projection, source state, linked assets, bounded canonical event history, investigations and agent run inventory. Investigation and run creation use existing server authorization, idempotency keys, and conflict responses. Simulation and approval actions continue through `/simulation`, which binds approvals to the source snapshot and exact simulated action.

## Telemetry

The explorer accepts an increasing time window up to 30 days. API interval selection keeps response size bounded by the existing 10,000 bucket server limit. Table pagination is client-side over that bounded server result. Missing buckets and quality are visible; threshold markers use the operator-entered absolute threshold. Downloads are named and tagged as synthetic fixture CSVs.

## Field and demo

`/field` renders the existing FieldRelay component, sharing local evidence, outbox and vault logic. Evidence upload is limited to 10 MiB for browser preview; raw bytes stay in page memory and are not copied into the sync outbox. The safe share preview carries file metadata only. Restricted findings continue to use the encrypted local vault. Offline model invocation remains gated by the absent server policy lease.

`/demo` gives the scenario onboarding steps and posts reset requests to `/v1/demo/reset`. The API requires an active owner membership on `demo-nexus`, exact phrase `RESET demo-nexus`, `APP_ENV=local`, and a loopback/local PostgreSQL hostname. Reset deletes the complete local tenant and does not automatically seed it again.

All current world/telemetry measures are synthetic. The peer panel is device registry inventory; queued agent work is not described as executed because Temporal workers remain unavailable. See [phase-17 evidence](evidence/phase-17.md).
