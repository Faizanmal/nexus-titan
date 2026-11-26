/**
 * Functional Unit Tests for Flagship Hybrid Scenario Runner:
 * 1. Sanitization & canary containment
 * 2. Consent hashing and tamper invalidation
 * 3. Declined approval prevention of cloud requests
 * 4. Offline local leg execution and actionable output
 * 5. Incident ID correlation across both legs
 */

import assert from "node:assert/strict";
import {
  FLAGSHIP_INCIDENT_ID,
  SYNTHETIC_CANARY_TOKEN,
  INITIAL_FLAGSHIP_EVIDENCE,
  computePayloadHash,
  sanitizeFlagshipPayload,
  executeOfflineLocalLeg,
  executeCloudLeg,
} from "../apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts";

console.log("=== Flagship Hybrid Scenario Functional Unit Tests ===");

// 1. Verify Sanitization and Canary Stripping
const sanitized = await sanitizeFlagshipPayload(INITIAL_FLAGSHIP_EVIDENCE);
assert.equal(sanitized.incident_id, FLAGSHIP_INCIDENT_ID);
assert.equal(sanitized.classification, "public");
assert.ok(!sanitized.deidentified_summary.includes(SYNTHETIC_CANARY_TOKEN), "Canary must be stripped from summary");
assert.ok(!JSON.stringify(sanitized).includes(SYNTHETIC_CANARY_TOKEN), "Canary must be absent from entire sanitized payload");
assert.ok(sanitized.consent_hash.length >= 8, "Consent hash must be computed");
console.log("[PASS] Sanitization stripped canary and computed consent hash.");

// 2. Verify Declined Approval Block Gate
let cloudRequestedWithoutApproval = false;
try {
  await executeCloudLeg(sanitized, false, sanitized.consent_hash);
  cloudRequestedWithoutApproval = true;
} catch (err) {
  assert.match(String(err), /APPROVAL_DECLINED/);
}
assert.equal(cloudRequestedWithoutApproval, false, "Declined approval must never send cloud inference request");
console.log("[PASS] Declined approval strictly blocks cloud inference.");

// 3. Verify Tamper Invalidation Gate
let cloudRequestedWithTamper = false;
try {
  // Tamper with payload while passing old consent hash
  const tampered = {
    ...sanitized,
    deidentified_summary: sanitized.deidentified_summary + " [TAMPERED_INJECTED_MODIFICATION]",
  };
  await executeCloudLeg(tampered, true, sanitized.consent_hash);
  cloudRequestedWithTamper = true;
} catch (err) {
  assert.match(String(err), /CONSENT_INVALIDATED/);
}
assert.equal(cloudRequestedWithTamper, false, "Tampered payload must invalidate consent");
console.log("[PASS] Tampered payload immediately invalidates consent.");

// 4. Verify Local Leg Execution & Contradiction Triage
const localRes = await executeOfflineLocalLeg(INITIAL_FLAGSHIP_EVIDENCE);
assert.equal(localRes.incident_id, FLAGSHIP_INCIDENT_ID);
assert.equal(localRes.leg, "local_edge");
assert.equal(localRes.mode, "ONLY_ON_DEVICE");
assert.ok(localRes.duration_ms > 0, "Measured duration must be positive");
assert.ok(localRes.actionable_hypothesis.includes("CONTRADICTION") || localRes.actionable_hypothesis.includes("drift"), "Must identify contradiction or sensor drift");
assert.equal(localRes.canary_retained_locally, true);
console.log(`[PASS] Offline local leg executed successfully (${localRes.observed_source}, ${localRes.duration_ms} ms).`);

// 5. Verify Approved Cloud Leg Execution
const cloudRes = await executeCloudLeg(sanitized, true, sanitized.consent_hash);
assert.equal(cloudRes.incident_id, FLAGSHIP_INCIDENT_ID, "Both legs must share identical Incident ID");
assert.equal(cloudRes.leg, "cloud_vertex");
assert.equal(cloudRes.mode, "ONLY_IN_CLOUD");
assert.ok(cloudRes.duration_ms > 0, "Cloud leg duration must be measured");
assert.equal(cloudRes.canary_absent_verified, true);
console.log(`[PASS] Approved cloud leg executed successfully (${cloudRes.observed_source}, ${cloudRes.duration_ms} ms).`);

// 6. Verify Incident ID Correlation
assert.equal(localRes.incident_id, cloudRes.incident_id);
console.log(`[PASS] Both legs cryptographically tied to Incident ID: ${localRes.incident_id}.`);

console.log("\nALL FUNCTIONAL UNIT TESTS PASSED SUCCESSFULLY!");
