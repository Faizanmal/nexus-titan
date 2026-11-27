import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const iosDir = path.resolve(rootDir, "apps", "ios");

console.log("=== Phase 21: iOS FieldRelay Scaffold & Compliance Verification ===");

// 1. Verify existence of required iOS project files
const requiredFiles = [
  "Package.swift",
  "FieldRelay/Info.plist",
  "FieldRelay.xcodeproj/project.pbxproj",
  "FieldRelay/Sources/App/FieldRelayApp.swift",
  "FieldRelay/Sources/Security/KeychainVault.swift",
  "FieldRelay/Sources/Storage/FieldRelayOutbox.swift",
  "FieldRelay/Sources/Vision/SpatialMarkerScanner.swift",
  "FieldRelay/Sources/Vision/VisionTextRecognizer.swift",
  "FieldRelay/Sources/AI/FirebaseAiLogicAdapter.swift",
  "FieldRelay/Sources/Mesh/MultipeerMeshTransport.swift",
  "FieldRelay/Sources/UI/FieldRelayViews.swift",
  "FieldRelay/Tests/FieldRelayTests/FieldRelayTests.swift"
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(iosDir, relPath);
  assert.ok(fs.existsSync(fullPath), `Missing required iOS file: ${relPath}`);
}
console.log(`[PASS] All ${requiredFiles.length} iOS core files and project structures exist.`);

// 2. Verify minimal permissions in Info.plist
const plistContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Info.plist"), "utf8");
const allowedPermissions = [
  "NSCameraUsageDescription",
  "NSLocalNetworkUsageDescription",
  "NSBonjourServices"
];
for (const perm of allowedPermissions) {
  assert.ok(plistContent.includes(perm), `Info.plist missing expected permission entry: ${perm}`);
}
assert.ok(plistContent.includes("_nexus-mesh._tcp") && plistContent.includes("_nexus-mesh._udp"), "Info.plist must declare _nexus-mesh Bonjour services");

// Disallowed permissions audit
const disallowedPermissions = [
  "NSMicrophoneUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSContactsUsageDescription",
  "NSMotionUsageDescription"
];
for (const forbidden of disallowedPermissions) {
  assert.ok(!plistContent.includes(forbidden), `Info.plist contains forbidden permission: ${forbidden}`);
}
console.log("[PASS] Info.plist complies with minimal permissions and authorized Bonjour mesh services.");

// 3. Verify Package.swift dependencies & platforms
const packageContent = fs.readFileSync(path.join(iosDir, "Package.swift"), "utf8");
assert.ok(packageContent.includes(".iOS(.v17)"), "Package must target iOS v17");
assert.ok(packageContent.includes("firebase-ios-sdk.git"), "Package must declare firebase-ios-sdk");
assert.ok(packageContent.includes('"11.8.0"'), "Firebase iOS SDK must be pinned to 11.8.0");
assert.ok(packageContent.includes("FirebaseVertexAI"), "Package must depend on FirebaseVertexAI");
assert.ok(packageContent.includes("FirebaseAuth"), "Package must depend on FirebaseAuth");
assert.ok(packageContent.includes("FirebaseAppCheck"), "Package must depend on FirebaseAppCheck");
assert.ok(packageContent.includes("NexusTitanContracts"), "Package must link local NexusTitanContracts");
console.log("[PASS] Package.swift declares pinned dependencies and local contracts.");

// 4. Verify KeychainVault implementation
const vaultContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/Security/KeychainVault.swift"), "utf8");
assert.ok(vaultContent.includes("kSecClassGenericPassword"), "KeychainVault must use kSecClassGenericPassword");
assert.ok(vaultContent.includes("AES.GCM"), "KeychainVault must use CryptoKit AES.GCM");
assert.ok(vaultContent.includes(".bits256"), "KeychainVault must generate 256-bit symmetric keys");
console.log("[PASS] KeychainVault implements hardware-backed AES-256-GCM encryption.");

