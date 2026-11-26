# Phase 18 Evidence — Digital Twin and Spatial Intelligence

Date: 2026-11-18

## Environment Capability Audit

- **OS**: Windows 10 Pro for Workstations (Build 19045, 64-bit).
- **CPU**: Intel Xeon W-2133 @ 3.60GHz (6 physical cores, 12 logical processors).
- **RAM**: 32 GB RAM (33.2 GB visible, ~20 GB free).
- **GPU**: NVIDIA Quadro P2000 (4 GB GDDR5 VRAM, Driver 32.0.15.8299).
- **Storage**: Drive J: ~197 GB free; Drive C: ~198 GB free; Drive D: ~926 GB free.
- **Docker**: Docker Desktop 29.9.3, Compose v5.7.0, WSL2 Linux Kernel 6.18.40.1 (12 CPUs, 15.46 GiB RAM allocated).
- **Node & pnpm**: Node v24.22.3, pnpm 11.25.0, Python 3.13.11.
- **Browser**: Google Chrome 157.0.8103.79, Microsoft Edge 157.0.4341.60.
- **Connectivity**: Network online (TCP verification passed to registry.npmjs.org:443 and pypi.org:443).

## Verification Commands and Actual Exit Statuses

| Command | Exit | Result |
|---|---:|---|
| `pnpm install` | 0 | 476 packages installed and linked in workspace `node_modules`; lockfile current. |
| `pnpm -r typecheck` | 0 | All 3 TypeScript packages (`@nexus-titan/contracts`, `@nexus-titan/hybrid-web`, `@nexus-titan/web`) passed `tsc --noEmit`. |
| `pnpm -r lint` | 0 | 0 errors, 32 warnings across all 3 workspace packages. |
| `pnpm --filter @nexus-titan/web build` | 0 | Next.js 16.4.5 Turbopack production build succeeded; all 18 routes compiled and statically generated. |
| `python scripts/generate-world-fixture.py --check-deterministic` | 0 | 120 assets, 217 relations; deterministic flag true; SHA-256 `e392c5c9fb188815daa20e20beba613ff095d8201ba639e19e7676189f8bce00`. |
| `python scripts/generate-contracts.py --check` | 0 | Generated wire contracts current; codegen matches schema baseline. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_world_fixture.py -q -p no:cacheprovider` | 0 | **8 passed** in 3.56s. Tests 120 asset validation, critical path topology, generation determinism, scene-v2 manifest, license records, hidden-truth separation, contract schema bounds, run reset isolation, out-of-scope site rejection, and spatial marker listing and resolution. |
| `services/api/.venv/Scripts/python.exe -m pytest services/api/tests/ -q -p no:cacheprovider` | 0 | **99 passed**, 3 warnings in 5.76s across full backend API test suite. |
| `pnpm -r test` | 0 | **3 passed** in contracts, **15 passed** in hybrid-web (all assertions green). |
| `node apps/web/tests/spatial-twin.test.mjs` | 0 | **10 passed** in 21.90ms. Verifies 120/120 scene-to-asset integrity, zero third-party models, CC0/Apache-2.0 licenses, render budget (0 textures, 120 instances, 16/8 LOD), `[east,north,up] -> [east,up,-north]` transform math, logical QR registrations, schematic FEEDS connectors, event replay determinism, 2D topology keyboard accessibility, inspection/telemetry/cross-section controls, and solver preview visual distinction with exact numerical charts. |
| `node apps/web/tests/design-system.test.mjs` | 0 | **8 passed** in 13.77ms. Verifies shared shell, contrast tokens, and command-center navigation. |
| `node tests/firebase-config.test.mjs` & `node tests/firebase-inference-source.test.mjs` | 0 | **6 passed**. Local rules and inference source assertions. |
| `services/api/.venv/Scripts/python.exe -m compileall -q services/api/src/nexus_titan_api` | 0 | Python compilation syntax verified without errors. |

## Acceptance Gate Verification

1. **Scene-to-Asset Integrity**: Exactly 120 canonical assets across 6 types (`subsystem`: 10, `pump`: 24, `tank`: 12, `filter`: 16, `valve`: 30, `sensor`: 28). Exactly 120 scene entities in `scene.json` and 120 license records in `asset-licenses.json`. Zero dangling meshes or unmapped IDs. All geometry references use `procedural://geometry/*`.
2. **License Verification**: 100% of renderable objects are original procedural primitives (`third_party_asset: false`). Composition license Apache-2.0; synthetic fixture data CC0-1.0. No copyrighted third-party models bundled.
3. **Render Budget & Performance Optimization**:
   - Texture budget: exactly 0 textures (0 MB GPU texture memory).
   - Mesh instances: 120 canonical instances rendered via Three.js `InstancedMesh`.
   - LOD: Standard mode uses 16 radial segments; low-detail mode uses 8 radial segments with antialiasing disabled. Automatic fallback when `navigator.deviceMemory <= 4`.
   - Explicit `.dispose()` calls for geometry and materials upon cleanup.
4. **Interactive Controls & 2D Parity**:
   - Camera bookmarks: Overview, Elevation, Process, Plan, Cross-Section.
   - Orbit controls with damping; keyboard Fly mode (WASDQE).
   - Health overlay highlights active incidents (`#f87171`), critical assets (`#c89868`), and nominal assets.
   - Live telemetry card displays metric value, unit, quality status, timestamp, and recent sample series.
   - Cross-section slicing slider (East axis cutoff 0–140m) dynamically filters geometry in 3D and 2D with a translucent cut plane indicator.
   - 3D annotation pins and 2D node badges.
   - Time scrubber replays sequence 0..120 with 100% parity between 3D canvas, 2D SVG topology, and table.
   - Keyboard accessible 2D SVG topology (`tabIndex={0}`, Enter/Space selection).
   - Browser WebGL unsupported fallback cleanly presents the 2D topology and full asset table.
5. **Spatial Intelligence & Marker Registry**:
   - 120 registered logical QR IDs (`QR-TITAN-WTP-01-[asset_id]`).
   - Coordinate transform: `TITAN_LOCAL_PLANT_GRID_V1` [east, north, up] mapped to Three.js `THREE_RHS_Y_UP` [east, up, -north].
   - API endpoints `GET /v1/world/spatial/markers` and `POST /v1/world/spatial/resolve` return exact coordinates and source confidence.
   - Explicit disclaimers: Logical registration only; no physical tags printed; no unsupported uncalibrated environment reconstruction claimed.
6. **Numerical Simulation Preview**:
   - Visual distinction: `SIMULATED PLAN · NOT LIVE PLANT BASELINE` watermark banner and amber/slate aesthetic.
   - 3D status HUD overlay displays active scenario, exact consumer pressure, convergence residual ($\le 10^{-9}\text{ m}^3/\text{h}$), and shortfall warnings.
   - Numerical tradeoff comparison charts display exact solver numbers for consumer pressure against a 200 kPa target threshold line, demand/capacity ($4 / 5\text{ m}^3/\text{h}$), energy proxy, and downtime proxy.
   - Two-actor supervisor approval flow with input/action hash binding.

All tests executed with actual exit code 0. No mocked or unexecuted test is marked green.
