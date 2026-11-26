# NEXUS TITAN — Judge & Evaluator Usability Walkthrough

This guide provides an end-to-end, 5-minute evaluation path for hackathon judges, technical reviewers, and operators assessing the **NEXUS TITAN** hybrid edge-cloud industrial intelligence platform.

> [!IMPORTANT]
> **Zero Industrial Connection Notice**: NEXUS TITAN operates exclusively on a strictly fictional, mathematically deterministic linear hydraulic model simulating water treatment facility **`TITAN-WTP-01`**. Actions, agent workflows, and model outputs do **not** open physical sockets or control real-world industrial infrastructure.

---

## 1. Quick Start & Role Personas

NEXUS TITAN adapts its user interface, data projections, and security authorization across 5 distinct personas:

| Persona | Primary Role & Workspace | Key Capabilities & Evaluation Focus |
| :--- | :--- | :--- |
| **Fresh User / Evaluator** | [Overview & Access](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/page.tsx) (`/`) | Fast onboarding, workspace tenant selection, theme toggle, and keyboard shortcuts (`⌘K`). |
| **Field Technician** | [FieldRelay Workspace](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/field/page.tsx) (`/field`, `/fieldrelay`) | Offline evidence capture, encrypted local keychain storage, zero-PII redaction, and peer mesh transfer. |
| **Incident Investigator** | [Causal Investigation](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/causal/page.tsx) (`/causal`, `/knowledge`) | Multi-hypothesis causal graph DAGs, vector knowledge citations, and uncertainty quantification. |
| **Operations Supervisor** | [Simulation & Solvers](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/simulation/page.tsx) (`/simulation`, `/mission`) | Counterfactual hydraulic solver evaluation, financial preservation trade-offs, and state approvals. |
| **Hackathon Judge** | [Flagship Demo](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/demo/page.tsx) (`/demo`, `/recovery`) | Dedicated judge sandbox onboarding, 14-step guided scenario, chaos matrix, and cryptographic audit trace. |

---

## 2. Command Palette & Navigation (`⌘K`)

Press **`⌘K`** (macOS) or **`Ctrl+K`** (Windows/Linux) from any route in the application to summon the accessible **Command Palette**:
- **Searchable Routes**: Real-time filtering across all 19 application destinations with description previews.
- **Keyboard Discoverability**: Use <kbd>↑</kbd> and <kbd>↓</kbd> arrows to navigate, <kbd>Enter</kbd> to jump to route, and <kbd>Esc</kbd> to dismiss.
- **Focus Trap**: Implements WAI-ARIA modal dialog focus containment (`trapTab`) preventing keyboard focus from escaping.
- **Theme Switcher**: Header toggle immediately swaps color tokens between High-Contrast Dark (`data-theme="dark"`) and Light (`data-theme="light"`), meeting WCAG 2.1 AA ($\ge 4.5:1$ contrast ratio).

---

## 3. Flagship 14-Step Incident Walkthrough (`/demo`)

Navigate to **`/demo`** ([Demo Setup & Flagship Scenario](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/demo/page.tsx)) for the flagship, cryptographically verified evaluation.

### Step 0: Judge Sandbox Onboarding
1. Under **Contest Judge Sandbox Evaluation**, enter your alias (e.g. `Judge-Alpha`).
2. Click **Onboard Judge Sandbox**.
3. *Verified State*: Returns a restricted sandbox profile with quota allocations (e.g., 50 simulation units, 20 agent runs) and explicit denial of destructive production mutations.

### 14-Step Guided Lifecycle
Step through each phase using the interactive step cues:

| Step # | Stage Name | Provenance Badge | What to Verify in UI |
| :---: | :--- | :--- | :--- |
| **1** | **Normal Plant** | `BASELINE` | Synthetic baseline telemetry on Pump `P-101` (Flow: 14.8 m³/h, Pressure: 412 kPa, Vibration: 1.8 mm/s). |
| **2** | **Fault Injection** | `SYNTHETIC_FAULT` | Injected hydraulic anomaly (cavitation / bearing thermal / seal breach). Plant alert triggered. |
| **3** | **Field Evidence** | `EDGE_CAPTURE` | Technician captures dial readings and QR markers (`QR-P101-DISCHARGE`). Disagreement detection selectable. |
| **4** | **Offline Local AI** | `LOCAL_ON_DEVICE` | Runs local edge classifier while network is offline. **Zero restricted bytes egressed**; outbox sealed in AES-256-GCM vault. |
| **5** | **Redaction Approval** | `OPERATOR_CONSENT` | Visual redaction preview. Technician explicitly approves stripped payload (PII and raw photo bytes retained locally). |
| **6** | **Peer Transfer** | `HYBRID_EDGE` | Evaluates local subnet mesh transfer. Reports honest BLE/Wi-Fi Direct hardware blocker when radio unavailable. |
| **7** | **Canonical Sync** | `ED25519_VERIFIED` | Edge node reconnects; syncs events via Ed25519 signatures. Verifies duplicate idempotent rejection. |
| **8** | **Cloud Inference** | `CLOUD_BACKEND` | Firebase Cloud / Gemini 3.5 Flash inference on sanitized context. Provenance note disallows mock masquerading. |
| **9** | **Causal Agent DAG** | `HYBRID_EDGE` | 4-agent parallel execution DAG: Hydraulic Diagnostician, Sensor Validator, Risk Estimator, Planner. |
| **10** | **Solver Scenarios** | `SOLVER_MATH` | Evaluates counterfactual solver outcomes: Plan A (\$1,250 repair) vs Plan B (\$3,400 switchover) vs No Action (\$65,400 failure). **Asset Preservation: \$64,150**. |
| **11** | **Stale Approval Error** | `CONCURRENCY_409` | Proves race condition prevention: submitting an approval against an outdated projection sequence raises HTTP 409 Conflict. |
| **12** | **Supervisor Plan** | `SUPERVISOR_ROLE` | Authorized supervisor signs the final mitigation action; projection increments deterministically. |
| **13** | **Twin Update** | `SPATIAL_RECONCILE` | Digital twin state updates; bypass valve throttled to 45% and flow routed to standby pump `P-102`. |
| **14** | **Incident Replay** | `DETERMINISTIC_HASH` | Interactive timeline scrubber over 14 historical event states with SHA-256 state hash comparison. |

