/**
 * Automated Verification for Flagship Hybrid Incident Scenario:
 * Behavioral execution of local and cloud legs, honest MOCK fallback with fallback_reason,
 * consent invalidation, tamper prevention, and accurate SDK provenance.
 */

import assert from "node:assert/strict";
import {
  FLAGSHIP_INCIDENT_ID,
  SYNTHETIC_CANARY_TOKEN,
  INITIAL_FLAGSHIP_EVIDENCE,
  sanitizeFlagshipPayload,
  executeOfflineLocalLeg,
  executeCloudLeg,
  canonicalHash,
} from "../apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts";

console.log("=== Flagship Hybrid Incident Behavioral & Provenance Verification ===");

// 1. Behavior test: Offline local leg fixture run must yield MOCK plus fallback_reason
console.log("Testing offline local leg execution...");
const localRes = await executeOfflineLocalLeg(INITIAL_FLAGSHIP_EVIDENCE);
assert.equal(localRes.incident_id, FLAGSHIP_INCIDENT_ID);
assert.equal(localRes.leg, "local_edge");
assert.equal(localRes.mode, "ONLY_ON_DEVICE");
assert.equal(localRes.is_simulation_fallback, true, "Fixture run must set is_simulation_fallback = true");
assert.equal(localRes.observed_source, "MOCK", "Fixture run must yield observed_source = MOCK");
assert.ok(
  typeof localRes.fallback_reason === "string" && localRes.fallback_reason.length > 0,
  "Fixture run must yield a non-empty fallback_reason"
);
assert.ok(
  localRes.raw_output.startsWith("Simulated:"),
  "Raw output must clearly state Simulated: <reason>"
);
assert.equal(localRes.canary_retained_locally, true);
console.log(`[PASS] Offline local leg fixture yielded MOCK + fallback_reason: "${localRes.fallback_reason}"`);

// 2. Behavior test: Sanitization & canary containment
console.log("Testing payload sanitization & canary containment...");
const sanitized = await sanitizeFlagshipPayload(INITIAL_FLAGSHIP_EVIDENCE);
assert.equal(sanitized.incident_id, FLAGSHIP_INCIDENT_ID);
assert.equal(sanitized.classification, "public");
assert.ok(!sanitized.deidentified_summary.includes(SYNTHETIC_CANARY_TOKEN), "Canary must be stripped from summary");
assert.ok(!JSON.stringify(sanitized).includes(SYNTHETIC_CANARY_TOKEN), "Canary must be absent from entire sanitized payload");
assert.ok(sanitized.consent_hash && sanitized.consent_hash.length >= 8, "Cryptographic consent hash must be computed");
console.log("[PASS] Sanitization stripped canary and computed consent hash.");

// 3. Behavior test: Declined approval blocks cloud leg
console.log("Testing declined approval blocking...");
await assert.rejects(
  async () => {
    await executeCloudLeg(sanitized, false, sanitized.consent_hash);
  },
  /APPROVAL_DECLINED/,
  "Declined approval must reject with APPROVAL_DECLINED"
);
console.log("[PASS] Declined approval strictly blocks cloud leg.");

// 4. Behavior test: Tampered payload invalidates consent; transient fields preserve consent
console.log("Testing tamper invalidation...");
const tampered = {
  ...sanitized,
  deidentified_summary: sanitized.deidentified_summary + " [TAMPERED_INJECTION]",
};
await assert.rejects(
  async () => {
    await executeCloudLeg(tampered, true, sanitized.consent_hash);
  },
  /CONSENT_INVALIDATED/,
  "Tampered payload must reject with CONSENT_INVALIDATED"
);
console.log("[PASS] Tampered payload immediately invalidates consent.");

// 4b. Transient update test: Updating sanitized_at or adding consent_hash directly does not invalidate canonicalHash
console.log("Testing canonicalHash determinism and transient field tolerance...");
const withUpdatedTimestamp = {
  ...sanitized,
  sanitized_at: new Date(Date.now() + 10000).toISOString(),
  consent_hash: "transient-hash-should-be-excluded",
};
assert.equal(
  await canonicalHash(withUpdatedTimestamp),
  sanitized.consent_hash,
  "canonicalHash must be identical regardless of sanitized_at or consent_hash fields"
);
console.log("[PASS] canonicalHash stable under transient mutations.");

// 5. Behavior test: Cloud leg fixture run must yield MOCK plus fallback_reason
console.log("Testing cloud leg execution...");
const cloudRes = await executeCloudLeg(sanitized, true, sanitized.consent_hash);
assert.equal(cloudRes.incident_id, FLAGSHIP_INCIDENT_ID);
assert.equal(cloudRes.leg, "cloud_vertex");
assert.equal(cloudRes.is_simulation_fallback, true, "Fixture cloud run must set is_simulation_fallback = true");
assert.equal(cloudRes.observed_source, "MOCK", "Fixture cloud run must yield observed_source = MOCK");
assert.ok(
  typeof cloudRes.fallback_reason === "string" && cloudRes.fallback_reason.length > 0,
  "Fixture cloud run must yield a non-empty fallback_reason"
);
assert.ok(
  cloudRes.raw_output.startsWith("Simulated:"),
  "Raw output must clearly state Simulated: <reason>"
);
assert.equal(cloudRes.canary_absent_verified, true);
console.log(`[PASS] Cloud leg fixture yielded MOCK + fallback_reason: "${cloudRes.fallback_reason}"`);

// 6. Behavior test: Incident ID correlation across both legs
assert.equal(localRes.incident_id, cloudRes.incident_id, "Both legs must share identical Incident ID");
console.log(`[PASS] Incident ID correlation verified across both legs: ${localRes.incident_id}`);

console.log("\nALL FLAGSHIP HYBRID INCIDENT BEHAVIORAL CHECKS PASSED SUCCESSFULLY!");
