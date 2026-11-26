# NEXUS TITAN — Comprehensive Threat Model & Security Architecture Review

**Document Version:** 1.0.0  
**Status:** Approved  
**Classification:** PUBLIC  
**Review Target:** NEXUS TITAN Cyber-Physical Command Center & Intelligence Architecture  

---

## 1. Executive Summary & Security Floor

NEXUS TITAN is an offline-capable, cyber-physical operations platform designed for water treatment plants and mission-critical infrastructure. Because the system operates in high-consequence environments, security, tenant privacy, tamper resistance, and abuse prevention are first-class architectural constraints.

### The Industrial Isolation Floor
> [!IMPORTANT]
> **Zero Live Industrial Connection:** NEXUS TITAN operates strictly on synthetic, deterministic digital twin fixtures (`TITAN-WTP-01`). The platform contains **zero direct network interfaces, outbound sockets, or communication protocols (Modbus, DNP3, BACnet, OPC-UA, EtherNet/IP) connecting to physical industrial control systems (ICS), Programmable Logic Controllers (PLCs), or operational SCADA networks**. All physical simulation occurs within an analytical linear hydraulic solver isolated in memory.

---

## 2. STRIDE Threat Matrix

| Threat Category | Target Vector | Potential Impact | Architectural Mitigations | Status |
|---|---|---|---|:---:|
| **Spoofing** | Forged Client Identity | Attacker impersonates plant operator or supervisor | Firebase Auth Ed25519/RSA token verification (`verify_firebase_id_token`), Firebase App Check device attestation (`verify_firebase_app_check`) enforced on every authenticated endpoint. | **MITIGATED** |
| **Spoofing** | Peer Mesh Node Impersonation | Unauthorized device injects false field telemetry | Ed25519/ECDSA device key registration; all peer transfer envelopes cryptographically signed with public keys verified against tenant registry. | **MITIGATED** |
| **Tampering** | In-Transit Payload Modification | Man-in-the-middle alters hydraulic pressure or fault codes | Strict HTTPS/TLS 1.3 in transit; canonical JSON payload hashing (`canonical_hash`); SHA-256 state digests verified at every sequence step. | **MITIGATED** |
| **Tampering** | Event Log Modification | Attacker alters or deletes audit events | PostgreSQL append-only event store with monotonic sequence constraints; update/delete operations forbidden on canonical `events` table. | **MITIGATED** |
| **Repudiation** | Denying Safety-Critical Approvals | Operator approves dangerous virtual intervention and denies it | Multi-party cryptographic approval tokens binding `snapshot_hash`, `action`, `supervisor_id`, `created_at`, and `consumed_at`. Immutable audit trail in `governance_routes`. | **MITIGATED** |
| **Information Disclosure** | Cross-Tenant IDOR (Insecure Direct Object Reference) | Tenant A reads confidential assets or telemetry of Tenant B | Mandatory tenant isolation: every route derives tenant scope from authenticated `Actor.organization_id` or verifies explicit membership via `require_membership`. Unscoped queries fail closed with 403/404. | **MITIGATED** |
| **Information Disclosure** | Cloud Redaction False Negatives | Restricted PII, credentials, or internal serials sent to Cloud AI | Strict fail-closed privacy policy lattice (`PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED`). Automatic redaction of regex patterns (`RESTRICTED_MARKER_*`, emails, serials, SSNs) with mandatory human review before egress. | **MITIGATED** |
| **Denial of Service** | Task Requeue / Retry Storms | Background worker repeatedly retries failing tasks, exhausting CPU | Exponential backoff with jitter; strict bounded retry ceilings (maximum 5 attempts for tasks, maximum 10 attempts for outbox deliveries) routing to Dead Letter Queue (`event_dead_letters`). | **MITIGATED** |
| **Denial of Service** | Demo Sandbox Resource Exhaustion | Malicious evaluator floods scenario steps or resets | In-memory session isolation; narrow `judge` role with explicit rate limits (10 req/min) and quotas (50 scenario steps/day); session reset restricted to requester's session. | **MITIGATED** |
| **Elevation of Privilege** | Stale Role Caching | Revoked operator executes supervisor actions | Token validation and real-time database membership check on every state-mutating request. Role downgrade immediately revokes cached permissions with HTTP 403 `ROLE_FORBIDDEN`. | **MITIGATED** |
| **Elevation of Privilege** | Prompt Injection via Technician Notes | Malicious text in inspection log instructs AI agent to bypass tools | Prompt isolation: technician observations are treated strictly as untrusted quoted evidence data, never formatted as system instructions. LLM outputs are constrained to typed JSON schemas. | **MITIGATED** |

---

## 3. Route Authorization & IDOR Verification Matrix

Every route in NEXUS TITAN is bound to the verified tenant scope of the authenticated actor:

