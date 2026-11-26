# Phase 02 evidence (2026-11-14)

## Scope and result

Web spike + local checks completed. Live Gate A cloud proof observed on owner machine. Gates B and C denial path remain open.

| Gate | Status | Evidence |
|---|---|---|
| A — cloud SDK source observed | VERIFIED | 2026-11-15 owner run: mode `ONLY_IN_CLOUD`; Observed source `IN_CLOUD`; status success; elapsed ~3549 ms; public text fixture; Chrome 157; SDK 13.3.0. No tokens/project secrets stored here. |
| B — local source + offline observed | PARTIAL | **Unavailable path observed:** `ONLY_ON_DEVICE` fails fast with `Local LanguageModel API not available` / `AI/api-not-enabled` (~18 ms) and does **not** fall back to cloud. **ON_DEVICE success + offline:** BLOCKED on this host — Chrome Prompt API HW needs ≥22 GB free disk and (GPU >4 GB VRAM **or** ≥16 GB RAM + ≥4 cores); measured ~7.2 GB free on E:, ~2.3 GB on C:, ~7.9 GB RAM, Intel HD 4000 ~2 GB. Flags alone cannot unlock the model here. |
| C — App Check enforced with valid + denied request | PARTIAL | Valid attestation inferred from successful Gate A under local App Check debug. Intentional denied request (debug off / bad token) and console **Enforced** screenshot still required. |

## Commands / actual results

| Command | Exit | Result |
|---|---:|---|
| Read `AGENTS.md`, `docs/BUILD_STATE.md`; search `prompts/reference/*` | 0 | References read. Required three prompt references remain absent. |
| Official Web hybrid + configuration-options + JS AI reference (2026-11-14) | 0 | SDK pin `13.3.0`; modes; `initializeDeviceModel`; default cloud model `gemini-3.5-flash-lite`; `InferenceSource` values `on_device` / `in_cloud` (guide labels `ON_DEVICE` / `IN_CLOUD`). |
| `pnpm install --prefer-offline` | 0 | Linked 462 packages from local store in ~7m; `@firebase/util` and `protobufjs` postinstall allowed via `allowBuilds`. |
| `pnpm --filter @nexus-titan/web typecheck` | 0 | `tsc --noEmit` passed. |
| `pnpm --filter @nexus-titan/web lint` | 0 | ESLint passed after moving `performance.now` into a module-scope helper (react-hooks/purity). |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 production build; routes `/`, `/_not-found`, `/firebase-spike`. |
| `pnpm -r test` | 0 | Contracts: 2 passed. |
| `pnpm firebase:check` | 0 | Config assertions (3) + inferenceSource/fixture adapter assertions (2 groups) passed. |
| `npm install -g firebase-tools@latest` | interrupted / incomplete | Node 26.5.0; `superstatic` engine wants 20/22/24. Install remained incomplete; CLI not verified on PATH. |
| `pnpm add -D firebase-tools@14.27.0 -w` | 1 | Resolved then failed `ERR_PNPM_IGNORED_BUILDS` for `re2@1.27.1`. Dependency **removed** from workspace (CLI stays out-of-band). |
| `pnpm install --lockfile-only` (after removal) | 0 | Lockfile clean; no `firebase-tools` entry. |
| Chrome `--version` | 0 | Google Chrome 157.0.8103.78 |
| `where adb` / `swift` / `xcodebuild` | not found | Native Android/Apple proof blocked on this Windows host. |
| Gate A live `ONLY_IN_CLOUD` | observed | `IN_CLOUD`, success, ~3549 ms (sanitized; no token/response body archived). |
| Gate B / Gate C denial | SKIPPED | Not yet executed. |

## Sanitized local proof schema

Browser `localStorage` key `nexus-firebase-spike-proof-v1` stores only: UTC `at`, `mode`, SDK-mapped `actualSource`, `status`, `elapsedMs`, `fixtureId`, optional `errorName`. No prompts, response bodies, tokens, or project IDs.

## Migration / risk

No Phase 01 wire contract or persistence schema change. ADR-0010 records the spike decision. Firebase JS remains exact pin `13.3.0`. App Check debug tokens must never appear in evidence. Optional JPEG under `apps/web/public/fixtures/public-router-sample.jpg` is public fixture bytes only and is never selected for PREFER_* or cloud modes.

## Next safe action

1. Gate B ON_DEVICE success needs a machine meeting Chrome built-in AI hardware (or cloud VM/BrowserStack with eligible Chrome). Free ≥22 GB disk first if retrying locally.
2. Gate C: confirm AI Logic App Check **Enforced**; capture a denied request (debug off / bad token) to pair with Gate A’s valid success.
