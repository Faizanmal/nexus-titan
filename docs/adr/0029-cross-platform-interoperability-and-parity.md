# ADR 0029: Cross-Platform Interoperability and Capability Parity Architecture

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Phase 22 requires cross-platform capability parity and wire interoperability across the Web Command Center (`apps/web`), the Android FieldRelay Node (`apps/android`), and the iOS FieldRelay Node (`apps/ios`). Technicians in industrial water facilities operate diverse client devices that must communicate over intermittent or air-gapped networks, exchange synchronized telemetry, verify cryptographic device proofs, and preserve transactional outbox integrity without fabricating compilation or runtime claims on unsupported hosts.

- **Decisions:**
  1. **Canonical Contract v1.3.0 & Serialization Alignment**:
     All wire models, timestamps (ISO-8601 UTC), data classifications, event schemas, and triage responses are unified across TypeScript (`@nexus-titan/contracts`), Python (`nexus_titan_api.generated_contracts`), Kotlin (`dev.nexustitan.contracts`), and Swift (`NexusTitanContracts`). Deterministic JSON serialization (`canonical_json`) produces identical SHA-256 digests bit-for-bit regardless of platform key sorting.
  2. **Dual-Algorithm Device Signature Verification**:
     FastAPI `/sync/events` accepts and verifies both:
     - **Ed25519**: Preferred for Web (Web Crypto API) and lightweight mobile nodes.
     - **ECDSA SECP256R1 SHA-256**: Hardware-backed standard for Apple Secure Enclave (`CryptoKit`) and Android Keystore.
  3. **Strict Negative Security Rejections**:
     - **Tampered Payload**: Any alteration of event content after signing fails cryptographic verification with HTTP 403 `DEVICE_PROOF_INVALID`.
     - **Cross-Tenant Exfiltration**: Device attempts to submit events for unauthorized tenants fail with HTTP 403 `DEVICE_NOT_TRUSTED` or `TENANT_SCOPE_VIOLATION`.
     - **Site Scope Violations**: Operator attempts to write outside permitted site IDs are rejected per-event with `SITE_SCOPE_VIOLATION`.
  4. **Offline Queue Migration & Forward Compatibility**:
     `queue_migration.py` provides deterministic schema migration from legacy versions (`v1.0.0`, `v1.1.0`, `v1.2.0`) to canonical `v1.3.0`, backfilling UTC timestamps and default classifications before committing to the canonical event store.
  5. **Exactly-Once Offline Synchronization (Deduplication)**:
     Event UUIDs serve as natural idempotency keys in `/sync/events`. Initial uploads return `status: "accepted"`; replays or retransmissions return `status: "duplicate"`, preventing duplicate database insertions or telemetry corruption.
  6. **Transparent Device Matrix & Blocker Accounting**:
     In strict compliance with `AGENTS.md`, the platform capability matrix ([/mesh](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/mesh/page.tsx) and `/v1/organizations/{id}/mesh/conformance`) explicitly labels:
     - **Web**: `VERIFIED` (Primary operational contest platform running on Chromium / Node 26).
     - **Android**: `PARTIAL_SOURCE_VERIFIED` (Source architecture, Keystore AES-256-GCM, and Room outbox verified; native compilation blocked on missing host Android SDK/JDK).
     - **iOS**: `PARTIAL_SOURCE_VERIFIED` (Source architecture, Keychain AES-256-GCM, and Vision OCR verified; native compilation blocked on missing host macOS/Xcode).
  7. **Universal Foreground-Only Local AI Constraint**:
     All three platforms enforce an identical constraint: on-device model evaluation requires active foreground UI state (`isForeground == true`), eliminating unmonitored background battery/thermal drain.

- **Consequences:**
  - True cross-platform protocol interoperability with provable byte-level deterministic hashes.
  - Zero tolerance for tampered, revoked, or cross-tenant event batches.
  - Safe, idempotent offline synchronization for air-gapped field operations.
  - Honest compliance and blocker documentation adhering strictly to project rules.