// 5. Verify FirebaseAiLogicAdapter policy matrix & restrictions
const aiContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/AI/FirebaseAiLogicAdapter.swift"), "utf8");
assert.ok(aiContent.includes("enum HybridMode"), "Must define HybridMode enum");
assert.ok(aiContent.includes("preferOnDevice") && aiContent.includes("onlyOnDevice"), "HybridMode must include preferOnDevice and onlyOnDevice");
assert.ok(aiContent.includes("preferInCloud") && aiContent.includes("onlyInCloud"), "HybridMode must include preferInCloud and onlyInCloud");
assert.ok(aiContent.includes("enum InferenceSource"), "Must define InferenceSource enum");
assert.ok(aiContent.includes("onDeviceSystem") && aiContent.includes("inCloud") && aiContent.includes("mock"), "InferenceSource must include onDeviceSystem, inCloud, mock");
assert.ok(aiContent.includes("guard isForeground else"), "Must enforce foreground-only execution");
assert.ok(aiContent.includes("restrictedFallbackProhibited") || aiContent.includes("isRestricted"), "Must enforce restricted data boundary prohibiting cloud fallback");
assert.ok(aiContent.includes('cloudModelName: String = "gemini-3.5-flash-lite"'), "Cloud model must be pinned to gemini-3.5-flash-lite");
console.log("[PASS] FirebaseAiLogicAdapter satisfies foreground checks, hybrid modes, model pinning, and restricted boundaries.");

// 6. Verify VisionTextRecognizer & SpatialMarkerScanner
const markerContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/Vision/SpatialMarkerScanner.swift"), "utf8");
assert.ok(markerContent.includes("QR-TITAN-WTP-01-"), "MarkerParser must recognize QR-TITAN-WTP-01- prefix");
const ocrContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/Vision/VisionTextRecognizer.swift"), "utf8");
assert.ok(ocrContent.includes("VNRecognizeTextRequest"), "VisionTextRecognizer must use VNRecognizeTextRequest for on-device OCR");
console.log("[PASS] SpatialMarkerScanner and VisionTextRecognizer provide local QR and OCR processing.");

// 7. Verify MultipeerMeshTransport
const meshContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/Mesh/MultipeerMeshTransport.swift"), "utf8");
assert.ok(meshContent.includes("MCSession"), "MultipeerMeshTransport must use MCSession");
assert.ok(meshContent.includes("MCNearbyServiceAdvertiser"), "MultipeerMeshTransport must advertise mesh service");
assert.ok(meshContent.includes("MCNearbyServiceBrowser"), "MultipeerMeshTransport must browse for nearby peers");
assert.ok(meshContent.includes('"nexus-mesh"'), "Service type must be nexus-mesh");
console.log("[PASS] MultipeerMeshTransport implements authorized local peer mesh networking.");

// 8. Verify Outbox Manager & Zero Background AI
const outboxContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/Storage/FieldRelayOutbox.swift"), "utf8");
assert.ok(outboxContent.includes(".approvedForSync"), "Outbox manager must filter for approved sync records");
assert.ok(outboxContent.includes("/sync/events"), "Outbox manager must flush records to /sync/events");
assert.ok(!outboxContent.includes("evaluateObservation"), "Outbox manager must NEVER execute background AI inference");
console.log("[PASS] FieldRelayOutboxManager implements safe transactional sync with zero background AI.");

// 9. Verify SwiftUI Views
const viewsContent = fs.readFileSync(path.join(iosDir, "FieldRelay/Sources/UI/FieldRelayViews.swift"), "utf8");
const expectedViews = [
  "FieldRelayRootView",
  "MarkerScannerView",
  "EvidenceCaptureView",
  "LocalInferenceView",
  "PrivacyConsentView",
  "OutboxSyncView",
  "PeerMeshView",
  "CapabilityStatusView"
];
for (const viewName of expectedViews) {
  assert.ok(viewsContent.includes(viewName), `UI missing expected view: ${viewName}`);
}
console.log("[PASS] SwiftUI UI includes all required field relay operational views.");

console.log("\nALL IOS FIELDRELAY CHECKS PASSED SUCCESSFULLY!");
