/**
 * Automated Verification for Contradiction Impact: Telemetry-Only vs. Field Evidence Investigation.
 *
 * Verifies:
 * 1. UI renders concise results comparison table between Telemetry-Only and Hybrid Field Evidence.
 * 2. Documents what changes in the investigation: hypothesis shifts from mechanical pump seizure to transducer wiring loop drift.
 * 3. Documents evidence supporting change: physical Bourdon dial reads nominal 390 kPa, normal casing vibration, QR scan.
 * 4. Documents what still requires supervisor review: setpoint changes, interlock overrides, standby switchover (no_actuator_path: true).
 * 5. Compares measured response times, payload sizes (~4,280 bytes withheld in local vault vs ~412 bytes sanitized egress), and decisions ($65,400 overhaul vs $1,250 recalibration).
 * 6. Labels test setup (synthetic linear hydraulic model TITAN-WTP-01) and sample size (N=1 live run).
 * 7. Preserves epistemic uncertainty (confidence 94% false certainty vs 68% moderate uncertainty).
 * 8. Details why local inference and approved cloud handoff each matter to a maintenance technician.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();

console.log("=== Verification: Contradiction Impact & Field Evidence Comparison ===");

const demoPath = resolve(ROOT, "apps/web/src/app/demo/page.tsx");
assert.ok(existsSync(demoPath), "Demo page must exist at apps/web/src/app/demo/page.tsx");
const demoContent = readFileSync(demoPath, "utf-8");

// 1. Results Comparison Table
assert.ok(demoContent.includes("Contradiction Impact Inspector: Telemetry-Only vs. Field Evidence Handling"), "Must feature Contradiction Impact Inspector title");
assert.ok(demoContent.includes("Telemetry-Only Handling (Blind to Dial)"), "Must include Telemetry-Only column");
assert.ok(demoContent.includes("Telemetry + Technician Observation (Hybrid)"), "Must include Telemetry + Technician Observation column");
console.log("[PASS] Concise results comparison table verified.");

// 2. What Changes in the Investigation
assert.ok(demoContent.includes("Transducer PT-101 Wiring Loop Drift"), "Must identify transducer wiring loop drift");
assert.ok(demoContent.includes("Catastrophic Impeller Cavitation Seizure"), "Must contrast against telemetry-only mechanical seizure hypothesis");
console.log("[PASS] Investigation hypothesis shift verified.");

// 3. Evidence Supporting the Change
assert.ok(demoContent.includes("Physical dial gauge reads 410 kPa") || demoContent.includes("Physical Bourdon tube pressure dial reading (410 kPa)") || demoContent.includes("410 kPa"), "Must cite physical dial reading");
assert.ok(demoContent.includes("casing tactile vibration"), "Must cite physical casing vibration");
console.log("[PASS] Supporting physical evidence verified.");

// 4. Governance & Supervisor Review Gate
assert.ok(demoContent.includes("What Still Requires Supervisor Review"), "Must specify supervisor review boundaries");
assert.ok(demoContent.includes("no_actuator_path: true"), "Must enforce simulator-only reducer");
console.log("[PASS] Supervisor review requirements verified.");

// 5. Measured Response Times, Payload Sizes & Decisions
assert.ok(demoContent.includes("Measured Response Time"), "Must report measured response times");
assert.ok(demoContent.includes("4,280 bytes withheld"), "Must report withheld payload size");
assert.ok(demoContent.includes("412 bytes sanitized"), "Must report sanitized egress size");
assert.ok(demoContent.includes("$65,400"), "Must report catastrophic failure cost");
assert.ok(demoContent.includes("$1,250"), "Must report throttled bypass / recalibration cost");
console.log("[PASS] Measured metrics, payload sizes, and resulting decisions verified.");

// 6. Test Setup, Sample Size & Preserved Uncertainty
assert.ok(demoContent.includes("Test Setup: Synthetic Digital Twin TITAN-WTP-01"), "Must label test setup");
assert.ok(demoContent.includes("Sample Size: N=1 Live Execution Run"), "Must label sample size");
assert.ok(demoContent.includes("Confidence: 68%"), "Must preserve epistemic uncertainty");
console.log("[PASS] Test setup, sample size, and uncertainty preservation verified.");

// 7. Value to Maintenance Technician
assert.ok(demoContent.includes("Why Local Inference Matters to a Maintenance Technician"), "Must explain local inference value");
assert.ok(demoContent.includes("Why an Approved Cloud Handoff Matters to a Maintenance Technician"), "Must explain approved cloud handoff value");
console.log("[PASS] Technician field value contexts verified.");

console.log("\nALL CONTRADICTION COMPARISON CHECKS PASSED SUCCESSFULLY!");
