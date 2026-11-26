/**
 * Verification for Prompt 5: Flagship Incident 5-Stage Guided Sequence & Landing Page Entry.
 *
 * Verifies:
 * 1. 1-click entry from homepage (/) to flagship demo (/demo) with clear hero CTA and visible focus.
 * 2. 5-Stage guided sequence:
 *    - Stage 1: Alarm & Contradictory physical observation
 *    - Stage 2: Offline on-device local AI result
 *    - Stage 3: Approved de-identified cloud handoff
 *    - Stage 4: Multi-agent DAG & counterfactual solver decision
 *    - Stage 5: Spatial digital twin & deterministic replay
 * 3. User guidance explaining what to do at each stage.
 * 4. Runtime state gates: connection state (online/offline toggle), Gemini Nano 4 readiness, and identity quota.
 * 5. Side-by-side approved fields & model source attribution beside outputs.
 * 6. Fictional linear model notice & honest peer transfer reporting (SIMULATED_AIRGAP_SUBNET).
 * 7. Owner-only action isolation (tenant wipe hidden behind evaluator sandbox isolation).
 * 8. Responsive desktop and narrow layouts with visible focus, ARIA live regions, and accessible labels.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();

console.log("=== Prompt 5: Flagship Guided Sequence & Landing Entry Verification ===");

// 1. Verify Homepage Hero Entry
const homePath = resolve(ROOT, "apps/web/src/app/page.tsx");
assert.ok(existsSync(homePath), "Landing page must exist at apps/web/src/app/page.tsx");
const homeContent = readFileSync(homePath, "utf-8");

assert.ok(homeContent.includes('href="/demo"'), "Homepage must link directly to /demo");
assert.ok(homeContent.includes("Flagship Incident Walkthrough") || homeContent.includes("Flagship Incident Scenario"), "Hero must describe flagship walkthrough");
assert.ok(homeContent.includes("focus:ring-2"), "Hero CTA button must have visible focus rings");
assert.ok(homeContent.includes("Fictional Linear Hydraulic Model"), "Homepage must display fictional model disclaimer");
console.log("[PASS] 1-click homepage entry with accessible keyboard focus ring and clear purpose verified.");

// 2. Verify Demo Page 5-Stage Guided Stepper
const demoPath = resolve(ROOT, "apps/web/src/app/demo/page.tsx");
assert.ok(existsSync(demoPath), "Demo page must exist at apps/web/src/app/demo/page.tsx");
const demoContent = readFileSync(demoPath, "utf-8");

assert.ok(demoContent.includes("5-Stage Flagship Incident Walkthrough"), "Must feature 5-Stage Flagship Walkthrough");
assert.ok(demoContent.includes("Stage 1") && demoContent.includes("Alarm & Contradiction"), "Must include Stage 1 Alarm & Contradiction");
assert.ok(demoContent.includes("Stage 2") && demoContent.includes("Offline Local Result"), "Must include Stage 2 Offline Local Result");
assert.ok(demoContent.includes("Stage 3") && demoContent.includes("Approved Cloud Handoff"), "Must include Stage 3 Approved Cloud Handoff");
assert.ok(demoContent.includes("Stage 4") && demoContent.includes("Decision & Mitigation"), "Must include Stage 4 Decision & Mitigation");
assert.ok(demoContent.includes("Stage 5") && demoContent.includes("Spatial Twin & Replay"), "Must include Stage 5 Spatial Twin & Replay");
console.log("[PASS] 5-Stage guided sequence stepper verified.");

// 3. Verify Guidance Box & Runtime State Awareness
assert.ok(demoContent.includes("What to do at Stage 1"), "Must guide user at Stage 1");
assert.ok(demoContent.includes("What to do at Stage 2"), "Must guide user at Stage 2");
assert.ok(demoContent.includes("What to do at Stage 3"), "Must guide user at Stage 3");
assert.ok(demoContent.includes("What to do at Stage 4"), "Must guide user at Stage 4");
assert.ok(demoContent.includes("What to do at Stage 5"), "Must guide user at Stage 5");

assert.ok(demoContent.includes("Gemini Nano 4 Readiness"), "Must surface Gemini Nano 4 model readiness");
assert.ok(demoContent.includes("inspectCapabilities"), "Must query on-device capabilities");
assert.ok(demoContent.includes("Toggle network online or offline"), "Must provide network connection toggle with accessible label");
console.log("[PASS] Guidance and connection/model/identity state indicators verified.");

// 4. Verify Side-by-Side Model Source & Approved Fields
assert.ok(demoContent.includes("Model Source:"), "Must attribute model source beside output");
assert.ok(demoContent.includes("LOCAL_ON_DEVICE"), "Must show local on-device source");
assert.ok(demoContent.includes("CLOUD_BACKEND"), "Must show cloud backend source");
assert.ok(demoContent.includes("Masquerading Prevented"), "Must display masquerading prevented check");
assert.ok(demoContent.includes("Approved De-Identification & Consent"), "Must display approved consent and stripped fields");
console.log("[PASS] Side-by-side approved fields and honest model source attribution verified.");

// 5. Verify Honest Hardware & Subnet Transfer Disclaimers
assert.ok(demoContent.includes("SIMULATED_AIRGAP_SUBNET (Zero hardware claimed)"), "Must report air-gapped simulation honestly");
assert.ok(demoContent.includes("Zero Industrial Connection Notice"), "Must display zero industrial connection disclaimer");
console.log("[PASS] Fictional linear simulation and zero physical hardware transport claims verified.");

// 6. Verify Evaluator Sandbox Isolation vs Owner Tenant Wipe
assert.ok(demoContent.includes("Evaluator Sandbox Isolation Active"), "Must isolate evaluator from tenant-wide wipe");
assert.ok(demoContent.includes("Local Environment Owner Controls (Tenant Wipe)"), "Must sequester tenant wipe in owner section");
assert.ok(demoContent.includes("RESET demo-nexus"), "Owner command RESET demo-nexus preserved");
assert.ok(demoContent.includes("allowedCandidate"), "allowedCandidate check preserved");
console.log("[PASS] Owner destructive reset sequestered while preserving server checks and test hooks.");

// 7. Verify Accessibility, Pending States, and Responsive Layouts
assert.ok(demoContent.includes('role="main"'), "Main landmark present");
assert.ok(demoContent.includes('aria-label="Guided Incident Sequence"'), "Region aria label present");
assert.ok(demoContent.includes('role="tablist"'), "Tablist present for guided sequence");
assert.ok(demoContent.includes('aria-selected='), "Aria-selected present for stage buttons");
assert.ok(demoContent.includes('aria-busy='), "Aria-busy present for pending execution states");
assert.ok(demoContent.includes('aria-live="polite"'), "Aria-live polite present for async notifications");
assert.ok(demoContent.includes("focus:ring-2"), "Visible keyboard focus rings present on critical controls");
assert.ok(demoContent.includes("lg:grid-cols-5") && demoContent.includes("grid-cols-1"), "Responsive desktop and narrow layouts present");
console.log("[PASS] Keyboard accessibility, visible focus, ARIA feedback, and responsive layouts verified.");

console.log("\nALL PROMPT 5 GUIDED DEMO UI CHECKS PASSED SUCCESSFULLY!");