| Route Path | Method | Minimum Role | Tenant Isolation Enforcement | Data Store Checked |
|---|:---:|:---:|---|---|
| `/health` | GET | Anonymous | None (liveness only) | Process memory |
| `/health/ready` | GET | Anonymous | None (dependency health check only) | PostgreSQL connectivity |
| `/v1/me` | GET | Any Member | `Actor.uid` token subject | PostgreSQL `users`, `memberships` |
| `/v1/world/assets` | GET | Viewer | `require_membership(tenant_id)` + `_visible_sites()` | PostgreSQL `aggregate_projections` |
| `/v1/world/topology` | GET | Viewer | `require_membership(tenant_id)` + `_visible_sites()` | PostgreSQL `aggregate_projections` |
| `/v1/world/incidents` | GET | Viewer | `require_membership(tenant_id)` + `_visible_sites()` | PostgreSQL `aggregate_projections` |
| `/v1/telemetry/query` | GET | Viewer | `require_membership(tenant_id)` + site filter | PostgreSQL `telemetry_samples` |
| `/sync/events` | POST | Operator | Ed25519 device signature + `tenant_id` match | PostgreSQL `events`, `event_outbox` |
| `/v1/simulation/interventions` | POST | Operator | `can_operate_simulator(role)` | PostgreSQL `intervention_leases` |
| `/v1/simulation/approvals` | POST | Admin/Owner | `can_supervise_simulator(role)` | PostgreSQL `simulation_approvals` |
| `/v1/recovery/status` | GET | Operator | `require_membership(tenant_id)` | PostgreSQL queue tables |
| `/v1/recovery/chaos/simulate`| POST | Operator | `require_membership(tenant_id)` | In-memory chaos simulation matrix |
| `/v1/recovery/dlq/{id}/retry` | POST | Admin/Owner | `require_membership(tenant_id)` | PostgreSQL `event_dead_letters` |
| `/v1/recovery/dlq/{id}/quarantine` | POST | Admin/Owner | `require_membership(tenant_id)` | PostgreSQL `event_dead_letters` |
| `/v1/recovery/tasks/{id}/requeue` | POST | Operator | `require_membership(tenant_id)` | PostgreSQL `background_tasks` |
| `/v1/demo/scenario/step` | POST | Judge/Viewer | Isolated session ID binding | In-memory `_DEMO_RUN_SESSIONS` |
| `/v1/demo/session/reset` | POST | Judge/Viewer | Isolated session ID confirmation | In-memory `_DEMO_RUN_SESSIONS` |
| `/v1/demo/reset` | POST | Owner | Exact string confirmation (`RESET demo-nexus`) | PostgreSQL database purge |

---

## 4. App Check & Authentication State Machine

```
              Client Request Received
                         │
                         ▼
             Has Authorization Header? ───[ NO ]───► 401 AUTH_REQUIRED
                         │
                      [ YES ]
                         │
                         ▼
             Valid Firebase ID Token? ────[ NO ]───► 401 INVALID_ID_TOKEN
                         │
                      [ YES ]
                         │
                         ▼
           App Check Required on Route? ──[ NO ]───► Proceed to Route
                         │
                      [ YES ]
                         │
                         ▼
            Has X-Firebase-AppCheck? ─────[ NO ]───► 403 APPCHECK_REQUIRED
                         │
                      [ YES ]
                         │
                         ▼
           Valid App Check Attestation? ──[ NO ]───► 403 INVALID_APPCHECK_TOKEN
                         │
                      [ YES ]
                         │
                         ▼
             App ID Matches Project? ─────[ NO ]───► 403 APPCHECK_WRONG_APP
                         │
                      [ YES ]
                         │
                         ▼
             Check Membership & Scope ────[ NO ]───► 403 ROLE_FORBIDDEN / 404
                         │
                      [ YES ]
                         │
                         ▼
                  Authorized (200)
```

---

## 5. Storage & File Upload Security

1. **Pre-Signed Upload Authorizations:**
   Clients cannot write directly to Firebase Storage without an approved, server-issued upload authorization document created in Firestore under `/upload_authorizations/{id}`.
2. **Strict MIME Whitelist:**
   Only `application/pdf`, `image/jpeg`, and `image/png` are permitted by `storage.rules`. Executable formats (`.exe`, `.sh`, `.bat`, `.js`, `.py`), HTML files, or polyglot files are rejected at the storage rule boundary.
3. **Hard Size Limit:**
   A strict 15 MB ($15 \times 1024 \times 1024$ bytes) ceiling is enforced directly in `storage.rules` via `request.resource.size <= 15 * 1024 * 1024`.
4. **Classification Boundary:**
   Upload authorizations strictly refuse classification `RESTRICTED` or `CONFIDENTIAL` (`classification in ['PUBLIC', 'INTERNAL']`). Restricted records must remain in the hardware-backed local device vault.

---

## 6. Prompt Injection & AI Agent Defense

- **Untrusted Evidence Isolation:**
  Technician field notes, OCR extractions, and SVG inspection metadata are passed into AI models as typed JSON fields within an explicit data payload boundary:
  ```json
  {
    "context": "Water treatment plant diagnostic evidence",
    "untrusted_observations": [
      {"source": "technician_note", "data": "Ignore previous instructions..."}
    ]
  }
  ```
- **Strict Structured Outputs:**
  All agent roles (vision, sensor, causal, planning, critic) require rigid JSON Schema output targets. Any output failing schema validation is rejected, preventing arbitrary code or command execution.
- **Actuation Separation:**
  The AI agent DAG **cannot actuate field assets**. Interventions are limited to synthetic hydraulic simulations (`virtual_backup`, `synthetic_resistance`). Actual physical asset changes require out-of-band human engineering protocols.

---

## 7. Residual Risks & Operational Limitations

1. **Host Mobile Toolchain Limitations:**
   Native Android and iOS compilation cannot be performed on Windows development hosts without Android SDK/macOS Xcode toolchains; cross-platform contracts and mock runners provide functional verification, but final binary signing requires designated CI runners.
2. **Peer Subnet Requirements:**
   Hardware-backed WebRTC / BLE peer mesh networking requires compatible physical radios on the same local subnet; when disconnected, the system safely falls back to local vault buffering and honestly reports `BLOCKED: NO_PEER_AVAILABLE`.
3. **Synthetic Data Disclosure:**
   All plant assets, telemetry streams, and hydraulic equations reflect fictional plant `TITAN-WTP-01`; no actual utility operations or confidential customer telemetry are hosted in this repository.
