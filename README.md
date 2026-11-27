# NEXUS TITAN

> **Offline AI helps field technicians investigate equipment alarms and share only approved evidence when connectivity returns.**
>
> Open-Source Hybrid Edge-Cloud Industrial Intelligence Platform · Licensed under Apache-2.0.
> Built during the **#BuildHybridAI** submission period (Nov 11–30, 2026).
> *Disclosure: Nexus Titan incorporates open-source contracts and scaffold patterns developed prior to the contest period, alongside AI coding-agent assistance (Google DeepMind Antigravity) used for architecture, test harnesses, and integration during the hackathon.*

---

## ⚡ Hackathon Judge Quickstart (Clean Browser Evaluation)

- **Live Deployed Demo**: [https://nexus.faizanmalik.me/demo](https://nexus.faizanmalik.me/demo)
- **Live Homepage**: [https://nexus.faizanmalik.me/](https://nexus.faizanmalik.me/)
- **Testing Access**: **No sign-up or credentials required.** Uses a 1-click anonymous judge sandbox with dedicated isolated quota allocations.

NEXUS TITAN includes a dedicated **Judge Sandbox** designed for frictionless, 1-click evaluator testing in any fresh browser profile with zero account setup:

1. **Visit the Live Demo**: Open [`https://nexus.faizanmalik.me/demo`](https://nexus.faizanmalik.me/demo) in any clean browser window (or navigate locally to `http://127.0.0.1:3000/demo`).
2. **1-Click Sandbox Entry**: In the **Contest Judge & Evaluator Onboarding** gateway card, click **"Enter Sandbox (1-Click Dedicated Evaluator Sign-In)"**.
   - Authenticates instantly and issues an isolated sandbox profile (`role: judge`) with quota allocations (50 simulation units, 20 agent runs, 30 req/min rate limit).
3. **Step Through the 5-Stage Guided Walkthrough**:
   - **Stage 1 (Alarm & Contradiction)**: Injects synthetic cavitation fault on Pump `P-101` and records physical dial reading (410 kPa dial vs 185 kPa SCADA), detecting sensor transducer calibration drift.
   - **Stage 2 (Offline Local AI)**: Simulates disconnected field environment (`Network: OFFLINE`) and executes on-device edge triage on restricted technician notes (`ONLY_ON_DEVICE` mode; 0 egressed bytes).
   - **Stage 3 (Approved Cloud Handoff)**: Inspects de-identification preview, strips PII/canary, authorizes cryptographic SHA-256 consent digest, and executes Firebase AI Logic (`PREFER_ON_DEVICE` hybrid default or `ONLY_IN_CLOUD`).
   - **Stage 4 (Decision & Mitigation)**: Evaluates counterfactual hydraulic solvers (Plan A throttled bypass saving $64,150) with supervisor signoff (`no_actuator_path: true`).
   - **Stage 5 (Spatial Twin & Replay)**: Reconciles 3D spatial digital twin and scrubs deterministic timeline with SHA-256 hash digest.
4. **Independent Judge Isolation**: Opening another session in a private/incognito window allocates an independent session ID and quota tracker with zero cross-session state leakage.
5. **Run Automated Test Harness**:
   ```bash
   pnpm test:suites    # Runs all 14 comprehensive test suites (including judge browser smoke & contradiction tests)
   pnpm test:api       # Runs all 180 FastAPI pytest tests
   ```

---

## 🧠 How NEXUS TITAN Uses Firebase AI Logic

Nexus Titan implements genuine hybrid edge-cloud intelligence following the Firebase AI Logic SDK patterns:

- [client.ts](apps/web/src/lib/firebase/client.ts): Initializes Firebase App Check with reCAPTCHA Enterprise, Anonymous Authentication, Firestore, and Remote Config.
- [provider.ts](apps/web/src/lib/firebase/provider.ts): Integrates `@firebase/ai` (Vertex AI in Firebase) with model switching, dynamic parameters from Remote Config, and fallback handling.
- [firebase-adapter.ts](packages/hybrid-web/src/firebase-adapter.ts): Implements the hybrid runtime adapter managing `initializeDeviceModel`, prompt execution, and schema-constrained JSON extraction.
- [remote-config.ts](packages/hybrid-web/src/remote-config.ts): Provides live remote configuration for dynamic model selection (`gemini-3.5-flash-lite`), prompt versions, and threshold parameters without redeployment.
- [flagship-hybrid-scenario.ts](apps/web/src/lib/hybrid/flagship-hybrid-scenario.ts): Coordinates the two-leg incident investigation:
  - **4 Hybrid Inference Modes**:
    1. `PREFER_ON_DEVICE`: Tries on-device Gemini Nano Prompt API first; seamlessly falls back to cloud Gemini via Firebase AI Logic if unavailable or on failure (default for Stage 3 sanitized data).
    2. `ONLY_ON_DEVICE`: Strictly restricts execution to on-device hardware. Prohibits network egress for sensitive/restricted field notes (used in Stage 2).
    3. `PREFER_IN_CLOUD`: Tries cloud Gemini first; falls back to on-device model if offline.
    4. `ONLY_IN_CLOUD`: Strictly dispatches to cloud Gemini via Firebase AI Logic.
  - **Device Preparation & Attribution**: Calls `initializeDeviceModel` to verify Chrome Prompt API readiness. Reads SDK `response.inferenceSource` (`ON_DEVICE` vs `IN_CLOUD`). Missing provider responses or unsupported hardware fall back honestly to `MOCK` with an explicit `fallback_reason`.
  - **Privacy Boundary & Consent Invalidation**: Uses cryptographic SHA-256 consent digests over sanitized data; any tampering invalidates consent and aborts execution.
  - **Firebase Infrastructure**: Uses Firebase App Check (reCAPTCHA Enterprise) to protect cloud inference endpoints, Firebase Auth for judge sandbox provisioning, Remote Config for dynamic runtime policy, and Firestore for derived tenant projections.

### 💻 Tested Hardware & Browser Environment
- **Web / Chrome**: Fully supported on **Chrome Desktop 139+** with the Gemini Nano Prompt API enabled (`chrome://flags/#prompt-api-for-gemini-nano` and `Optimization Guide On Device Model`). Under this configuration, Stage 2 and Stage 3 will report authentic `ON_DEVICE` inference.
- **Other Browsers / Headless Environments**: If Chrome Prompt API is absent or offline, execution gracefully reports an honest `MOCK` badge accompanied by the explicit reason (e.g. `Simulated: Window or Chrome Prompt API unavailable in current environment`).
- **Mobile Platforms Notice**: *Android and iOS implementations in `apps/android` and `apps/ios` are offline-relay scaffolds and architectural blueprints; active Firebase AI Logic hybrid inference is implemented and demonstrated on Web/Chrome.*

---

## Prerequisites

- Node.js 20+ and pnpm 11 (repository package manager is pinned in `package.json`).
- Python 3.12+ and uv.
- Docker Desktop with Compose v2 for local service profiles.
- macOS and Xcode are required for iOS builds. Android Studio and Android SDK are required for Android builds. The Web Nano path requires Chrome Desktop 139+ with the documented Prompt API flag and model availability; other browsers are not proof of this path.

## Start locally

```sh
python scripts/task.py setup
```

Create a local environment file only if one does not already exist, then replace the `change-me` placeholders:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

```sh
test -f .env || cp .env.example .env
```

Then start the services:

```sh
python scripts/task.py dev web       # web at http://127.0.0.1:3000
python scripts/task.py dev core      # PostgreSQL + migrated API; Docker required
python scripts/task.py smoke         # checks liveness and DB-backed readiness
```

`/health` is process liveness. `/health/ready` verifies PostgreSQL connectivity and the core, event-sync, and identity schemas; it returns 503 when any dependency is unavailable. API request logs contain route/method/status/duration/request ID only, never request bodies, headers, or query strings.

## Checks

```sh
pnpm -r lint
pnpm -r typecheck
pnpm --filter @nexus-titan/web build
pnpm firebase:check
uv sync --project services/api
uv run --project services/api pytest
python scripts/task.py compose-check
python scripts/task.py integration core  # requires a running Docker Engine
```

## Versioned contracts

`contracts/schemas/v1.0.0/`, `v1.1.0/`, and `v1.2.0/` are preserved; the current additive wire contract is `contracts/schemas/v1.3.0/contracts.schema.json`. Regenerate OpenAPI and TypeScript/Swift/Kotlin/Python bindings with `pnpm contracts:generate`; check generated files for drift with `python scripts/generate-contracts.py --check` or run the full schema gate with `bash scripts/check-contracts` (PowerShell: `./scripts/check-contracts.ps1`). Signed event writes use `POST /sync/events`; cursor replay and snapshots use `/sync/events` and `/sync/snapshot/{tenant_id}`. World fixture read APIs are under `/v1/world/`. Simulation and agent adapters remain explicitly unimplemented. See [event sync](docs/api/event-sync.md) for signing/replay and [world ontology](docs/world-ontology.md) for fixture scope and operation.

`pnpm test` runs package tests. The shared contracts package includes a Node smoke test; the API test exercises its health response against the declared wire contract.

## Optional local services

```sh
docker compose --profile core up --build --wait          # pgvector/PostgreSQL + migrations + API
docker compose --profile distributed up --wait           # NATS JetStream + event worker + Temporal dev
docker compose --profile graph up --build --wait         # PostgreSQL + migrations + NATS + Neo4j + projection workers
docker compose --profile observe up --wait               # redacting OTel collector
```

Data volumes persist. Ports publish to loopback only: Postgres 5432, API 8000, NATS 4222/8222, Temporal 7233/8233, Neo4j 7474/7687, OTLP 4317/4318 and collector health 13133. Compose contains `change-me-local-only` placeholders only; copy `.env.example` to ignored `.env` and set local values before running services. Never use these development values in deployment. Core schema enables pgvector, and `python scripts/task.py migrate` / `seed` apply idempotent schema and synthetic public demo data. `reset-demo --tenant demo-nexus --confirm demo-nexus` deletes only that tenant and refuses non-local DB hosts. Telemetry uses bounded PostgreSQL batches and standard Postgres time buckets; Timescale and MQTT are omitted because they are optional and not needed to validate the synthetic pipeline.

Event outbox relay and the durable projection worker start in the `distributed` and `graph` profiles. Firestore writes are disabled by default; set `FIRESTORE_PROJECTIONS_ENABLED=true` with a Firebase project and emulator or approved service identity to enable them. Rebuild a derived tenant projection with `python scripts/task.py projection-rebuild --tenant demo-nexus --confirm demo-nexus`; canonical events remain in PostgreSQL. Live database, NATS, and Firestore integration checks must run before relying on this path.

Generate and validate the 120-asset fictional `TITAN-WTP-01` world with `python scripts/generate-world-fixture.py --check-deterministic`. Start the core profile and establish the local demo organization, then run `python scripts/task.py world-seed`; seed data is appended as stable canonical asset events and repeat runs are idempotent. The graph profile rebuild watcher reads accepted PostgreSQL projections and writes only allowlisted synthetic asset properties to Neo4j. `python scripts/task.py graph-rebuild --tenant demo-nexus --confirm demo-nexus` performs an explicit rebuild. `/world` provides an accessible static QA table; authenticated database-backed endpoints are `/v1/world/assets`, `/v1/world/topology`, `/v1/world/incidents`, and `/v1/world/snapshot`. Create isolated scenario inputs with `python scripts/task.py fixture-run --run-id <uuid-v4>` and reset only that run using `fixture-reset` plus the matching UUID confirmation. The public pump-degradation scenario and hidden evaluation truth are separate; hidden truth is excluded from API output and run bundles. Fixture coordinates/capacities/topology are generated assumptions, not operating guidance.

Telemetry is generated deterministically with `python scripts/generate-telemetry.py --check-deterministic` (23,040 samples for the default seed/series). After the database is migrated and the synthetic world seeded, `python scripts/task.py telemetry-simulate --tenant demo-nexus --confirm demo-nexus --batch-size 500 --throttle-ms 5` validates and ingests synthetic pressure/flow/vibration/temperature readings. The hidden fault labels stay in the local test fixture and are never sent to the API. Sustained anomalies create canonical internal incident events. `/telemetry` queries the authorized API series and shows units, availability, quality and stale state; sign-in and App Check are required. Samples have a 90-day retention target; `python scripts/task.py telemetry-prune --tenant demo-nexus --confirm demo-nexus --retention-days 90` explicitly removes only expired fixture samples while retaining canonical incidents and alert deduplication rows. No automatic deletion job is enabled. See [telemetry documentation](docs/telemetry.md) and detector metrics in `docs/evidence/phase-07.md`.

Firebase Auth, Firestore and Storage emulators bind to loopback on ports 9099, 8080 and 9199. Emulator rules deny all by default. AI Logic remains real Firebase service; emulator mode does not emulate inference.

### Resource and remote development notes

The host audit reports 4 logical CPUs and about 7.2 GiB free on the workspace drive; Docker Engine is unavailable, so container resource use and service health have not been measured. Plan for at least 4 CPUs, 8 GiB RAM and 20 GiB free disk for a Linux Docker host. Core is intended for a light profile (Postgres + API); distributed/graph/observe add NATS, Temporal, Neo4j and OTel and need more memory. These are planning estimates, not measured acceptance results. A remote Linux x86_64 dev host with Docker Compose v2 is the supported alternative for this Windows host. Windows does not build iOS, and browser environments do not prove Chrome Nano.

## Tool audit and platform limits

See `docs/BUILD_STATE.md` for the current audit, actual command results and open hardware/cloud gates.

## Helpful commands

PowerShell:

```powershell
pnpm install
pnpm -r lint
pnpm -r typecheck
pnpm --filter @nexus-titan/web build
uv sync --project services/api
uv run --project services/api pytest
docker compose config
```

Bash:

```bash
pnpm install && pnpm -r lint && pnpm -r typecheck && pnpm --filter @nexus-titan/web build
uv sync --project services/api && uv run --project services/api pytest
docker compose config
```

## License and contributions

The project is licensed under Apache-2.0; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow and evidence expectations.
# Firebase AI Logic hybrid spike

The browser spike is available at `/firebase-spike`. Copy `.env.example` to ignored `.env.local`, configure the dev Firebase Web app and App Check reCAPTCHA Enterprise site key, then run `pnpm dev`. The route offers real Firebase AI Logic cloud/on-device mode calls using only a safe public text fixture. Set `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG=true` only for local debug-token setup; never commit or share the debug token. Auth/Firestore emulator settings are optional and do not emulate AI Logic. See [the spike guide](docs/firebase/hybrid-spike.md) for cloud setup, device requirements, and proof gates.

The adaptive runtime is exposed at `/inference-lab`; it uses a fixed public synthetic task, explicit cloud consent, App Check initialization, a versioned fixture prompt, and the SDK-reported inference source. The local lab lease and result are not submitted to an API yet. See [runtime configuration and privacy notes](docs/inference-runtime.md). Device and App Check enforcement gates still require real Firebase/device evidence.

