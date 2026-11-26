# ADR 0033: Security Architecture, Threat Modeling, Privacy Boundaries, and Abuse Prevention

- **Status:** Accepted
- **Date:** 2026-11-18
- **Context:**
  Critical infrastructure command centers must withstand rigorous adversarial threat vectors: broken object-level authorization (IDOR), unauthorized cloud AI data leaks, prompt injection attacks, malicious file uploads, token replay, dependency vulnerabilities, and abuse of demo sandboxes. Phase 26 establishes a comprehensive security review, automated secret scanning, dependency vulnerability audit, least-privilege cloud security rules, and formal industrial physical isolation guarantees.

- **Decisions:**
  1. **Comprehensive STRIDE Threat Model & Authorization Matrix (`docs/security/threat-model.md`)**:
     - Completed exhaustive threat modeling across all 6 STRIDE categories (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) mapped to 16 attack surfaces.
     - Enforced mandatory tenant isolation and IDOR mitigation on every API route (`/v1/world/*`, `/v1/telemetry/*`, `/v1/recovery/*`, `/sync/*`), binding data queries strictly to the verified tenant membership of the authenticated `Actor`. Cross-tenant requests fail closed with HTTP 403 `ROLE_FORBIDDEN` or 404.
  2. **Negative Authentication & App Check Enforcement**:
     - Verified fail-closed behavior for missing `Authorization` headers (HTTP 401 `AUTH_REQUIRED`), malformed tokens, and expired tokens (HTTP 401 `INVALID_ID_TOKEN`).
     - Enforced Firebase App Check device attestation on all mutation and query endpoints (`APPCHECK_REQUIRED`, `INVALID_APPCHECK_TOKEN`).
     - Mismatched App ID tokens are strictly rejected with HTTP 403 `APPCHECK_WRONG_APP`.
     - Debug token bypass is strictly disabled when `APP_ENV != "local"`.
  3. **Least-Privilege Storage & Firestore Rules (`firestore.rules` & `storage.rules`)**:
     - Projections: Clients have read-only access scoped strictly by site membership; `allow create, update, delete: if false;` ensures only the trusted backend server can mutate read models.
     - Storage Artifacts: Uploads require an approved, unexpired Firestore upload authorization token created by server-side logic.
     - Strict 15 MB size ceiling (`request.resource.size <= 15 * 1024 * 1024`) and strict MIME whitelist (`application/pdf`, `image/jpeg`, `image/png`).
     - Default-deny rules on all undefined collections and storage paths.
  4. **Prompt Injection & Untrusted Tool Isolation**:
     - Field inspection notes, technician observations, and OCR data are quarantined as untrusted evidence fields within typed JSON payloads; they are never formatted as system prompt instructions.
     - LLM agent outputs are constrained to rigid JSON schemas. Any schema mismatch or unrecognized key is rejected.
     - AI agents possess zero direct actuation capabilities; interventions are restricted to in-memory linear hydraulic simulations (`virtual_backup`, `synthetic_resistance`).
  5. **Supply Chain, SBOM, and Secret Scanning**:
     - Pinned dependencies with exact lockfiles (`pnpm-lock.yaml`, `services/api/uv.lock`). Resolved `@grpc/grpc-js` vulnerability via workspace override (`^1.13.6`); `pnpm audit --prod` reports **0 known vulnerabilities**.
     - Automated static secret scanning across 359 repository source files confirms **0 hardcoded credentials, tokens, or private keys**.
     - Compiled Software Bill of Materials (SBOM) and License Inventory ([docs/security/sbom-license-inventory.md](file:///j:/Hackathons/Devpost/nexus-titan/docs/security/sbom-license-inventory.md)) confirming 100% permissive open-source licenses (MIT, Apache-2.0, BSD-3-Clause, LGPL-3.0 with runtime exception) with zero copyleft or proprietary contamination.
  6. **Zero Industrial Physical Sockets (Industrial Floor)**:
     - Purely synthetic linear hydraulic solver (`nexus-linear-hydraulic-fixture-v1`) executing on fictional plant `TITAN-WTP-01`.
     - Explicit architectural guarantee: zero live network sockets or industrial protocols (Modbus, DNP3, BACnet, OPC-UA, EtherNet/IP) connecting to physical industrial control systems or PLCs.

- **Consequences:**
  - Complete defense-in-depth security architecture protecting tenant boundaries, device credentials, cloud storage, and AI reasoning pipelines.
  - Transparent, reproducible audit artifacts ([phase-26-security-audit.json](file:///j:/Hackathons/Devpost/nexus-titan/docs/evidence/phase-26-security-audit.json)).
