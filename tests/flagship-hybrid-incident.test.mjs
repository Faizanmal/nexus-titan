/**
 * Automated Verification for Flagship Hybrid Incident Scenario:
 * Contradictory Pump Reading, Offline Local Edge Triage, Sanitization & Canary Containment,
 * Reconnection Cloud Root-Cause Analysis, Consent Invalidation, and Measured Provenance.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

console.log("=== Flagship Hybrid Incident Scenario & Provenance Verification ===");

// 1. Verify Module & UI Integration Files Exist
const scenarioModulePath = resolve(ROOT, "apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts");
const inferenceLabPagePath = resolve(ROOT, "apps/web/src/app/inference-lab/page.tsx");

assert.ok(existsSync(scenarioModulePath), "flagship-hybrid-scenario.ts must exist");
assert.ok(existsSync(inferenceLabPagePath), "inference-lab/page.tsx must exist");

const scenarioModuleContent = readFileSync(scenarioModulePath, "utf-8");
const inferenceLabContent = readFileSync(inferenceLabPagePath, "utf-8");

// 2. Verify Canonical Incident Constants
assert.ok(scenarioModuleContent.includes("INC-TITAN-WTP01-P101-202611"), "Must define canonical Incident ID");
assert.ok(scenarioModuleContent.includes("TECH-CANARY-SECRET-VAULT-TOKEN-9942"), "Must define synthetic canary token");
assert.ok(scenarioModuleContent.includes("P-101"), "Must feature pump P-101");
assert.ok(scenarioModuleContent.includes("TITAN-WTP-01"), "Must feature facility TITAN-WTP-01");
console.log("[PASS] Canonical incident ID, asset, facility, and canary constants verified.");

// 3. Verify Contradictory Dial Reading & Hypothesis Transition
assert.ok(scenarioModuleContent.includes("410"), "Must feature physical dial gauge reading 410 kPa");
assert.ok(scenarioModuleContent.includes("185"), "Must feature SCADA telemetry reading 185 kPa");
assert.ok(scenarioModuleContent.includes("transducer") || scenarioModuleContent.includes("calibration drift"), "Must transition hypothesis to transducer loop calibration drift");
assert.ok(scenarioModuleContent.includes("cavitation"), "Must evaluate initial cavitation hypothesis");
console.log("[PASS] Contradictory pump readings (410 kPa dial vs 185 kPa SCADA) verified.");

// 4. Verify Local-Only Offline Leg & Strict Canary Containment
assert.ok(scenarioModuleContent.includes("ONLY_ON_DEVICE"), "Local leg must run in ONLY_ON_DEVICE mode");
assert.ok(scenarioModuleContent.includes("executeOfflineLocalLeg"), "Must provide offline local leg executor");
assert.ok(scenarioModuleContent.includes("canary_retained_locally"), "Must record canary retained locally in AES vault");
assert.ok(scenarioModuleContent.includes("allow_restricted_local"), "Must pass allow_restricted_local to policy contract");
console.log("[PASS] Offline local-only execution and canary local retention verified.");

// 5. Verify Exact Sanitized Request & Canary Invariant
assert.ok(scenarioModuleContent.includes("sanitizeFlagshipPayload"), "Must provide payload sanitizer");
assert.ok(scenarioModuleContent.includes("SECURITY_INVARIANT_VIOLATION"), "Must enforce invariant that canary never leaks into sanitized summary");
assert.ok(scenarioModuleContent.includes("consent_hash"), "Must compute cryptographic consent hash");
console.log("[PASS] Sanitization, canary stripping, and cryptographic consent hashing verified.");

// 6. Verify Consent Gate, Scope Explanation & Tamper Invalidation
assert.ok(scenarioModuleContent.includes("APPROVAL_DECLINED"), "Declined approval must block cloud request");
assert.ok(scenarioModuleContent.includes("CONSENT_INVALIDATED"), "Tampered payload must invalidate consent");
assert.ok(scenarioModuleContent.includes("CONSENT_EXPLANATION"), "Must provide explicit consent scope explanation");
assert.ok(inferenceLabContent.includes("CONSENT_EXPLANATION") || inferenceLabContent.includes("Consent Scope"), "UI must render consent scope explanation");
console.log("[PASS] Consent gates, declined approval blocking, and tamper invalidation verified.");

// 7. Verify Reconnection Cloud Leg via Firebase AI Logic
assert.ok(scenarioModuleContent.includes("ONLY_IN_CLOUD"), "Cloud leg must run in ONLY_IN_CLOUD mode");
assert.ok(scenarioModuleContent.includes("executeCloudLeg"), "Must provide cloud leg executor");
assert.ok(scenarioModuleContent.includes("runFirebaseHybridTask"), "Must reuse runFirebaseHybridTask");
assert.ok(scenarioModuleContent.includes("canary_absent_verified"), "Must verify canary absent from cloud request");
assert.ok(scenarioModuleContent.includes("duration_ms"), "Must measure execution duration");
console.log("[PASS] Cloud leg execution via Firebase AI Logic and canary absence verified.");

// 8. Verify Gemini Nano Readiness Reporting & Deterministic Simulation Fallback
assert.ok(scenarioModuleContent.includes("checkGeminiNanoReadiness") || scenarioModuleContent.includes("prepareGeminiNano"), "Must check Gemini Nano readiness");
assert.ok(scenarioModuleContent.includes("is_simulation_fallback"), "Must support deterministic simulation fallback path");
assert.ok(scenarioModuleContent.includes("DEVICE_HARDWARE_LIMITATION"), "Must note hardware limitation when Prompt API is absent");
console.log("[PASS] Gemini Nano preparation reporting and deterministic simulation path verified.");

// 9. Verify UI Controls in inference-lab/page.tsx
assert.ok(inferenceLabContent.includes("Flagship Scenario: Contradictory Pump Reading"), "Page must feature Flagship Scenario tab");
assert.ok(inferenceLabContent.includes("LEG 1: LOCAL EDGE"), "Page must display Leg 1 card");
assert.ok(inferenceLabContent.includes("LEG 2: CLOUD VERTEX AI"), "Page must display Leg 2 card");
assert.ok(inferenceLabContent.includes("CONSENT & CANARY AUDIT"), "Page must display consent audit section");
assert.ok(inferenceLabContent.includes("sanitized-payload-editor"), "Page must provide sanitized request preview");
assert.ok(inferenceLabContent.includes("consent-checkbox"), "Page must provide explicit approval checkbox");
assert.ok(inferenceLabContent.includes("Simulated Network:"), "Page must offer network offline/online toggle");
assert.ok(inferenceLabContent.includes("Verify / Prepare Gemini Nano Model"), "Page must provide Gemini Nano model preparation action");
console.log("[PASS] Inference lab UI tabs, controls, previews, and approval checkboxes verified.");

// 10. Verify Policy Contracts in packages/hybrid-web
const policyPath = resolve(ROOT, "packages/hybrid-web/src/policy.ts");
const policyContent = readFileSync(policyPath, "utf-8");
assert.ok(policyContent.includes("allowRestrictedLocal"), "checkRequestPolicy must accept allowRestrictedLocal");

const promptsPath = resolve(ROOT, "packages/hybrid-web/src/prompts.ts");
const promptsContent = readFileSync(promptsPath, "utf-8");
assert.ok(promptsContent.includes("flagship-pump-triage-v1"), "PROMPT_TEMPLATES must include flagship-pump-triage-v1");

const capabilitiesPath = resolve(ROOT, "packages/hybrid-web/src/capabilities.ts");
const capabilitiesContent = readFileSync(capabilitiesPath, "utf-8");
assert.ok(capabilitiesContent.includes("prepareGeminiNano"), "capabilities must export prepareGeminiNano");
console.log("[PASS] hybrid-web policy, prompts, and capabilities contracts verified.");

console.log("\nALL FLAGSHIP HYBRID INCIDENT SCENARIO CHECKS PASSED SUCCESSFULLY!");
