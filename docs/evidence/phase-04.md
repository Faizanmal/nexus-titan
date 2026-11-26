# Phase 04 evidence — Auth, organizations and device trust

Date: 2026-11-15 (Asia/Calcutta). Host identifiers, credentials, project IDs, emails, and tokens are omitted. Commands ran in `E:\Hackathons\devpost\nexus-titan`.

| Check | Exit | Sanitized result |
|---|---:|---|
| `uv run --project services/api --locked pytest -q` with repository-local `UV_PROJECT_ENVIRONMENT` (approved elevated execution) | 0 | 32 passed; 3 dependency/framework deprecation warnings. Includes demo seed loopback/tenant restriction regressions. |
| `pnpm -r typecheck` (approved elevated execution) | 0 | Contracts and web TypeScript checks passed. |
| `pnpm -r lint` (approved elevated execution) | 0 | Contracts and web lint passed; contracts lint emitted informational Next.js/React detection warnings. |
| `pnpm --filter @nexus-titan/web build` (approved elevated execution) | 0 | Next.js production build, type phase and static generation passed; `/` and `/firebase-spike` generated. |
| `pnpm -r test; pnpm contracts:check; pnpm firebase:check` (approved elevated execution) | 0 | Shared contract tests 2/2; generated contract drift current; Firebase config and inference source checks passed. |
| `uv run --project services/api --locked alembic -c services/api/alembic.ini history` with API `PYTHONPATH` | 0 | Revision `0002_identity` loads. |
| `uv run --project services/api --locked alembic -c services/api/alembic.ini upgrade head --sql` with API `PYTHONPATH` | 0 | Offline SQL generation passed, including organization/site/member/invite composite constraints. No database was modified. |
| `python -m compileall -q services/api/src/nexus_titan_api services/api/alembic scripts/task.py` | 0 | Python syntax compilation passed. |
| `python scripts/task.py --help` | 0 | Task runner exposes `identity-seed`. |
| `docker compose --profile core --profile distributed --profile graph --profile observe config --quiet` | 0 | Compose configuration parses; services not started. |
| `pnpm firebase:rules:emulated` | 1 | Could not fetch pinned Firebase CLI from npm registry (`ECONNREFUSED`). |
| `pnpm exec firebase emulators:exec --project demo-nexus-identity-rules --only firestore,storage ...` | 1 | Installed Firebase CLI 15.36.0 refused to start because host Java is 17.0.12; CLI requires JDK 21+. Emulator rule assertions did not run. |
| `pnpm --filter @nexus-titan/web test:identity-rules` without emulators | 1 | No Firestore/Storage emulator was running; endpoint returned HTTP 405. This is not counted as a rule pass. |

An early migration CLI inspection used a module path/config invocation that uv/Alembic did not resolve (exit 1); the corrected Alembic history and offline SQL commands above both passed. An initial concurrent pnpm run hit a workspace modules-directory cleanup race (exit 1); serial lint/typecheck and contract checks passed afterward. The initial package download for Alembic used the locked environment and completed successfully. No live database migration or seed was run.
| `node --experimental-strip-types tests/firebase-inference-source.runner.ts` | 0 | Existing Firebase source/fixture checks passed. |

The initial API test collection failed on an unresolved `UUID` import (exit 1); the import/type was fixed and the full API test command then passed. Initial web typecheck failed on two incorrect `User.auth` accesses and WebCrypto `BufferSource` typing (exit 2); corrected, rerun passed. Initial lint failed on effect-state lint and unused imports; corrected, rerun passed. Initial un-elevated pnpm orchestration was blocked by Windows `spawn EPERM`; the same checks succeeded with approved elevated process execution. No Firebase cloud project, production App Check request, or valid/denied App Check evidence was available.
