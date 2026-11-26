import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const androidDir = path.resolve(rootDir, "apps", "android");

console.log("=== Phase 20: Android FieldRelay Scaffold & Compliance Verification ===");

// 1. Verify existence of required project files
const requiredFiles = [
  "settings.gradle.kts",
  "build.gradle.kts",
  "gradle.properties",
  "gradlew.bat",
  "gradlew",
  "gradle/libs.versions.toml",
  "gradle/wrapper/gradle-wrapper.properties",
  "app/build.gradle.kts",
  "app/proguard-rules.pro",
  "app/src/main/AndroidManifest.xml",
  "app/src/main/res/values/strings.xml",
  "app/src/main/res/values/themes.xml",
  "app/src/main/res/xml/data_extraction_rules.xml",
  "app/src/main/java/dev/nexustitan/fieldrelay/FieldRelayApp.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/MainActivity.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/data/AndroidKeystoreVault.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/data/Entities.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/data/OutboxDao.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/data/FieldRelayDatabase.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/sync/FieldSyncWorker.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/ai/FirebaseAiLogicAdapter.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/camera/SpatialMarkerScanner.kt",
  "app/src/main/java/dev/nexustitan/fieldrelay/ui/FieldRelayScreens.kt",
  "app/src/test/java/dev/nexustitan/fieldrelay/FieldRelayUnitTest.kt"
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(androidDir, relPath);
  assert.ok(fs.existsSync(fullPath), `Missing required Android file: ${relPath}`);
}
console.log(`[PASS] All ${requiredFiles.length} Android core files and scaffold structures exist.`);

// 2. Verify minimal permissions & security settings in AndroidManifest.xml
const manifestContent = fs.readFileSync(path.join(androidDir, "app/src/main/AndroidManifest.xml"), "utf8");
const allowedPermissions = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA"
];

// Check allowed permissions are declared
for (const perm of allowedPermissions) {
  assert.ok(manifestContent.includes(perm), `Manifest missing expected permission: ${perm}`);
}

// Disallowed permissions audit
const disallowedPermissions = [
  "RECORD_AUDIO",
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "RECEIVE_BOOT_COMPLETED"
];
for (const forbidden of disallowedPermissions) {
  assert.ok(!manifestContent.includes(forbidden), `Manifest contains forbidden permission: ${forbidden}`);
}

// Ensure no background service triggers local AI
assert.ok(!manifestContent.includes("InferenceService"), "Manifest must NOT declare background inference services.");
assert.ok(manifestContent.includes("data_extraction_rules"), "Manifest must configure data extraction rules.");
console.log("[PASS] AndroidManifest.xml complies with minimal permissions and zero background inference.");

// 3. Verify Version Catalog (libs.versions.toml) dependencies
const tomlContent = fs.readFileSync(path.join(androidDir, "gradle/libs.versions.toml"), "utf8");
assert.ok(tomlContent.includes('agp = "8.8.0"'), "AGP must be pinned to 8.8.0");
assert.ok(tomlContent.includes('kotlin = "2.1.0"'), "Kotlin must be pinned to 2.1.0");
assert.ok(tomlContent.includes('composeBom = "2024.12.01"'), "Compose BOM must be pinned to 2024.12.01");
assert.ok(tomlContent.includes('firebaseBom = "33.8.0"'), "Firebase BOM must be pinned to 33.8.0");
assert.ok(tomlContent.includes('room = "2.6.1"'), "Room must be pinned to 2.6.1");
assert.ok(tomlContent.includes('camerax = "1.4.1"'), "CameraX must be pinned to 1.4.1");
assert.ok(tomlContent.includes('mlkitBarcode = "17.3.0"'), "MLKit Barcode must be pinned to 17.3.0");
assert.ok(tomlContent.includes('workManager = "2.10.0"'), "WorkManager must be pinned to 2.10.0");
console.log("[PASS] gradle/libs.versions.toml contains pinned SDKs and BOMs.");

