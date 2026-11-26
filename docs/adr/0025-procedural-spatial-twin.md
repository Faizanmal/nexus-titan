# ADR-0025: Generated procedural spatial twin and spatial intelligence

- Status: Accepted for the synthetic fixture implementation
- Date: 2026-11-16 (Updated 2026-11-18)

## Context

The world fixture provides canonical synthetic asset IDs, positions, relations, and an event log. The system requires an interactive 3D digital twin, spatial registration metadata for field operations, live telemetry/health inspection, and an accessible 2D alternative without introducing massive third-party copyrighted models or implying surveyed plant geometry. The numerical solver simulates hydraulic scenarios and requires a distinct visual representation that prevents operators from confusing simulated proposals with live plant baseline.

## Decisions

1. **Procedural Original Geometry & Instancing**: Generate versioned scene manifest and per-asset license registry deterministically from `scripts/generate-world-fixture.py`. Render original procedural primitives using Three.js / `@react-three/fiber` instanced meshes (`InstancedMesh`) across 6 asset types (`subsystem`, `pump`, `tank`, `filter`, `valve`, `sensor`).
2. **Deterministic License Registry**: Record per-asset license in `asset-licenses.json` (Apache-2.0 for procedural geometry composition, CC0-1.0 for synthetic fixture data). Explicitly record `third_party_asset: false` for 100% of generated objects.
3. **Render Budget & LOD**: Set strict texture budget of 0. Provide high LOD (16 radial segments) and low LOD (8 radial segments) with automatic detection based on device memory (`navigator.deviceMemory <= 4`). Implement explicit memory disposal (`geometry.dispose()`, `material.dispose()`) on cleanup.
4. **Interactive World Workflows (`/world`)**:
   - Orbit controls and WASDQE fly controls with damping.
   - Camera bookmarks: Overview, Elevation, Process, Plan, Cross-Section.
   - Selected asset inspector with canonical coordinates, transformed render coordinates, capacity constraints, and local draft notes.
   - Live telemetry card for pump/sensor assets displaying metric value, unit, quality status (`good`/`suspect`/`missing`), and recent sample sequence.
   - Health overlay toggle coloring active incident assets in alert coral (`#f87171`), critical assets in amber (`#c89868`), and nominal assets in type theme.
   - Inbound and outbound dependency path highlighting in gold (`#f0c46c`).
   - Cross-section slicing slider (East axis cutoff) and isolate selected toggle.
   - 3D operator annotation pins and 2D node badges.
   - Fixture event replay scrubber maintaining 100% lockstep parity across 3D, 2D SVG, and tabular inventory.
5. **Spatial Marker Registry & Resolution API**:
   - Expose `GET /v1/world/spatial/markers` returning registered logical QR IDs and coordinate transform.
   - Expose `POST /v1/world/spatial/resolve` to resolve QR observation or asset ID to plant grid and Three.js coordinates with confidence scoring and explicit disclaimers against uncalibrated environment reconstruction.
   - Provide an in-browser resolver tool in `/world` for field operators.
6. **Simulation Preview Distinction (`/simulation`)**:
   - Distinct amber / blueprint visual styling with clear watermark `SIMULATED PLAN · NOT LIVE PLANT BASELINE`.
   - 3D status HUD overlay displaying active scenario, exact consumer pressure, convergence residual ($\le 10^{-9}\text{ m}^3/\text{h}$), and shortfall alert.
   - Numerical tradeoff comparison charts displaying exact solver values for consumer pressure against a 200 kPa target threshold line, demand/capacity ($4 / 5\text{ m}^3/\text{h}$), energy proxy, and downtime proxy.
   - Two-actor supervisor approval flow with input/action hash binding.
7. **Accessibility & Graceful Fallback**:
   - Provide interactive 2D SVG topology with keyboard navigation (`tabIndex={0}`, Enter/Space handlers) and full text table.
   - If WebGL is unsupported or fails, display an accessible notification while preserving full operational access via 2D views.

## Consequences

- Fixture schema adds scene-v2 metadata, logical marker registrations, schematic connector paths, render budget, and per-asset license records.
- Wire contract remains v1.3.0 without breaking backwards compatibility.
- Full parity is guaranteed across 3D canvas, 2D topology, and asset table.
- Pinned runtime dependencies in `apps/web/package.json`: `three@0.187.0`, `@react-three/fiber@9.8.2`.
