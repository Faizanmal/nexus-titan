# NEXUS TITAN agent guidance

## Before making changes
- Read `prompts/reference/master-spec.md`, `contracts.md`, and `official-requirements.md` when present, plus `docs/BUILD_STATE.md`.
- Treat project references as authoritative. Record missing references or conflicts; do not invent product scope.
- Preserve user work and report migration impact for changes to shared contracts or persisted data.

## Repository structure
- `apps/web`: Next.js web client.
- `services/api`: FastAPI service, managed with uv.
- `packages/contracts`: shared TypeScript wire contracts.
- `docker-compose.yml`: optional local services, published on loopback.

## Engineering rules
- Never commit credentials. Keep local values in ignored `.env` files and update `.env.example` with placeholders only.
- Pin direct runtime web dependencies; commit pnpm and uv lockfiles.
- Readiness endpoints must report only what they actually verify. Do not add fake success endpoints.
- Do not claim a build, test, or service works unless the command ran successfully. Record exit status and blockers in `docs/BUILD_STATE.md` and sanitized logs in `docs/evidence/`.
- Do not create simulated compiled Android/iOS artifacts. Use native Android Studio and Xcode templates when those platforms are implemented.
- Keep infra optional and free of paid cloud dependencies in local development.
