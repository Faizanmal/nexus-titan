# Phase 20 Evidence — Android FieldRelay Intelligence Node

Date: 2026-11-18

## Verification Commands and Actual Exit Statuses

| Command | Exit | Result |
|---|---:|---|
| `node tests/android-scaffold.test.mjs` | 0 | **All 8 suites passed**. Validates all 24 Android core files, minimal permissions, absence of unapproved permissions/services, pinned Version Catalog dependencies, AES-256-GCM Keystore vault, Firebase AI Logic adapter hybrid modes & foreground enforcement, CameraX/MLKit spatial marker parser, Room offline outbox DAO, WorkManager approved sync worker, and Compose UI screens. |
| `pnpm -r typecheck` | 0 | All TypeScript packages (`@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, `@nexus-titan/web`) passed strict typecheck with zero errors. |
| `pnpm -r lint` | 0 | ESLint passed with 0 errors across all workspace packages. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 Turbopack production build succeeded; all 22 web routes compiled. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/ -q -p no:cacheprovider` | 0 | **106 passed**, 3 warnings in 6.81s across full FastAPI test suite. |
| `python scripts/generate-contracts.py --check` | 0 | Generated wire contracts current; codegen matches schema baseline. |
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | 120 assets, 217 relations; deterministic SHA-256 confirmed. |

## Host Toolchain Audit & External Blocker Record

In strict adherence to `AGENTS.md` ("Do not claim a build, test, or service works unless the command ran successfully... Do not create simulated compiled Android/iOS artifacts. Use native Android Studio and Xcode templates when those platforms are implemented. Never mark mocked or unexecuted checks green."):

- **Host Environment**: Windows 10 Pro for Workstations, Node v26.13.1, Python 3.13.11, Docker Desktop 29.9.3.
- **Missing Prerequisites**: Android SDK (`ANDROID_HOME`, `adb`), JDK 17+ (`javac`, `java`), and native Gradle toolchains are not installed on this host environment (`Get-Command javac, java, gradle, adb` returned no executables).
- **Compliance Action**: We authored complete, production-grade Kotlin, Jetpack Compose, Room, CameraX, and Keystore sources with Gradle wrapper scripts (`gradlew`, `gradlew.bat`) and verified architectural/security contracts. We **did not** invent fake APK binaries or spoof local inference runs. Phase status is explicitly marked **PARTIAL** pending Android SDK installation.

## Implementation Tasks Completed

1. **Kotlin & Jetpack Compose Native Android Scaffold (`apps/android`)**:
   - Modern declarative Gradle setup using Kotlin DSL: `settings.gradle.kts`, root `build.gradle.kts`, `gradle.properties`, and `apps/android/gradle/libs.versions.toml`.
   - Official Gradle wrapper scripts (`gradlew`, `gradlew.bat`, `gradle-wrapper.properties` pinned to Gradle 8.11.1).
   - Target SDK: 35 (Android 15), Min SDK: 26 (Android 8.0 Oreo), Java/JVM target 17.
   - Pinned dependencies: AGP 8.8.0, Kotlin 2.1.0, Compose BOM 2024.12.01, Firebase BOM 33.8.0, Room 2.6.1, CameraX 1.4.1, MLKit 17.3.0, WorkManager 2.10.0, Security Crypto 1.1.0-alpha06.

2. **Minimal Permissions Audit & Zero Background AI (`AndroidManifest.xml`)**:
   - Declared permissions strictly limited to:
     - `android.permission.INTERNET`: Required for transactional outbox sync and cloud model fallback when approved.
     - `android.permission.ACCESS_NETWORK_STATE`: Required for connectivity detection.
     - `android.permission.CAMERA`: Required for QR marker scanning and evidence capture.
   - Strictly no unapproved or invasive permissions (no `RECORD_AUDIO`, no `ACCESS_FINE_LOCATION`, no `READ_EXTERNAL_STORAGE`, no `RECEIVE_BOOT_COMPLETED`).
   - Strictly zero background inference services or receivers.
   - Cloud backup prohibited via `res/xml/data_extraction_rules.xml` (`<exclude path="." domain="database" />` and `<exclude path="." domain="sharedpref" />`) to prevent cryptographic vault exfiltration.

3. **Hardware-Backed AES-256-GCM Vault (`data/AndroidKeystoreVault.kt`)**:
   - Master key generated and securely stored in hardware using `AndroidKeyStore` provider.
   - Uses `AES/GCM/NoPadding` cipher transformation with 256-bit key size.
   - Standard 12-byte IV prepended to ciphertext with 128-bit authentication tag verification.
   - All offline outbox payloads and session tokens are encrypted before disk writes.

4. **Firebase AI Logic Adapter (`ai/FirebaseAiLogicAdapter.kt`)**:
   - 4 explicit hybrid modes:
     - `PREFER_ON_DEVICE`: Evaluates local AICore/Gemini Nano model if available; falls back to cloud if consented; falls back to mock fixture with `isFallback = true`.
     - `ONLY_ON_DEVICE`: Fails closed (`ON_DEVICE_UNAVAILABLE`) if AICore hardware/model is absent.
     - `PREFER_IN_CLOUD`: Evaluates `gemini-1.5-flash` in cloud if operator consent is granted; falls back to local.
     - `ONLY_IN_CLOUD`: Fails closed (`CLOUD_APPROVAL_REQUIRED`) if explicit operator consent is missing.
   - **Foreground Enforcement**: Explicit check `if (!isForeground) throw IllegalStateException("FOREGROUND_REQUIRED")` ensures local inference never executes in background.
   - **Source Attribution**: Response outputs explicitly tag originating source (`ON_DEVICE`, `IN_CLOUD`, `MOCK`).
   - **Native Preprocessing**: Auto-downsamples images to 1024x1024 JPEG before model input.
   - **Single-Turn Structured Generation**: Emits `TriageObservationResult` (`asset_id`, `severity`, `anomaly_detected`, `physical_observation`, `recommended_action`, `confidence`).

5. **CameraX & MLKit Spatial Marker Scanner (`camera/SpatialMarkerScanner.kt`)**:
   - Integrates CameraX `ImageAnalysis.Analyzer` with Google MLKit `BarcodeScanning`.
   - `MarkerParser` extracts canonical asset IDs from `QR-TITAN-WTP-01-{assetId}` (e.g. `QR-TITAN-WTP-01-WTP01-PMP-001` -> `WTP01-PMP-001`).
   - Normalizes generic barcodes without making unsupported 3D reconstruction claims.

6. **Offline Outbox & WorkManager Sync (`data/OutboxDao.kt`, `sync/FieldSyncWorker.kt`)**:
   - Room SQLite persistence with `offline_outbox` and `cached_assets` tables.
   - Lifecycle transitions: `draft` -> `redacted` -> `approved_for_sync` -> `synced` / `rejected`.
   - `FieldSyncWorker` triggers only for records marked `approved_for_sync`.
   - Flushes encrypted records via HTTP POST to `/sync/events`.
   - Strictly zero background AI execution in worker.

7. **Jetpack Compose UI Screens (`ui/FieldRelayScreens.kt`)**:
   - `FieldRelayAppRoot`: Navigation scaffold with top status bar and bottom navigation bar.
   - `ScannerScreen`: Camera preview, QR detection overlay, canonical asset resolution.
   - `EvidenceCaptureScreen`: Multi-modal observation notes, photo attachment, asset binding.
   - `LocalInferenceScreen`: Hybrid mode selector, AICore availability status, structured triage display.
   - `RedactionConsentScreen`: Operator review, automated PII scrubbing preview, explicit cloud transmission consent toggle.
   - `OutboxSyncScreen`: Real-time queue count, Keystore encryption indicators, manual/automatic sync trigger.
   - `CapabilityStatusScreen`: Hardware floor status, AICore availability, local network latency, Play Integrity status.

8. **Unit Tests & Architectural Verification**:
   - `apps/android/app/src/test/java/dev/nexustitan/fieldrelay/FieldRelayUnitTest.kt`: Unit tests for `MarkerParser`, `FirebaseAiLogicAdapter` foreground checks, hybrid mode policies, and structured schema.
   - `tests/android-scaffold.test.mjs`: Automated Node test verifying file tree, manifest permissions, version catalog, vault specifications, and DAO constraints.
