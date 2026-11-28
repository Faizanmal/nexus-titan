# Judge Retest & Final Polish Verification Evidence

- **Date:** 2026-11-28 (Nov 28, 02:29 AM IST)
- **Target Routes:** `/demo`, `/firebase-spike`, `/inference-lab`
- **Verification Environment:** Automated Smoke & Regression Suites (`tests/judge-browser-smoke.test.mjs`, `services/api/tests/test_judge_entry_regression.py`, `apps/web/tests/accessibility.test.mjs`, `services/api/tests/test_demo_flagship_scenario.py`) + Source Code Inspection.
- **Browser Attach Note:** Direct Chrome DevTools MCP attach from the CLI runner failed (`ENOENT: no such file or directory, C:\Users\user\AppData\Local\Google\Chrome\User Data\DevToolsActivePort` because remote debugging was not active on the host Chrome profile). Therefore, no live browser observation is claimed by the automated runner below; every check is honestly labeled `code/automated` in the `Observed` column.

---

## 1. Retest Checklist (`/demo` & `/firebase-spike`)

| # | Check | Observed | Status | Verification Details |
|---:|---|---|---|---|
| 1 | **0 step POSTs while idle after sandbox sign-in** | `code/automated` | **PASS** | `onAuthStateChanged` and `handleDedicatedJudgeSignIn` in `apps/web/src/app/demo/page.tsx` deduplicate via `onboardedUidRef` and invoke only `POST /v1/demo/judge/onboard`. Zero `POST /v1/demo/scenario/step` requests fire while idle. |
| 2 | **Each Stage 1–5 click runs its full step list once** | `code/automated` | **PASS** | Guarded by `stepInFlightRef` and `runningStage` in `apps/web/src/app/demo/page.tsx`:<br>• **Stage 1:** `baseline` → `fault_injection` → `evidence_capture` (3 POSTs)<br>• **Stage 2:** `local_ai_offline` (1 POST)<br>• **Stage 3:** `redaction_approval` → `peer_transfer` → `canonical_sync` → `cloud_inference` (4 POSTs)<br>• **Stage 4:** `causal_agent_dag` → `solver_scenarios` → `stale_approval_test` → `supervisor_approval` (4 POSTs)<br>• **Stage 5:** `twin_update` → `replay` (2 POSTs) |
| 3 | **Stage 4 shows `"HTTP 409 CONFLICT"` with the API message** | `code/automated` | **PASS** | Stage 4 Concurrency Safety Gate renders badge `HTTP 409 CONFLICT` and body `"CONFLICT_PREVENTED: The scenario topology or world snapshot changed since the intervention was proposed."` (`services/api/src/nexus_titan_api/demo_routes.py:1101`, verified in `tests/judge-browser-smoke.test.mjs` and `services/api/tests/test_demo_flagship_scenario.py`). |
| 4 | **Offline blocks Stage 3** | `code/automated` | **PASS** | When `isOffline` is true, `runStage(3)` and `runStep("cloud_inference")` block before any network egress and display `NETWORK_OFFLINE: Cloud handoff blocked while in offline simulation. Switch network to online to proceed.` persistently (both in the top banner and inline in Stage 3) until the user changes the network toggle (`handleSetOffline`) or runs another stage. Top-bar network pill synchronizes to `Offline · simulated airgap`. |
| 5 | **Reset clears everything** | `code/automated` | **PASS** | `resetSession()` clears `stepData`, `traceHistory` (`0 Recorded Steps`), `stage3ConsentGranted`, and `isOffline`, restores Stage 1 baseline, synchronizes the top-bar network pill back to `Online`, and posts to `/v1/demo/session/reset` (verified in `tests/judge-browser-smoke.test.mjs`). |
| 6 | **`/firebase-spike` `PREFER_ON_DEVICE` shows the honest fallback label** | `code/automated` | **PASS** | At run start, clears previous status/error and displays `Checking device model…` while in flight. When `mode === "PREFER_ON_DEVICE"` and `actualSource !== "ON_DEVICE"`, displays `Device model: Device model unavailable, fell back to cloud`. For `PREFER_IN_CLOUD` with a cloud result, displays `Device model: Cloud (preferred mode)`. For `ONLY_IN_CLOUD`, displays `Device model: Not checked (cloud-only mode)`. |

---

## 2. Live Retest Additions Verified

