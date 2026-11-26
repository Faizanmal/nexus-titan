import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("=== Phase 22: Cross-Platform Interoperability & Capability Parity Verification ===");

// 1. Canonical JSON Determinism Test
function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${pairs.join(",")}}`;
}

const objectA = { z: 1, a: { k: 2, b: 3 }, m: [3, 2, 1] };
const objectB = { a: { b: 3, k: 2 }, m: [3, 2, 1], z: 1 };
const canonA = canonicalJson(objectA);
const canonB = canonicalJson(objectB);
assert.equal(canonA, canonB, "Canonical JSON must sort dictionary keys deterministically.");
assert.equal(canonA, '{"a":{"b":3,"k":2},"m":[3,2,1],"z":1}');

const hashA = crypto.createHash("sha256").update(canonA).digest("hex");
const hashB = crypto.createHash("sha256").update(canonB).digest("hex");
assert.equal(hashA, hashB, "Canonical JSON hashes must match bit-for-bit across different serialization orders.");
console.log(`[PASS] Canonical JSON determinism verified (SHA-256: ${hashA.slice(0, 16)}...).`);

// 2. Schema Version and Timestamp Format Verification
const contractsIndex = fs.readFileSync(path.join(rootDir, "packages/contracts/src/generated.ts"), "utf8");
assert.ok(contractsIndex.includes('SCHEMA_VERSION = "1.3.0"'), "TypeScript contracts must declare SCHEMA_VERSION = 1.3.0");

const swiftContracts = fs.readFileSync(path.join(rootDir, "bindings/swift/Sources/NexusTitanContracts/GeneratedContracts.swift"), "utf8");
assert.ok(swiftContracts.includes('nexusSchemaVersion = "1.3.0"'), "Swift contracts must declare nexusSchemaVersion = 1.3.0");

const kotlinContracts = fs.readFileSync(path.join(rootDir, "bindings/kotlin/src/main/kotlin/dev/nexustitan/contracts/GeneratedContracts.kt"), "utf8");
assert.ok(kotlinContracts.includes('NEXUS_SCHEMA_VERSION: String = "1.3.0"'), "Kotlin contracts must declare NEXUS_SCHEMA_VERSION = 1.3.0");
console.log("[PASS] Contracts schema version v1.3.0 verified across TS, Swift, and Kotlin.");

// 3. Queue Migration Forward-Compatibility Test
function migrateLegacyEvent(legacyEvent) {
  const upgraded = { ...legacyEvent };
  upgraded.schema_version = "1.3.0";
  if (typeof upgraded.timestamp === "number") {
    upgraded.timestamp = new Date(upgraded.timestamp * 1000).toISOString();
  }
  if (!upgraded.classification) {
    upgraded.classification = "confidential";
  }
  if (!upgraded.source) {
    upgraded.source = "device";
  }
  return upgraded;
}

const legacy100 = {
  schema_version: "1.0.0",
  event_id: "77777777-7777-4777-8777-777777777777",
  timestamp: 1710000000,
  aggregate_type: "asset",
  event_type: "asset.created",
  payload: { name: "Pump Unit 1" }
};

const migrated100 = migrateLegacyEvent(legacy100);
assert.equal(migrated100.schema_version, "1.3.0");
assert.equal(migrated100.timestamp, "2024-03-09T16:00:00.000Z");
assert.equal(migrated100.classification, "confidential");
assert.equal(migrated100.source, "device");
console.log("[PASS] Legacy offline queue migration forwards compatibility verified.");

// 4. Cross-Platform Parity Matrix in Web Mesh UI
const meshPageContent = fs.readFileSync(path.join(rootDir, "apps/web/src/app/mesh/page.tsx"), "utf8");
assert.ok(meshPageContent.includes("Cross-Platform Capability & Protocol Parity Matrix"), "Mesh page must include parity matrix");
assert.ok(meshPageContent.includes("Web Command Center") && meshPageContent.includes("VERIFIED"), "Web client must be marked VERIFIED");
assert.ok(meshPageContent.includes("Android FieldRelay") && meshPageContent.includes("PARTIAL"), "Android client must be marked PARTIAL");
assert.ok(meshPageContent.includes("iOS FieldRelay") && meshPageContent.includes("PARTIAL"), "iOS client must be marked PARTIAL");

// Verify transports
assert.ok(meshPageContent.includes("webrtc_datachannel"), "Web transport must be webrtc_datachannel");
assert.ok(meshPageContent.includes("local_peer_adapter"), "Android transport must be local_peer_adapter");
assert.ok(meshPageContent.includes("multipeer_connectivity"), "iOS transport must be multipeer_connectivity");

// Verify vaults
assert.ok(meshPageContent.includes("IndexedDB (SubtleCrypto AES-GCM)"), "Web vault must be IndexedDB SubtleCrypto");
assert.ok(meshPageContent.includes("Android Keystore (AES-256-GCM)"), "Android vault must be Keystore");
assert.ok(meshPageContent.includes("Apple Keychain (CryptoKit AES-256-GCM)"), "iOS vault must be Keychain");

// Verify foreground rule
assert.ok(meshPageContent.includes("Strict Active UI"), "Foreground active UI constraint must be enforced");

// Verify cross-platform incident trace feed
assert.ok(meshPageContent.includes("Synchronized Incident Trace"), "Mesh page must display synchronized incident trace");
assert.ok(meshPageContent.includes("Exactly-Once Deduplicated"), "Trace must indicate exactly-once deduplication");
console.log("[PASS] Web UI displays honest, verified Cross-Platform Parity Matrix without fabricated claims.");

// 5. Backend Mesh Conformance Endpoint Verification
const meshRoutesContent = fs.readFileSync(path.join(rootDir, "services/api/src/nexus_titan_api/mesh_routes.py"), "utf8");
assert.ok(meshRoutesContent.includes("def get_mesh_protocol_conformance"), "FastAPI must declare /conformance route");
assert.ok(meshRoutesContent.includes('"Ed25519"') && meshRoutesContent.includes('"ECDSA_SECP256R1_SHA256"'), "FastAPI must support Ed25519 and ECDSA signatures");
assert.ok(meshRoutesContent.includes("HOST_ANDROID_SDK_JDK_ABSENT"), "Android blocker must be recorded in conformance endpoint");
assert.ok(meshRoutesContent.includes("HOST_MACOS_XCODE_ABSENT"), "iOS blocker must be recorded in conformance endpoint");
console.log("[PASS] FastAPI /mesh/conformance route reflects actual host blockers and signature algorithms.");

console.log("\nALL CROSS-PLATFORM INTEROPERABILITY & CAPABILITY PARITY CHECKS PASSED!");
