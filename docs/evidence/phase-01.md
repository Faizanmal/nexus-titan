# Phase 01 evidence: contracts and architecture

Commands were executed from the repository root on Windows 10, 2026-11-14. Output is shortened to relevant sanitized lines; no tenant data, credentials, or secrets were used.

## Deterministic generation

```text
python scripts/generate-contracts.py
generated docs/api/openapi.json
generated packages/contracts/src/generated.ts
generated bindings/swift/Sources/NexusTitanContracts/GeneratedContracts.swift
generated bindings/kotlin/src/main/kotlin/dev/nexustitan/contracts/GeneratedContracts.kt
generated services/api/src/nexus_titan_api/generated_contracts.py
exit: 0

python scripts/generate-contracts.py --check
contract codegen is current
exit: 0
```

## Schema, API, and sample checks

```text
./scripts/check-contracts.ps1
contract codegen is current
12 tests passed, 1 Starlette/httpx deprecation warning
exit: 0
```

```text
uv run --project services/api pytest -s
collected 13 items
GET /health -> 200 {'status': 'ok', 'service': 'nexus-titan-api'}
13 passed, 1 warning in 12.90s
exit: 0
```

The 13 Python tests cover JSON Schema validity, valid event/simulation samples, tenant ID constraints, classification/source enums, duplicate event IDs, simulation bounds, optional fields and the v1 version boundary, agent role input/output schemas and risk tiers, generated OpenAPI models/routes, tenant-scoped synthetic manual/evidence fixtures, API validation/error mapping, explicit 501 adapter responses, and health readiness.

```text
node --experimental-strip-types packages/contracts/src/index.test.ts
health contract JSON roundtrip: pass
synthetic event batch JSON roundtrip: pass
2 passed, 0 failed
exit: 0
```

## TypeScript and Compose

```text
pnpm -r typecheck
packages/contracts typecheck: Done
apps/web typecheck: Done
exit: 0
```

```text
pnpm -r lint
packages/contracts lint: Done
apps/web lint: Done
exit: 0
```

The contracts lint configuration reports informational React auto-detection and missing-pages messages because the shared contracts package is not a Next.js app; lint still exits 0.

```text
docker compose --profile core --profile distributed --profile graph --profile observe config
All declared services rendered; API build context is repository root; published ports use host_ip 127.0.0.1
exit: 0
```

## Native tool availability and resolved diagnostics

```text
swift: MISSING
swiftc: MISSING
xcodebuild: MISSING
kotlinc: MISSING
gradle: MISSING
adb: MISSING
ANDROID_HOME: MISSING
```

Swift and Kotlin round-trip/unknown-enum/duplicate-event tests were added as source but not executed. No native app binaries or compiled artifacts were created.

The initial Python validator attempt exited 1 because fragment validators could not resolve sibling `$defs`; validation now resolves through the v1 root and the final full suite exits 0. The first targeted PowerShell gate exited 1 because pytest selected the service-local config with an incorrect relative import path; the config was fixed and the gate subsequently exited 0.
