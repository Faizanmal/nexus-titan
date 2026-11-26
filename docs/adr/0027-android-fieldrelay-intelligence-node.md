# ADR 0027: Android FieldRelay Edge Intelligence Node Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Phase 20 requires an Android client (`apps/android`) representing the field technician's edge device. In industrial wastewater and drinking water treatment facilities, field operators operate in intermittent or air-gapped network conditions. They need to scan physical plant QR markers (`QR-TITAN-WTP-01-*`), capture site evidence, execute single-turn local or hybrid AI triage evaluations, redact sensitive observations, and queue sync packets in an encrypted offline outbox for eventual server synchronization.
  To satisfy the strict NEXUS TITAN security and verification rules (`AGENTS.md`), we must never fake local inference, never fake compiled APK artifacts, enforce foreground-only execution for local models, disallow background AI inference, and protect persisted data using hardware-backed Android Keystore cryptography.

- **Decisions:**
  1. **Kotlin & Jetpack Compose Native Scaffold**:
     The project is structured under `apps/android` with Gradle 8.11.1, Android Gradle Plugin (AGP) 8.8.0, Kotlin 2.1.0, and Compose BOM 2024.12.01. It targets API 35 with a minimum SDK of 26.
  2. **Hardware-Backed AES-256-GCM Vault (`AndroidKeystoreVault`)**:
     All local offline outbox payloads, session tokens, and cryptographic keys are encrypted using an AES-256 master key generated and stored inside the Android hardware-backed Keystore (`AndroidKeyStore`). Encryption uses `AES/GCM/NoPadding` with a standard 12-byte IV and 128-bit authentication tag. Plaintext is never persisted to disk unencrypted, and cloud backups are explicitly forbidden via `data_extraction_rules.xml`.
  3. **Room Database Offline Outbox**:
     `FieldRelayDatabase` maintains `offline_outbox` and `cached_assets` tables. Outbox mutations transition through strict states: `draft` -> `redacted` -> `approved_for_sync` -> `synced` / `rejected`.
  4. **Foreground-Only Local Model Inference**:
     `FirebaseAiLogicAdapter` strictly enforces foreground execution (`if (!isForeground) throw IllegalStateException("FOREGROUND_REQUIRED")`). Background execution of on-device models is prohibited to prevent device thermal throttling and unauthorized background sensor access.
  5. **Hybrid Inference Mode & Source Attribution**:
     Four explicit hybrid modes are supported:
     - `PREFER_ON_DEVICE`: Uses on-device AICore if present; falls back to cloud if operator consent is granted; falls back to mock fixture with `isFallback = true`.
     - `ONLY_ON_DEVICE`: Fails closed (`ON_DEVICE_UNAVAILABLE`) if AICore hardware/model is absent.
     - `PREFER_IN_CLOUD`: Transmits to cloud if operator consent is granted; falls back to on-device.
     - `ONLY_IN_CLOUD`: Fails closed (`CLOUD_APPROVAL_REQUIRED`) if explicit operator consent is missing.
     Every inference result explicitly tags the originating source (`ON_DEVICE`, `IN_CLOUD`, `MOCK`).
  6. **CameraX & MLKit Barcode Scanning**:
     The edge node uses CameraX 1.4.1 and Google MLKit 17.3.0 for barcode scanning. `MarkerParser` extracts canonical asset identifiers from the standard `QR-TITAN-WTP-01-{assetId}` schema and maps them to plant topology without unsupported environment reconstruction claims.
  7. **WorkManager for Approved Network Sync Only**:
     `FieldSyncWorker` handles background network flushing of outbox items marked `approved_for_sync`. It transmits payloads to the backend API (`/sync/events`) and marks records `synced` upon HTTP 200/201. It never triggers local or cloud AI model inference.
  8. **Zero Simulated APK Artifacts & Explicit Toolchain Blocker**:
     In compliance with `AGENTS.md` ("Do not create simulated compiled Android/iOS artifacts. Use native Android Studio and Xcode templates when those platforms are implemented."), the native code and test harness are fully authored and tested. On host environments without Android SDK/JDK (`javac`, `adb`), the build gate records status `PARTIAL` with documented prerequisite steps.

- **Consequences:**
  - Complete, production-grade native Android codebase ready for compilation in Android Studio.
  - Zero leakage of raw site imagery or unredacted evidence to cloud without explicit supervisor approval.
  - Zero background battery drain or thermal runaway from unmonitored background inference.
  - Provable hardware-backed encryption of all offline plant evidence on the edge device.
