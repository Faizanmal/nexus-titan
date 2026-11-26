# Spatial Twin and Spatial Intelligence

## Overview

`TITAN-WTP-01` is a deterministic, synthetic water treatment plant facility. Its canonical asset coordinates use `TITAN_LOCAL_PLANT_GRID_V1` (east, north, up; meters); the render transform into Three.js right-handed Y-up space is:
```
[east, north, up] -> [east, up, -north]
```
The scene manifest (`scene.json`) is generated deterministically alongside the world fixture and contains exactly 120 procedural entities, 120 logical QR marker registrations, and schematic connector paths derived only from fixture FEEDS relations.

## Procedural Meshes & Optimization
- **Original procedural geometry**: Constructed using Three.js original primitives (`CylinderGeometry`, `BoxGeometry`, `TorusGeometry`). No third-party models or massive copyrighted assets are bundled.
- **Asset mapping**: Every renderable mesh instance maps 1:1 to a canonical asset ID.
- **Instancing**: `InstancedMesh` per asset type (`subsystem`, `pump`, `tank`, `filter`, `valve`, `sensor`), updated with dynamic `instanceMatrix` and `instanceColor`.
- **Render budget & LOD**:
  - Textures: 0 (pure procedural shader materials, zero texture memory footprint).
  - High LOD: 16 radial segments, antialiased.
  - Low LOD: 8 radial segments, antialiasing disabled, DPR clamped to 1.
  - Automatic detection of `navigator.deviceMemory <= 4` toggles low-detail mode.
- **Disposal**: All geometries and materials explicitly call `.dispose()` on component unmount and LOD reconfigurations.

## Interactive World Controls (`/world`)
1. **Camera Bookmarks**: Presets for `Overview` (isometric), `Elevation` (front profile), `Process` (stream focus), `Plan` (top-down 2D view), and `Cross-Section` (side cut view).
2. **Orbit and Fly Controls**: Smooth OrbitControls with damping + keyboard-driven Fly mode (WASD to fly forward/left/backward/right, QE to descend/ascend).
3. **Selected Asset Inspector**: Displays stable ID, label, type, subsystem, capacity limit, canonical coordinates `[east, north, up]`, and transformed render coordinates `[east, up, -north]`.
4. **Health Overlays**: Toggling Health Overlay highlights assets with active incidents in red/coral (`#f87171` / `#ff8f75`), critical assets in amber (`#c89868`), and nominal assets in type theme colors.
5. **Live Telemetry**: When selecting a pump or sensor, inspects live readings for pressure (kPa), flow (m³/h), vibration (mm/s), or temperature (°C), with quality indicators (`good`, `suspect`, `missing`), timestamp, and recent readings series.
6. **Dependency Path Highlighting**: Highlights inbound and outbound connected paths in yellow/gold (`#f0c46c`) in both 3D and 2D views.
7. **Cross-Section & Isolate**:
   - `Isolate Selected` focuses exclusively on the selected asset.
   - `Cross-Section Slicing`: East-axis cut slider (0m to 140m) dynamically filters geometry in 3D and 2D and renders an illuminated section cut plane indicator.
8. **Annotation Markers**: Adding local session operator notes renders a 3D pin marker above the asset in the twin and an annotation badge on the 2D topology node.
9. **Fixture Event Replay**: Time scrubber reconstructs exact asset membership at sequence $N$ (0 to 120), keeping 3D canvas, 2D topology, and table in 100% lockstep.
10. **2D Topology Accessible Alternative**: High-contrast SVG schematic with keyboard accessibility (`tabIndex={0}`, Enter/Space selection handlers), tooltips (`<title>`), and screen reader support.
11. **Asset Topology Table**: Complete tabular inventory with instant search filtering across ID, label, type, and subsystem.
12. **WebGL Fallback**: If WebGL context is unavailable or fails, gracefully renders an accessible notice while preserving full 2D topology and tabular workflows.

## Spatial Marker Registry & Spatial Agent API
- **Registration**: All 120 assets have registered logical marker IDs (format `QR-TITAN-WTP-01-[asset_id]`).
- **Endpoints**:
  - `GET /v1/world/spatial/markers`: Lists all registered markers, coordinate system, coordinate transform matrix, and disclaimers.
  - `POST /v1/world/spatial/resolve`: Resolves a scanned QR marker or asset ID into canonical plant coordinates, Three.js coordinates, bounding volume, confidence tier, and confidence score.
- **Physical Limits & Disclaimers**: Logical QR registration only. No physical tags are printed, no camera-to-world uncalibrated calibration exists, and no unsupported environment reconstruction is claimed.

## Simulation Preview & Approvals (`/simulation`)
- **Visual Distinction**: Prominent banner `SIMULATED PLAN · NOT LIVE PLANT BASELINE` and distinct amber/slate styling ensures simulated scenarios are never confused with live operational state.
- **3D Status HUD Overlay**: Real-time display showing active scenario, exact consumer pressure, convergence status (residual $\le 10^{-9}\text{ m}^3/\text{h}$), and shortfall alert.
- **Numerical Tradeoff Charts**: Direct visualization of solver numbers comparing Baseline (250 kPa), Virtual Backup (300 kPa), and Synthetic Resistance (190 kPa) against the 200 kPa minimum service pressure target line, plus demand/capacity ($4 / 5\text{ m}^3/\text{h}$), energy proxy, and downtime proxy.
- **Approval Flow**: Propose intervention with input/action hash binding, enforce two-actor supervisor approval (no self-approval), and apply exclusively via simulator reducer.

## Asset Licensing
- `asset-licenses.json` deterministically records origin and licensing per asset ID:
  - Procedural geometry: `Apache-2.0` (repository original).
  - Synthetic asset fixture data: `CC0-1.0`.
  - `third_party_asset`: `false` for 100% of generated assets.
