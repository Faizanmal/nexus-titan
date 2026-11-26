# ADR-0008: 3D mapping is a versioned derived projection

- Status: Accepted for foundation; pending validation against missing master spec
- Date: 2026-11-14

## Context
The architecture phase calls for 3D mapping and source evidence with tenant scope.

## Decision
Persist source observations as versioned canonical events. Build map state as a rebuildable projection with explicit coordinate frame, units, calibration/provenance, timestamp, classification, and tenant. A map schema change creates a new projection generation.

## Consequences
The Phase 01 simulation vector remains separate from world coordinates. Phase 06 adds a fixture-only `TITAN_LOCAL_PLANT_GRID_V1` frame (metres, x east/y north/z up) and procedural geometry IDs for synthetic QA only. This does not define production map semantics, sensor protocols, geodetic alignment, or a mapping engine. The 3D scene remains a derived manifest keyed by asset IDs; rollback selects the prior projection generation and replays accepted source events.
