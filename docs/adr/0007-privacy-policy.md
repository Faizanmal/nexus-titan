# ADR-0007: Privacy checks precede persistence and inference

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
Contracts carry tenant IDs, classifications, evidence, and agent/simulation inputs.

## Decision
The API derives tenant authority from verified identity, validates classification and policy before persistence, and minimizes data sent to inference or peers. Unknown classification, source, role, or policy outcomes fail closed. Error responses and telemetry exclude payload contents and secrets.

## Consequences
Retention, consent, data residency, redaction rules, and permitted inference providers must come from the absent official requirements. The current contract enumerates classifications but does not claim a legal or regulatory policy implementation.
