# Phase 10 — Authenticated intelligence mesh

Date: 2026-11-16 (Asia/Calcutta)

## Implemented

- Added same-tenant authenticated inventory of active registered devices and active registered public-key lookup. Key lookup requires an active owner/admin/operator caller and an eligible active device owner. Revoked or absent device keys return `PEER_DEVICE_UNAVAILABLE`; viewers cannot resolve keys. Existing P-256 private key remains nonextractable and a signing handle helper is available.
- Added version 1 peer capability/invitation/acceptance/envelope types; five-minute tenant/site/device-bound signed ECDH P-256 handshakes; explicit acceptance consent; transcript-bound HKDF-SHA-256 directional AES-GCM keys, per-direction nonce prefixes and short-lived session token; <=60-second expiry-bound signed envelopes; canonical metadata as AES-GCM AAD; sequence-derived nonce and replay guard; protocol downgrade, tenant/site mismatch, unknown capability, key signature, expiry, replay/gap, size and unsafe payload checks.
- Peer content must originate as a reviewed and consented, same-tenant PUBLIC ShareArtifact. Email/serial/marker data is redacted by the existing share-artifact policy; only text annotations/observations can be sealed. Peer envelope send and local bounded queues require runtime cryptographic verification markers. IndexedDB is additively upgraded from v1 to v2 with bounded peer inbox/outbox and separate transfer state stores; peer received data is marked provisional.
- Added bounded IndexedDB peer inbox/outbox (20 per tenant / 50 global outbound; 100 per tenant / 200 global inbound plus byte limits), with separate transfer state. Added WebRTC DataChannel offerer/answerer helpers with an empty ICE server list by default. Added `/mesh`, which renders only authenticated registry records and reports locally observed browser capabilities while remote reachability/capabilities/link/last-sync remain unknown until a real channel and reports exist. No synthetic connected-node state is shown.
- No peer event is appended canonically and no incident action is sent. Phase 05 `/sync/events` still accepts device-source writes only. Peer data must be reviewed and re-synchronized through an authorized device path in a later integration.

## Unimplemented / blocked gates

- No authenticated signaling service, configured ICE/TURN policy or UI flow connects the WebRTC primitives. Pairing/inventory is not a live peer connection. An established partitioned session may survive device revocation until its five-minute expiry; there is no push revocation channel.
- Browser-to-browser pairing, LAN-with-WAN-disabled transfer, reconnect and canonical append-once were not run. Restricted-data detection is based on the existing share redaction rules; these are not a universal data-classification oracle. Peer key retrieval plus user consent must be wired to the WebCrypto primitives before enabling transport.
- Device registry/API tests use the existing fake session boundary; Postgres and real Firebase/App Check were not involved. Native peer discovery is not implemented or verified.
- Official reference files `prompts/reference/master-spec.md`, `contracts.md`, and `official-requirements.md` remain absent.

## Migration and contract impact

- No shared wire contract version or SQL migration changed. Added REST routes `GET /v1/organizations/{organization_id}/devices/peers` and `GET /v1/organizations/{organization_id}/devices/{device_id}/peer-key`; runtime OpenAPI includes both. Existing peer privacy rule already restricts destination `peer/event_replication` to PUBLIC and requires consent.
- IndexedDB database `nexus-offline-v1` now upgrades additively from version 1 to version 2, adding `peer_inbox`, `peer_outbox`, and `peer_transfer_state`. Existing offline queue/vault stores are preserved by `onupgradeneeded`; logout/tenant clear includes the new stores. No server persisted data migration.

## Commands and actual outcomes

| Command | Exit/status | Result |
|---|---:|---|
| `node --experimental-strip-types packages/hybrid-web/src/index.test.ts` | 0 | 15 passed, 0 failed; includes real local WebCrypto key agreement, signature verification, directional AES-GCM decrypt, privacy artifact redaction, explicit consent, tenant mismatch, expired invite/session, invalid signature, replay, envelope oversize and bounded in-memory queue. It does not test browser RTC or IndexedDB. |
| `services/api/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider services/api/tests/test_identity_security.py` | 0 | 14 passed; 3 existing Starlette/FastAPI deprecation warnings. API uses mocked identity/session dependencies. |
| Temporary isolated `tsc` config over `offline.ts`, `peer-mesh.ts`, and `privacy-policy.ts` with DOM libs and workspace contract path mapping | 0 | Peer/offline security core typechecked after correcting WebCrypto buffer and RTCDataChannel typing. Temporary config was removed after the command. This does not typecheck the Next.js page. |
| Standard hybrid package TypeScript check | 1 | Stopped before source diagnostics because workspace `@types/node` link is unavailable (`TS2688`). |
| `python -m compileall -q services/api/src/nexus_titan_api` | 0 | API source syntax compile passed. |
| `python scripts/generate-contracts.py --check` | 0 | Shared contracts remain unchanged/current. |
| `node --check apps/web/public/service-worker.js` | 0 | Service worker syntax check passed. |
| `git diff --check` | 0 | No tracked whitespace errors; repository has no commit baseline and files are untracked. |
| Hybrid/web typecheck, lint and build | BLOCKED | pnpm dependency links remain incomplete from the earlier npm registry `ECONNREFUSED`; this phase did not claim those gates. |
| Playwright/two-browser pairing and real LAN/WebRTC smoke | SKIPPED/BLOCKED | No signaling service/configuration or test harness is wired; no actual transport evidence. |
| WAN-disabled partition/reconnect and server append-once | SKIPPED | Peer transport and canonical resync are not integrated. |
| Native offline discovery | SKIPPED | No Android/iOS transport implementation or native toolchain. |

## Status and next action

**PARTIAL.** Cryptographic and API authorization primitives have deterministic local tests; live peer transport and phase acceptance remain blocked. External dependencies for a production-ready mesh include an authenticated signaling deployment, documented ICE/TURN servers/credentials, two browser devices on a controlled LAN, and restored pnpm dependencies. Next: implement authenticated, expiring signaling with revocation checks, wire registry lookups and the consent UI to handshake/DataChannel, then run the required two-browser LAN/WAN-partition/reconnect scenario and capture real network evidence before enabling peer transfers.
