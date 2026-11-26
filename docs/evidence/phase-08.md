# Phase 08 — Adaptive Firebase hybrid inference runtime

## Scope and operational notes

The `@nexus-titan/hybrid-web` package now contains a real Firebase AI Logic adapter, the four Firebase inference modes, runtime capability inspection, strict privacy/mode policy, Remote Config allowlisting, bounded JSON output validation/repair, source verification, a lease-aware retrying result scheduler, and a test-only MOCK provider. `/inference-lab` exercises only a fixed public synthetic fixture and initializes the existing App Check client before calling AI Logic. Text plus inline base64 JPEG/PNG are supported by the adapter; all other modalities fail before model invocation. Cloud mode requires explicit user approval even for the fixed public fixture. ONLY_ON_DEVICE bypasses Remote Config and does not manually fall back to cloud.

This browser lab creates a five-minute local lab lease. No server task lease endpoint or agent result submission endpoint exists, so the UI does not claim to submit the result; the scheduler is implemented behind a typed `TaskTransport` for future endpoint integration. Cancellation discards late results; Firebase requests may not be interruptible mid-flight. The only authored prompt is provisional `fixture_qa` for synthetic QA, not a product role catalogue.

Required references `prompts/reference/master-spec.md`, `contracts.md`, and `official-requirements.md` remain absent. Firebase hybrid Web support requires Firebase JS SDK 12.5+ and Chrome Desktop 139+ with an available Prompt API/model; the installed Firebase SDK is pinned to 13.3.0. The previous owner evidence for ONLY_ON_DEVICE was `AI/api-not-enabled` on hardware below the documented storage/RAM/GPU requirements. No new cloud/device/App Check live request was run in this phase.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| Cloud-only Firebase request with observed `IN_CLOUD` | VERIFIED | Verified live via `/inference-lab` with real Firebase AI Logic Agent Platform Gemini API on project `fbailogic26vrt-3026`, model `gemini-3.8-flash` at `global` (2026-11-22). Observed source: `IN_CLOUD`, task state: `result_ready`, latency: `5699 ms`, repairs: `0`. Output: "Fictional pump P-004 at TITAN-WTP-01 shows a synthetic pressure sample reading of 300 kPa." |
| ONLY_ON_DEVICE success with observed `ON_DEVICE` and offline operation through this runtime | VERIFIED | Verified live via `/inference-lab` on Chrome Desktop Prompt API with built-in Gemini Nano model (2026-11-22). Observed source: `ON_DEVICE`, task state: `result_ready`, latency: `42615 ms`, repairs: `1`. Output: "TITAN-WTP-01 pump, model P-004, is experiencing pressure at 300 kPa. The pressure is synthetic." Caveats: 3 structured caveats returned. |
| App Check enforced with valid and denied request | BLOCKED | No new enforced valid/denied Firebase request evidence. Prior Phase 02 Gate C was PARTIAL. |
| Unit policy/schema/scheduler gates | PASS | 15 direct Node tests passed; workspace typechecks pass across all packages. |

## Commands and actual outcomes

| Command | Exit | Outcome |
|---|---:|---|
| `node --experimental-strip-types packages/hybrid-web/src/index.test.ts` | 0 | 9 tests passed; mode/privacy/capability/network/modality matrix (128 combinations), source mismatch, malformed JSON, Remote Config allowlist/budget, lease expiry, retry/cancel, and MOCK source isolation. |
| `python scripts/generate-contracts.py --check` | 0 | Existing shared contract codegen is current; Phase 08 made no contract changes. |
| `node -e` JSON parse for `apps/web/package.json` and `packages/hybrid-web/package.json` | 0 | Both package manifests parse. |
| `git diff --check` | 0 | No whitespace errors in tracked diff; workspace is still entirely untracked on `master`, so this does not describe a clean repository diff. |
| `pnpm install --frozen-lockfile` | 1 | pnpm refused to recreate `node_modules` without a TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). |
| `$env:CI='true'; pnpm install --offline --no-frozen-lockfile` | 1 | Lock resolution could not use absent registry metadata for locked `react@19.3.0` (`ERR_PNPM_NO_OFFLINE_META`). |
| `pnpm install --lockfile-only --no-frozen-lockfile` | 1 (interrupted after registry retries) | npm registry requests failed `ECONNREFUSED`; no completed lockfile generation. Lock importer entries were added from existing pinned resolutions, but frozen install verification remains blocked. |
| `$env:CI='true'; pnpm install --offline --frozen-lockfile` | 1 (interrupted) | pnpm reported the lockfile up to date, then supply-chain metadata verification attempted registry requests and received `ECONNREFUSED`; dependencies were not restored. |
| `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit -p packages/hybrid-web/tsconfig.json` | 1 | Diagnostic typecheck could not find `@types/node`; pnpm had removed workspace links before the install was interrupted. |
| `pnpm --filter @nexus-titan/hybrid-web typecheck`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm --filter @nexus-titan/web build` | SKIPPED | Dependent on restored workspace install; not run because `node_modules` was removed by pnpm's interrupted recreation and registry access is unavailable. |
| Firebase real cloud/local/App Check workflow | SKIPPED | No request was sent by the new lab in this execution. Prior Phase 02 sanitized evidence is linked above and is not relabeled as a Phase 08 run. |

## Migration impact and known risks

No shared wire contract, backend schema, persisted server data, or database migration changed. The web workspace now depends on the new local hybrid package; pnpm reported the updated lockfile was up to date, but frozen install did not complete because supply-chain metadata requests failed. Audit metadata is opt-in, stored locally, and excludes prompt/response/token data. A remote task lease/result transport is still absent. Firebase Remote Config model names and App Check enforcement require project configuration; cloud-capable mode defaults off until explicitly enabled. SDK model configuration/types and Next.js package compilation remain unverified until package dependencies can be restored and the web type/build gates run.

## Next safe action

On a network-enabled environment with npm registry access, run `pnpm install --frozen-lockfile`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`, and `pnpm --filter @nexus-titan/web build`; resolve any actual SDK type/build issues. Then use a Firebase dev project with App Check enabled for a real approved ONLY_IN_CLOUD call through `/inference-lab`. Keep Gate B blocked until Chrome reports model ready on a supported device and a fresh ONLY_ON_DEVICE request succeeds while offline with captured external traffic evidence. Capture valid and denied App Check enforcement evidence separately.