| Item | Target | Observed | Status | Resolution Verified |
|---|---|---|---|---|
| **Neutral on-device fallback text** | `apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts:361`<br>`services/api/src/nexus_titan_api/demo_routes.py:621` | `code/automated` | **PASS** | Replaced legacy hardware floor strings with `"On-device model not available"`. Updated `services/api/tests/test_demo_flagship_scenario.py` and `tests/judge-browser-smoke.test.mjs`. |
| **WCAG AA Contrast ($\ge 4.5:1$)** | `/demo` (`apps/web/src/app/demo/page.tsx`, `apps/web/src/app/globals.css`) | `code/automated` | **PASS** | Bridged `text-slate-950`, `text-amber-950`, `text-amber-900`, `text-emerald-950`, `text-emerald-900`, `text-indigo-950`, `text-indigo-900`, `text-blue-950`, `text-blue-900`, and pastel surface tokens (`bg-emerald-50*`, `bg-indigo-50*`, `bg-amber-50*`, `bg-blue-50*`) in `globals.css` and removed `to-white` gradient bleed on `/demo`. Verified readable contrast ($\ge 4.5:1$) via `pnpm a11y:check` and `pnpm design:check`. |
| **Persistent offline Stage 3 notice & top-bar network pill** | `/demo` (`apps/web/src/app/demo/page.tsx`, `apps/web/src/components/command-center-shell.tsx`) | `code/automated` | **PASS** | Prevented background judge onboarding from clearing `NETWORK_OFFLINE` and deduplicated `handleDedicatedJudgeSignIn` onboarding. Added inline Stage 3 `NETWORK_OFFLINE` alert banner that persists until the user toggles the network or runs another stage. Synchronized `CommandCenterShell` top-bar `StatusIndicator` with the demo `isOffline` toggle via `nexus-network-simulation` custom events. |
| **`/firebase-spike` in-flight, `PREFER_IN_CLOUD`, & `ONLY_IN_CLOUD` status** | `apps/web/src/app/firebase-spike/page.tsx`<br>`apps/web/src/lib/firebase/provider.ts` | `code/automated` | **PASS** | Cleared `message` and `download` at run start (`Checking device model…`). Removed premature `Device model ready` callback prior to `generateContent()` resolution during `PREFER_*` requests. Reported `"Device model unavailable, fell back to cloud"` only for `PREFER_ON_DEVICE`, `"Cloud (preferred mode)"` for `PREFER_IN_CLOUD` when executed in cloud, and `"Not checked (cloud-only mode)"` for `ONLY_IN_CLOUD`. |
| **`/inference-lab` & `/demo` Stage 2 `getNanoStatus()` readiness** | `packages/hybrid-web/src/capabilities.ts`<br>`apps/web/src/app/inference-lab/page.tsx`<br>`apps/web/src/app/demo/page.tsx` | `code/automated` | **PASS** | Initialized `nanoStatusText` and `nanoBadgeText` on `/demo` to `"Checking Gemini Nano…"` until `getNanoStatus()` resolves. Handled `avail === "unavailable"` explicitly in `prepareGeminiNano()` (and preserved `"Gemini Nano unavailable — Prompt API (LanguageModel) missing (simulated fallback)"` when `LanguageModel` is absent) so `getNanoStatus()` returns the real device status instead of `"Chrome Prompt API detected; model status checking."` |

---

## 3. Automated Command Execution Results

| Command | Exit Code | Result Summary |
|---|---:|---|
| `pnpm -r lint` | `0` | Passed across `@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, and `@nexus-titan/web` (0 errors, 0 warnings). |
| `pnpm -r typecheck` | `0` | Passed strict TypeScript checks across all workspace packages. |
| `pnpm --filter @nexus-titan/web build` | `0` | Next.js 16.4.5 (Turbopack) production build succeeded; all 23 routes compiled and prerendered. |
| `pnpm a11y:check` | `0` | 9/9 accessibility and WCAG 2.1 AA contrast suites passed. |
| `pnpm design:check` | `0` | 8/8 design system token bridge and route suites passed. |
| `pnpm test:suites` | `0` | All 14 workspace verification and browser smoke test suites passed. |
| `uv run --project services/api pytest` | `0` | **182 passed**, 3 deprecation warnings in 7.89s. |

---

## 4. Technical Verification & Evidence Alignment (Phase 34)

| Technical Critique Area | Implementation & Evidence Alignment | Observed | Status |
|---|---|---|---|
| **Stage 2 Offline Inference Resilience** | Decoupled Stage 2 (`local_ai_offline`) from synchronous network calls. When offline or disconnected, computes & renders triage result locally on-device, persists to offline outbox in `sessionStorage` (`nexus_offline_outbox`), and flushes queued item to API upon reconnect or Stage 3 start (`syncPendingOfflineOutbox()`). Zero network POSTs required to complete Stage 2. | `code/automated` | **PASS** |
| **Cryptographic Cloud Consent Binding** | Operator consent is bound to the exact de-identified payload preview bytes and SHA-256 digest (`sanitized.consent_hash`). Any subsequent mutation to evidence parameters immediately invalidates consent (`sanitized.consent_hash !== approvedConsentHash`), forcing re-review before `cloud_inference` is permitted. | `code/automated` | **PASS** |
| **Independent Replay SHA-256 Verification** | Authored `canonicalJsonString` (RFC 8785 canonical key ordering matching Python `json.dumps(obj, sort_keys=True, separators=(',', ':'))`). `runStep("replay")` recomputes SHA-256 over `timeline` in browser via `crypto.subtle.digest` and verifies against backend `deterministic_replay_hash`. End-to-end completion message strictly gates on `stepData["replay"]`. | `code/automated` | **PASS** |
| **Comparison Metrics & Evidence Labels** | Sample size tag shows `"Pending execution"` until stages run; baseline latency labeled as `"Baseline simulated benchmark: cloud batch telemetry model"`; payload size labeled as measured via de-identification pipeline. | `code/automated` | **PASS** |
| **Root Package Resolution** | Linked `@nexus-titan/contracts` and `@nexus-titan/hybrid-web` in root `devDependencies` so all standalone test scripts in `tests/` resolve without module missing errors. | `code/automated` | **PASS** |

