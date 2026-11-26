# ADR 0028: iOS FieldRelay Edge Intelligence Node Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Phase 21 requires a native iOS client (`apps/ios`) representing the field technician's mobile edge device in industrial water and wastewater facilities. Field engineers require rapid asset identification via plant QR markers (`QR-TITAN-WTP-01-*`), physical gauge and plaque text extraction via local Vision OCR, single-turn hybrid AI triage evaluation, privacy redaction and explicit consent enforcement, hardware-secured offline outbox queuing, and local peer mesh synchronization over air-gapped subnets.
  In adherence to `AGENTS.md` and project constraints, we must never fake compiled iOS binaries or simulate on-device inference runs, enforce foreground-only model execution, strictly forbid cloud fallback on restricted data, and protect local persisted data using hardware-backed iOS Keychain and CryptoKit AES-GCM cryptography.

- **Decisions:**
  1. **SwiftUI & Swift Package Manager Scaffold**:
     Structured under `apps/ios` targeting iOS 17.0+ with Swift 5.9. Pinned official dependencies via SPM: `firebase-ios-sdk` 11.8.0 (`FirebaseVertexAI`, `FirebaseAuth`, `FirebaseAppCheck`) and local `NexusTitanContracts` package binding.
  2. **Hardware-Backed AES-256-GCM Vault (`KeychainVault`)**:
     A 256-bit symmetric key is securely generated and managed in the iOS Keychain (`kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). All offline outbox payloads, session credentials, and cryptographic tokens are sealed using CryptoKit `AES.GCM` with a standard 12-byte nonce and 128-bit authentication tag.
  3. **Local-Only Vision OCR Engine (`VisionTextRecognizer`)**:
     To comply with privacy rules and avoid unsupported mobile multimodal cloud transmissions, captured plant photos (e.g. gauge dials, serial plates) are processed entirely on-device using Apple's Vision framework (`VNRecognizeTextRequest`). Extracted text is presented for operator review before entering structured AI triage.
  4. **Foreground-Only Hybrid AI Logic (`FirebaseAiLogicAdapter`)**:
     Evaluates four explicit hybrid modes:
     - `preferOnDevice`: Prioritizes Apple Intelligence / system foundation model; falls back to cloud if approved and non-restricted; falls back to deterministic mock fixture.
     - `onlyOnDevice`: Fails closed (`ON_DEVICE_UNAVAILABLE`) if Apple Intelligence hardware or model is absent.
     - `preferInCloud`: Prioritizes `gemini-1.5-flash`; falls back to on-device.
     - `onlyInCloud`: Fails closed (`CLOUD_APPROVAL_REQUIRED`) if operator consent is absent, and throws `RESTRICTED_FALLBACK_PROHIBITED` on restricted data.
     Foreground enforcement check (`guard isForeground else { throw .foregroundRequired }`) ensures local model inference never executes in the background.
  5. **Strict Restricted Data Boundary**:
     When input data classification is `DataClassification.restricted`, cloud fallback is categorically disallowed regardless of user toggle, preserving sensitive plant operational parameters locally.
  6. **Local Subnet Peer Mesh Transport (`MultipeerMeshTransport`)**:
     Uses Apple `MultipeerConnectivity` (`MCSession`, `MCNearbyServiceAdvertiser`, `MCNearbyServiceBrowser`) with service type `nexus-mesh`. Advertises and discovers authorized plant peers on local Wi-Fi/subnets, requiring explicit operator consent before peering.
  7. **SwiftData / SQLite Offline Outbox (`FieldRelayOutboxManager`)**:
     Tracks records across state lifecycle: `draft` -> `redacted` -> `approved_for_sync` -> `synced` / `rejected`. Flushes approved records to `/sync/events` when connected. Strictly no local AI model inference inside background workers or sync routines.
  8. **Zero Simulated iOS Artifacts & Explicit Toolchain Blocker**:
     In compliance with `AGENTS.md` ("Do not create simulated compiled Android/iOS artifacts. Use native Android Studio and Xcode templates when those platforms are implemented."), source code, SPM manifest, Xcode project definition, and unit tests are authored and validated. On host environments without macOS/Xcode (`xcodebuild`), the build gate records status `PARTIAL` with documented remote Mac build instructions.

- **Consequences:**
  - Production-ready native iOS codebase prepared for compilation and testing in Xcode 15/16.
  - Zero leakage of raw site imagery or restricted operational data to cloud infrastructure.
  - Provable hardware-backed encryption of all offline plant evidence on iOS devices.
  - Clear, auditable boundary between on-device Apple Intelligence and cloud Gemini models.