// 4. Verify AndroidKeystoreVault implementation
const vaultContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/data/AndroidKeystoreVault.kt"), "utf8");
assert.ok(vaultContent.includes('"AndroidKeyStore"'), "Vault must use AndroidKeyStore provider");
assert.ok(vaultContent.includes('"AES/GCM/NoPadding"'), "Vault must use AES/GCM/NoPadding cipher");
assert.ok(vaultContent.includes("setKeySize(256)"), "Vault must generate 256-bit AES master keys");
assert.ok(vaultContent.includes("GCM_IV_LENGTH_BYTES = 12"), "Vault must use standard 12-byte GCM IV");
assert.ok(vaultContent.includes("GCM_TAG_LENGTH_BITS = 128"), "Vault must use 128-bit authentication tag");
console.log("[PASS] AndroidKeystoreVault matches AES-256-GCM hardware-backed vault specifications.");

// 5. Verify FirebaseAiLogicAdapter implementation
const aiAdapterContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/ai/FirebaseAiLogicAdapter.kt"), "utf8");
assert.ok(aiAdapterContent.includes("enum class HybridMode"), "Must define HybridMode enum");
assert.ok(aiAdapterContent.includes("PREFER_ON_DEVICE") && aiAdapterContent.includes("ONLY_ON_DEVICE"), "HybridMode must include PREFER_ON_DEVICE and ONLY_ON_DEVICE");
assert.ok(aiAdapterContent.includes("PREFER_IN_CLOUD") && aiAdapterContent.includes("ONLY_IN_CLOUD"), "HybridMode must include PREFER_IN_CLOUD and ONLY_IN_CLOUD");
assert.ok(aiAdapterContent.includes("enum class InferenceSource"), "Must define InferenceSource enum");
assert.ok(aiAdapterContent.includes("ON_DEVICE") && aiAdapterContent.includes("IN_CLOUD") && aiAdapterContent.includes("MOCK"), "InferenceSource must include ON_DEVICE, IN_CLOUD, MOCK");
assert.ok(aiAdapterContent.includes("if (!isForeground)"), "Must enforce foreground execution check");
assert.ok(aiAdapterContent.includes("cloudModelName: String = \"gemini-1.5-flash\""), "Must pin cloud model to gemini-1.5-flash");
assert.ok(aiAdapterContent.includes("preprocessImage"), "Must provide image downsampling/preprocessing");
console.log("[PASS] FirebaseAiLogicAdapter satisfies foreground checks, hybrid modes, and model pinning.");

// 6. Verify MarkerParser & MLKit scanner
const scannerContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/camera/SpatialMarkerScanner.kt"), "utf8");
assert.ok(scannerContent.includes('QR-TITAN-WTP-01-'), "MarkerParser must recognize QR-TITAN-WTP-01- canonical prefix");
assert.ok(scannerContent.includes("BarcodeScanning.getClient()"), "SpatialMarkerAnalyzer must use MLKit BarcodeScanning client");
console.log("[PASS] SpatialMarkerScanner handles plant QR parsing and MLKit barcode analysis.");

// 7. Verify Room Outbox Database & WorkManager sync
const daoContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/data/OutboxDao.kt"), "utf8");
assert.ok(daoContent.includes("status = 'approved_for_sync'"), "OutboxDao must filter approved sync records");
const workerContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/sync/FieldSyncWorker.kt"), "utf8");
assert.ok(workerContent.includes("CoroutineWorker"), "FieldSyncWorker must inherit from CoroutineWorker");
assert.ok(workerContent.includes("/sync/events"), "FieldSyncWorker must sync evidence to backend API");
assert.ok(!workerContent.includes("evaluateObservation"), "FieldSyncWorker must NEVER invoke local model inference in the background.");
console.log("[PASS] Room outbox and FieldSyncWorker implement safe network sync with zero background AI.");

// 8. Verify Jetpack Compose UI Screens
const uiContent = fs.readFileSync(path.join(androidDir, "app/src/main/java/dev/nexustitan/fieldrelay/ui/FieldRelayScreens.kt"), "utf8");
const expectedScreens = [
  "FieldRelayAppRoot",
  "ScannerScreen",
  "EvidenceCaptureScreen",
  "LocalInferenceScreen",
  "RedactionConsentScreen",
  "OutboxSyncScreen",
  "CapabilityStatusScreen"
];
for (const screen of expectedScreens) {
  assert.ok(uiContent.includes(screen), `UI missing expected Compose screen: ${screen}`);
}
console.log("[PASS] Jetpack Compose UI includes all required field relay operational screens.");

console.log("\nALL ANDROID FIELDRELAY CHECKS PASSED SUCCESSFULLY!");
