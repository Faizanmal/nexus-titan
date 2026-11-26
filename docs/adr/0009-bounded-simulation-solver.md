# ADR-0009: Simulation solver execution is bounded and isolated

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
Simulation inputs are untrusted and can consume unbounded CPU, memory, or wall time.

## Decision
The versioned request requires positive time steps, a bounded iteration count, a bounded body count, tenant, classification, and solver ID. Execute solvers in a separate worker boundary with quotas and no ambient credentials; persist input and result schema versions.

## Consequences
The current request model is a generic 3D body representation for contract validation only. It does not assert a supported physics model or solver implementation. Invalid or unsupported solver inputs fail explicitly; no successful simulation is fabricated.
