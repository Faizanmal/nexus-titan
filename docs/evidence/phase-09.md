# Phase 09 — Offline state and encrypted local vault

Date: 2026-11-15 (Asia/Calcutta)

## Implementation outcome

- Added versioned service-worker app shell caching for `/`, `/world`, `/fieldrelay`, and `/offline`, plus approved `TITAN-WTP-01` public fixture assets and static Next assets. It rejects API/sync/auth/token paths, query/RSC requests, non-GET requests, and cross-origin requests. Fixture fetch is network-first; cached fallback is marked stale-possible.
- Added IndexedDB v1 stores for snapshots, manuals, append-only outbox, inbox, encrypted vault, and metadata-only inference attempts. Restricted vault uses AES-256-GCM, nonextractable per-browser CryptoKey stored via structured clone, fresh random 96-bit nonce per record, and tenant/record/version AAD. Safe outbox rejects confidential and restricted classifications.
- Added bounded outbox recovery/retry primitives (max 10 rows per pass), exponential delay with jitter, duplicate ACK terminal state, conflict/denied states, and crash recovery for running tasks. Immutable outbox event rows and mutable delivery state are separate stores. The runner requires a current matching-tenant offline policy lease; this build does not wire a sender because the server has no lease issuance or sequence/revision reservation API.
- Added `/fieldrelay` for prepared synthetic asset selection, offline fixture snapshot, manual entry, Prompt API capability detection, structured finding edits, artifact preview, safe draft queue, and trace. Actual local inference is disabled because the server has no offline policy lease issuance; the runner independently rejects absent, expired, revoked, or wrong-tenant leases before invoking a sender. Manual entry is explicitly not labeled AI. Restricted data is locally encrypted and cannot be queued.
- Sign out and organization switch clear authorized IndexedDB records after warning about pending drafts. Quota failure evicts rebuildable attempts/manuals/snapshots once; outbox, inbox, and vault are never auto-evicted. Local vault/XSS/device-compromise limitations and native Keychain/Keystore direction are documented in ADR-0017.

## Contract and migration impact

- Existing sync API contract remains v1.3.0: PUBLIC/INTERNAL device event rules remain authoritative. No new server-issued offline policy lease contract exists, so offline writes remain local drafts and are not sync-authorized. No shared wire contract or SQL schema migration was made.
- New local IndexedDB database `nexus-offline-v1` schema version 1. Clearing it deletes local data and any pending draft for the confirmed organization/account. No Yjs dependency or collaborative annotation data was introduced; authoritative state remains revisioned through the existing sync API.

## Checks run

| Command | Exit/status | Result |
|---|---:|---|
| `node --experimental-strip-types packages/hybrid-web/src/index.test.ts` | 0 | 14 passed, 0 failed; includes expired/revoked lease no-send gate, retry bound/jitter, and restricted/confidential outbox rejection. These do not exercise browser IndexedDB or service-worker runtime. |
| `python scripts/generate-contracts.py --check` | 0 | Generated shared contract artifacts current. |
| `node --check apps/web/public/service-worker.js` | 0 | Service worker parses as JavaScript; this does not exercise browser caching behavior. |
| `git diff --check` | 0 | No whitespace errors. Repository files remain untracked on `master`; there is no commit baseline. |
| `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit -p packages/hybrid-web/tsconfig.json` | 1 | Blocked before source diagnostics: inherited `types: ["node"]` cannot resolve workspace `@types/node` link. |
| `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` | 1 | Dependency links unavailable (`react`, `next`, Firebase, workspace packages, Node types); diagnostics cannot validate this change. |
| `pnpm --filter @nexus-titan/hybrid-web test; pnpm --filter @nexus-titan/hybrid-web typecheck; pnpm --filter @nexus-titan/web typecheck; pnpm --filter @nexus-titan/web lint; pnpm --filter @nexus-titan/web build` | Interrupted | pnpm began supply-chain metadata checks and repeatedly hit npm registry `ECONNREFUSED`; stopped after 30 seconds. No lint/build result claimed. |
| Playwright offline shell/refresh, crash persistence, two-device conflict, duplicate ACK, encryption-at-rest, restricted-marker browser checks | SKIPPED | Playwright is not declared in workspace dependencies and browser test harness/runtime was not available. |
| Real-device offline model test | SKIPPED | No eligible real device/model verification in this run. |

## Measured results, risks, and remaining gates

- No runtime/browser or model measurements were produced.
- **PARTIAL:** No server policy-lease issuance/revocation endpoint or online sender exists. Cached identity lease remains display-only. No API-level batch ACK or revision conflict UI is connected; UI only lists local queued drafts. Two-device convergence and actual browser IndexedDB crash behavior are unverified.
- Browser WebCrypto nonextractability is not hardware-backed custody. Same-origin XSS, compromised browser/device/profile, malicious extensions, unlocked memory access, and browser eviction can expose or destroy local state. The local Prompt API can be unavailable even after a prepared session; manual path remains usable.
- External dependencies: secure context (HTTPS or localhost), browser IndexedDB/WebCrypto/service-worker support; Chrome Prompt API model and capable device for local AI; npm registry for workspace dependency restoration; server policy lease and batch sync API for authorized synchronization.
- Next safe action: restore pnpm workspace dependency links on a registry-enabled environment; run web/hybrid lint, typecheck, build, and Playwright offline/vault acceptance. Then design and implement scoped expiring/revocable offline leases and revision/cursor reservation with API/policy owners before connecting outbox transmission. Run separate real-device offline model verification.