> [!TIP]
> **Zero Global State Impact**: Click **Reset Demo Run (Isolated)** at any time. It generates fresh session and correlation IDs without affecting persistent database records.

---

## 4. Disaster Recovery & Chaos Resiliency (`/recovery`)

Navigate to **`/recovery`** ([Disaster Recovery & Chaos](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/recovery/page.tsx)) to evaluate system resilience under hostile conditions:

1. **16-Vector Chaos Matrix**:
   - Dropped WAN connection, Peer disconnect, Expired activity lease, Duplicate/out-of-order events.
   - Worker crash mid-activity, Outbox publish crash, NATS unavailable, Postgres restart.
   - Firestore projection lag, Model quota exhaustion, Malformed response schema, Stale policy rejection.
   - Invalid device clock skew, Browser storage quota exhaustion, Network partition, Dead-letter quarantine.
2. **Interactive Failure Injection**: Click **Simulate Failure Vector** on any card to view real-time recovery timing (typically 4.2–12.8 ms) and verified invariant assertions.
3. **Operational Runbook Actions**:
   - Inspect Dead Letter Queue (DLQ) with one-click retry.
   - Requeue allowed tasks with bounded retry counters (max 5 attempts).
   - Rotate mobile node cryptographic keypairs with 5-minute dual-signature grace periods.
   - Restore isolated point-in-time snapshots onto scratch schemas for root-cause forensics.

---

## 5. Digital Twin & Accessibility (`/world`)

Navigate to **`/world`** ([Digital Twin & Asset Topology](file:///j:/Hackathons/Devpost/nexus-titan/apps/web/src/app/world/page.tsx)) to evaluate spatial representations:

1. **3D Three.js WebGL Canvas**:
   - 120 canonical plant assets with 100% procedural geometry (zero unlicensed third-party models).
   - Camera bookmarks: Overview, Intake Pumps, Filtration Basin, Chemical Dosing, High-Pressure Discharge.
   - Spatial marker inspector with physical plant grid coordinates ($[E, N, U]$).
2. **Accessible 2D Topology Alternative**:
   - Interactive SVG schematic coordinate grid for devices or users unable to use 3D WebGL.
   - Keyboard accessible nodes with high-contrast health indicators.
3. **Screen-Reader Asset Topology Table**:
   - Complete tabular inventory with live search filtering, `<caption className="sr-only">`, and `<th scope="col">` column headers.

---

## 6. How Hybrid AI Provenance is Verified in Seconds

Judges can verify that NEXUS TITAN never fabricates inference results or clouds edge provenance:

```
[LOCAL_ON_DEVICE]  --> Local deterministic classifier / Chrome Prompt API
                       Runs strictly offline on-device; 0 bytes transmitted.
                       
[CLOUD_BACKEND]    --> Firebase Vertex AI / Gemini 3.5 Flash
                       Runs only on sanitized, user-approved redacted context.
                       
[HYBRID_EDGE]      --> Collaborative multi-agent coordination
                       Local edge triage synthesizes with cloud root-cause DAG.
```

Every response includes:
- **`source`**: The actual execution provider (`local_edge_deterministic_classifier`, `IN_CLOUD`, `MOCK_EXPLICITLY_LABELED`).
- **`correlation_id`**: Cryptographic ID tying offline telemetry, field capture, server trace, and state replay together.
- **`duration_ms`**: Measured execution latency (not estimates).

---

## 7. Verification Commands Summary

To execute the automated test suites verified in this audit:

```powershell
# 1. UI Accessibility & WCAG 2.1 AA Audit
pnpm a11y:check

# 2. Design System Tokens & Landmark Audit
pnpm design:check

# 3. Spatial Digital Twin 3D/2D Integrity
pnpm --filter @nexus-titan/web test:spatial-twin

# 4. Multi-System E2E Workflow Test
pnpm e2e:check

# 5. Flagship 14-Step Incident Scenario
pnpm flagship:check

# 6. Chaos Matrix & Recovery Invariants
pnpm chaos:check

# 7. Security, Privacy & Abuse Review
pnpm security:check

# 8. TypeScript & Next.js Production Build
pnpm -r typecheck
pnpm build
```
