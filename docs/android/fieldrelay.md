# NEXUS TITAN Android FieldRelay Edge Intelligence Node

## Overview

The `apps/android` module provides the native Android client for NEXUS TITAN field technicians and plant operators. It runs as an edge intelligence node capable of operating in air-gapped or intermittently connected water treatment facilities.

## Key Features

1. **Spatial Asset Marker Scanner (`camera/SpatialMarkerScanner.kt`)**:
   - Integrates CameraX and Google MLKit Barcode Scanning.
   - Parses physical plant markers adhering to `QR-TITAN-WTP-01-{canonicalAssetId}` (e.g. `QR-TITAN-WTP-01-WTP01-PMP-001`).
   - Resolves scanned assets against cached plant topology without unrealistic 3D environment reconstruction claims.

2. **Hardware-Backed Cryptographic Vault (`data/AndroidKeystoreVault.kt`)**:
   - Uses `AndroidKeyStore` provider to generate a non-exportable 256-bit AES master key.
   - Encrypts offline outbox payloads, captured evidence, and authentication tokens with `AES/GCM/NoPadding`.
   - Uses 12-byte initialization vectors (IV) and 128-bit authentication tags.
   - Disallows cloud backup of local cryptographic data via `res/xml/data_extraction_rules.xml`.

3. **Hybrid AI Logic Adapter (`ai/FirebaseAiLogicAdapter.kt`)**:
   - Supports 4 explicit operation modes:
     - `PREFER_ON_DEVICE`: Prioritizes on-device AICore/Gemini Nano; falls back to cloud if consented, or mock.
     - `ONLY_ON_DEVICE`: Fails closed with `ON_DEVICE_UNAVAILABLE` if local hardware/model is absent.
     - `PREFER_IN_CLOUD`: Prioritizes `gemini-1.5-flash`; falls back to on-device.
     - `ONLY_IN_CLOUD`: Fails closed with `CLOUD_APPROVAL_REQUIRED` if operator consent is absent.
   - **Foreground Enforcement**: Local inference is strictly rejected when running outside the foreground UI.
   - **Source Attribution**: All outputs tag the execution source (`ON_DEVICE`, `IN_CLOUD`, `MOCK`).
   - **Native Preprocessing**: Automatically downsamples images to 1024x1024 JPEG before model evaluation.

4. **Offline Outbox & WorkManager Sync (`sync/FieldSyncWorker.kt`)**:
   - Backed by Room SQLite database (`FieldRelayDatabase`).
   - Manages state transition: `draft` -> `redacted` -> `approved_for_sync` -> `synced`.
   - `FieldSyncWorker` flushes approved items to FastAPI `/sync/events` when network connectivity is detected.
   - Strictly no background AI model inference.

5. **Jetpack Compose UI Screens (`ui/FieldRelayScreens.kt`)**:
   - `ScannerScreen`: Camera preview, QR detection overlay, asset resolution.
   - `EvidenceCaptureScreen`: Multi-modal note taking, image attachment, telemetry verification.
   - `LocalInferenceScreen`: Mode toggle, on-device AICore status, single-turn triage evaluation.
   - `RedactionConsentScreen`: PII/sensitive data redaction, cloud upload consent flow.
   - `OutboxSyncScreen`: Offline queue status, sync trigger, Keystore encryption indicators.
   - `CapabilityStatusScreen`: Hardware floor status, AICore availability, network latency.

## Project Structure

```
apps/android/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── gradlew
├── gradlew.bat
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
│       └── gradle-wrapper.properties
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    ├── src/
    │   ├── main/
    │   │   ├── AndroidManifest.xml
    │   │   ├── res/
    │   │   │   ├── values/strings.xml, themes.xml
    │   │   │   └── xml/data_extraction_rules.xml
    │   │   └── java/dev/nexustitan/fieldrelay/
    │   │       ├── FieldRelayApp.kt
    │   │       ├── MainActivity.kt
    │   │       ├── ai/FirebaseAiLogicAdapter.kt
    │   │       ├── camera/SpatialMarkerScanner.kt
    │   │       ├── data/
    │   │       │   ├── AndroidKeystoreVault.kt
    │   │       │   ├── Entities.kt
    │   │       │   ├── OutboxDao.kt
    │   │       │   └── FieldRelayDatabase.kt
    │   │       ├── sync/FieldSyncWorker.kt
    │   │       └── ui/FieldRelayScreens.kt
    │   └── test/java/dev/nexustitan/fieldrelay/
    │       └── FieldRelayUnitTest.kt
```

## Toolchain & Verification

### Running Architectural Verification
In environments without Android Studio / JDK installed:
```powershell
node tests/android-scaffold.test.mjs
```

### Building with Android Studio or Gradle
Once JDK 17+ and Android SDK 35 are installed:
```bash
cd apps/android
./gradlew testDebugUnitTest
./gradlew assembleDebug
```
The output APK will be generated at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

### Installing on Device / Emulator
```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```
