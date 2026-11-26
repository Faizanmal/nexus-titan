# NEXUS TITAN iOS FieldRelay Edge Intelligence Node

## Overview

The `apps/ios` module provides the native Apple iOS client for NEXUS TITAN field technicians and operators. It functions as an edge intelligence node supporting air-gapped plant operation, on-device Apple Intelligence, and local peer mesh networking.

## Architecture & Core Modules

1. **Spatial Asset Marker Scanner (`Vision/SpatialMarkerScanner.swift`)**:
   - Integrates AVFoundation and Apple Vision framework (`VNDetectBarcodesRequest`).
   - Scans physical equipment QR markers adhering to `QR-TITAN-WTP-01-{canonicalAssetId}` (e.g. `QR-TITAN-WTP-01-WTP01-PMP-001`).
   - Resolves assets against cached plant topology without unsupported 3D reconstruction claims.

2. **On-Device Vision OCR (`Vision/VisionTextRecognizer.swift`)**:
   - Extracts alphanumeric text from physical gauge dials, serial tags, and warning plaques using `VNRecognizeTextRequest`.
   - Keeps raw images strictly on the local device; provides editable text for technician review before AI triage.

3. **Keychain Hardware Vault (`Security/KeychainVault.swift`)**:
   - Generates and manages a 256-bit AES master key in the iOS Keychain (`kSecClassGenericPassword`).
   - Encrypts offline outbox payloads and credentials using CryptoKit `AES.GCM` (12-byte nonce, 128-bit authentication tag).
   - Enforces `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.

4. **Hybrid AI Logic Adapter (`AI/FirebaseAiLogicAdapter.swift`)**:
   - Supports 4 operational modes:
     - `preferOnDevice`: Prioritizes Apple Intelligence / system language model; falls back to cloud if consented and non-restricted.
     - `onlyOnDevice`: Fails closed (`ON_DEVICE_UNAVAILABLE`) if Apple Intelligence is absent.
     - `preferInCloud`: Prioritizes cloud `gemini-1.5-flash`; falls back to on-device.
     - `onlyInCloud`: Fails closed (`CLOUD_APPROVAL_REQUIRED`) without consent; rejects restricted data with `RESTRICTED_FALLBACK_PROHIBITED`.
   - **Foreground Enforcement**: Local inference strictly requires an active foreground application state (`isForeground == true`).
   - **Restricted Data Boundary**: Data classified as `DataClassification.restricted` is permanently blocked from cloud transmission.

5. **Local Peer Mesh (`Mesh/MultipeerMeshTransport.swift`)**:
   - Uses Apple `MultipeerConnectivity` (`MCSession`, `MCNearbyServiceAdvertiser`, `MCNearbyServiceBrowser`).
   - Service type: `nexus-mesh` (`_nexus-mesh._tcp`, `_nexus-mesh._udp`).
   - Operates over local Wi-Fi or peer-to-peer Wi-Fi/Bluetooth without cloud infrastructure.

6. **Offline Transactional Outbox (`Storage/FieldRelayOutbox.swift`)**:
   - Tracks item lifecycle: `draft` -> `redacted` -> `approvedForSync` -> `synced` / `rejected`.
   - Flushes approved items to FastAPI `/sync/events` when connectivity is established.
   - Strictly zero background AI model inference in sync routines.

7. **SwiftUI Interface (`UI/FieldRelayViews.swift`, `App/FieldRelayApp.swift`)**:
   - `FieldRelayRootView`: Tabbed interface linking `MarkerScannerView`, `EvidenceCaptureView`, `LocalInferenceView`, `PrivacyConsentView`, `OutboxSyncView`, `PeerMeshView`, and `CapabilityStatusView`.

## Project Structure

```
apps/ios/
├── Package.swift
├── FieldRelay.xcodeproj/
│   └── project.pbxproj
└── FieldRelay/
    ├── Info.plist
    ├── Sources/
    │   ├── App/
    │   │   └── FieldRelayApp.swift
    │   ├── Security/
    │   │   └── KeychainVault.swift
    │   ├── Storage/
    │   │   └── FieldRelayOutbox.swift
    │   ├── Vision/
    │   │   ├── SpatialMarkerScanner.swift
    │   │   └── VisionTextRecognizer.swift
    │   ├── AI/
    │   │   └── FirebaseAiLogicAdapter.swift
    │   ├── Mesh/
    │   │   └── MultipeerMeshTransport.swift
    │   └── UI/
    │       └── FieldRelayViews.swift
    └── Tests/
        └── FieldRelayTests/
            └── FieldRelayTests.swift
```

## Build & Test Instructions (macOS / Xcode)

### 1. Opening in Xcode
On a Mac with Xcode 15+ installed:
```bash
open apps/ios/FieldRelay.xcodeproj
```
Swift Package Manager will automatically resolve `firebase-ios-sdk` (11.8.0) and local package `NexusTitanContracts`.

### 2. Running XCTest Suite
```bash
xcodebuild test \
  -project apps/ios/FieldRelay.xcodeproj \
  -scheme FieldRelayTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=latest'
```

### 3. Building Debug Archive / App
```bash
xcodebuild archive \
  -project apps/ios/FieldRelay.xcodeproj \
  -scheme FieldRelay \
  -destination 'generic/platform=iOS' \
  -archivePath ./build/FieldRelay.xcarchive
```

### 4. Code Signing & TestFlight Distribution
Configure code signing identity and provisioning profiles in Xcode Project Settings:
- Target: `FieldRelay`
- Bundle Identifier: `dev.nexustitan.FieldRelay`
- Signing: Apple Development / Apple Distribution certificate
- Upload to App Store Connect / TestFlight via `xcodebuild -exportArchive`.

## Local Compliance Verification (Windows / Cross-Platform)

In environments without macOS / Xcode:
```powershell
node tests/ios-scaffold.test.mjs
```
Validates file structure, Info.plist minimal permissions, Package.swift dependencies, Keychain vault security, hybrid AI logic policies, restricted data boundaries, and SwiftUI view components.
