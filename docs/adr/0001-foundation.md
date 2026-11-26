# ADR-0001: Foundation toolchain and local services

- Status: Accepted
- Date: 2026-11-14

## Context
NEXUS TITAN needs a reproducible web/API foundation that can run locally without paid infrastructure. Prompt references were absent from the initially empty workspace.

## Decision
Use pnpm workspaces, Next.js App Router with TypeScript, a FastAPI service managed by uv, and optional Compose profiles for core, distributed, graph, and observe services. Bind published local ports to loopback.

## Consequences
No product capabilities are claimed. Future schema changes must update `packages/contracts` and the API contract together. Compose's distributed profile requires the core Postgres service to be started too. No migration impact at bootstrap.
