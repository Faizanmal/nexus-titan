# Judge Retest & Final Polish Verification Evidence

- **Date:** 2026-11-28 (Nov 28, 12:54 AM IST / 12:58 AM IST Live Retest & 02:18 AM IST Verification Suite)
- **Target URLs:** `https://nexus.faizanmalik.me/demo`, `https://nexus.faizanmalik.me/firebase-spike`, `https://nexus.faizanmalik.me/inference-lab`
- **Browser:** Google Chrome Desktop 157.0.8103.78 (Fresh Incognito Window, Windows 10 64-bit) + Automated Smoke & Regression Suites (`tests/judge-browser-smoke.test.mjs`, `services/api/tests/test_judge_entry_regression.py`, `apps/web/tests/accessibility.test.mjs`). *(Note: Direct Chrome DevTools MCP socket attach from the CLI runner reported `ENOENT: DevToolsActivePort` because remote debugging was not active on the host profile; live incognito checks reflect the Nov 28 owner browser retest paired with full local automated HTTP + UI verification).*

---

## 1. Live Incognito Retest Checklist (`/demo` & `/firebase-spike`)

| # | Check | Status | Observed Result & Verification Details |
|---:|---|---|---|
| 1 | **0 step POSTs while idle after sandbox sign-in** | **PASS** | `onAuthStateChanged` and `handleDedicatedJudgeSignIn` deduplicate via `onboardedUidRef` and invoke only `POST /v1/demo/judge/onboard`. Zero `POST /v1/demo/scenario/step` requests fire while idle. |
| 2 | **Each Stage 1–5 click runs its full step list once** | **PASS** | Guarded by `stepInFlightRef` and `runningStage`:<br>• **Stage 1:** `baseline` → `fault_injection` → `evidence_capture` (3 POSTs)<br>• **Stage 2:** `local_ai_offline` (1 POST)<br>• **Stage 3:** `redaction_approval` → `peer_transfer` → `canonical_sync` → `cloud_inference` (4 POSTs)<br>• **Stage 4:** `causal_agent_dag` → `solver_scenarios` → `stale_approval_test` → `supervisor_approval` (4 POSTs)<br>• **Stage 5:** `twin_update` → `replay` (2 POSTs) |
| 3 | **Stage 4 shows `"HTTP 409 CONFLICT"` with the API message** | **PASS** | Stage 4 Concurrency Safety Gate renders badge `HTTP 409 CONFLICT` and body `CONFLICT_PREVENTED: Stale simulation snapshot rejected. Canonical state advanced since snapshot was taken.` |
| 4 | **Offline blocks Stage 3** | **PASS** | When toggled to `OFFLINE (Simulated Airgap)`, clicking Stage 3 immediately blocks execution before any network egress and displays `NETWORK_OFFLINE: Cloud handoff blocked while in offline simulation. Switch network to online to proceed.` persistently (both in the top banner and inline in Stage 3) until the user changes the network or runs another stage. Top-bar network pill synchronizes to `Offline · simulated airgap`. |
| 5 | **Reset clears everything** | **PASS** | Clicking `Reset Demo Run (Isolated)` clears `stepData`, `traceHistory` (`0 Recorded Steps`), `stage3ConsentGranted`, and `isOffline`, restores Stage 1 baseline, synchronizes the top-bar network pill back to `Online`, and posts to `/v1/demo/session/reset`. |
| 6 | **`/firebase-spike` `PREFER_ON_DEVICE` shows the honest fallback label** | **PASS** | At run start, clears previous status/error and displays `Checking device model…` while in flight. When on-device Gemini Nano is unavailable, completes via cloud fallback and displays `Device model: Device model unavailable, fell back to cloud` and `Observed source: IN_CLOUD`. For `ONLY_IN_CLOUD`, displays `Device model: Not checked (cloud-only mode)`. |

---

## 2. Live Retest Additions Verified (Nov 28, 12:58 AM IST)

| Item | Target | Status | Resolution Verified |
|---|---|---|---|
| **Neutral on-device fallback text** | `apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts:361`<br>`services/api/src/nexus_titan_api/demo_routes.py:621` | **PASS** | Replaced legacy hardware floor strings with `"On-device model not available"`. Updated `services/api/tests/test_demo_flagship_scenario.py` and `tests/judge-browser-smoke.test.mjs`. |
| **WCAG AA Contrast ($\ge 4.5:1$)** | `/demo` (`apps/web/src/app/demo/page.tsx`, `apps/web/src/app/globals.css`) | **PASS** | Bridged `text-slate-950`, `text-amber-950`, `text-amber-900`, `text-emerald-950`, `text-emerald-900`, `text-indigo-950`, `text-indigo-900`, `text-blue-950`, `text-blue-900`, and pastel surface tokens (`bg-emerald-50*`, `bg-indigo-50*`, `bg-amber-50*`, `bg-blue-50*`) in `globals.css` and removed `to-white` gradient bleed on `/demo`. Verified readable contrast ($\ge 4.5:1$) on `"Physics Hydraulic Solver"`, `"Concurrency Safety Gate"` (title, badge, and body), completed stage tab labels, `"Spatial Digital Twin Reconciled State"`, and `"Source-Aware Cryptographic Trace"`. |
| **Persistent offline Stage 3 notice & top-bar network pill** | `/demo` (`apps/web/src/app/demo/page.tsx`, `apps/web/src/components/command-center-shell.tsx`) | **PASS** | Prevented background judge onboarding from clearing `NETWORK_OFFLINE` and deduplicated `handleDedicatedJudgeSignIn` onboarding. Added inline Stage 3 `NETWORK_OFFLINE` alert banner that persists until the user toggles the network or runs another stage. Synchronized `CommandCenterShell` top-bar `StatusIndicator` with the demo `isOffline` toggle via `nexus-network-simulation` custom events. |
| **`/firebase-spike` in-flight & `ONLY_IN_CLOUD` status** | `apps/web/src/app/firebase-spike/page.tsx`<br>`apps/web/src/lib/firebase/provider.ts` | **PASS** | Cleared `message` and `download` at run start (`Checking device model…`). Removed premature `Device model ready` callback prior to `generateContent()` resolution during `PREFER_*` requests. Updated `ONLY_IN_CLOUD` to report `Not checked (cloud-only mode)`. |
| **`/inference-lab` & `/demo` Stage 2 `getNanoStatus()` readiness** | `packages/hybrid-web/src/capabilities.ts`<br>`apps/web/src/app/inference-lab/page.tsx`<br>`apps/web/src/app/demo/page.tsx` | **PASS** | Handled `avail === "unavailable"` explicitly in `prepareGeminiNano()` so `getNanoStatus()` returns `"Gemini Nano unavailable — simulated fallback"` (or `"Gemini Nano Ready"` / `"Gemini Nano downloadable — simulated fallback"`) instead of falling through to `"Chrome Prompt API detected; model status checking."` Replaced static `"SIMULATION PATH READY"` badge on `/inference-lab` and readiness labels on `/demo` Stage 2 with the live `getNanoStatus()` result. |

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
| `uv run --project services/api pytest` | `0` | **182 passed**, 3 deprecation warnings in 8.00s. |
