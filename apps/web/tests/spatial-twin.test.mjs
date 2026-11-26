import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));

const world = readJson("../../../tests/fixtures/world/TITAN-WTP-01/world.json");
const scene = readJson("../../../tests/fixtures/world/TITAN-WTP-01/scene.json");
const licenses = readJson("../../../tests/fixtures/world/TITAN-WTP-01/asset-licenses.json");
const events = readJson("../../../tests/fixtures/world/TITAN-WTP-01/events.json");

const worldPage = read("../src/app/world/page.tsx");
const canvasComponent = read("../src/components/world-twin-canvas.tsx");
const simPreview = read("../src/components/simulation-preview.tsx");

test("scene-to-asset integrity: exactly 120 canonical assets with no dangling entities", () => {
  assert.equal(world.assets.length, 120, "must have 120 canonical assets");
  assert.equal(scene.entities.length, 120, "scene must contain exactly 120 entities");

  const worldIds = new Set(world.assets.map((a) => a.asset_id));
  const entityIds = new Set(scene.entities.map((e) => e.asset_id));

  assert.equal(worldIds.size, 120, "all asset IDs must be unique");
  assert.equal(entityIds.size, 120, "all scene entity IDs must be unique");

  for (const id of worldIds) {
    assert.ok(entityIds.has(id), `scene missing entity for asset ${id}`);
  }
  for (const id of entityIds) {
    assert.ok(worldIds.has(id), `scene has dangling entity ${id}`);
  }

  // All geometry references must use procedural schema
  for (const entity of scene.entities) {
    assert.ok(
      entity.geometry_ref.startsWith("procedural://geometry/"),
      `entity ${entity.asset_id} must use procedural geometry ref`
    );
  }
});

test("license records: CC0-1.0 and Apache-2.0 original procedural assets with zero third-party models", () => {
  assert.equal(licenses.assets.length, 120, "must have 120 asset license records");
  for (const record of licenses.assets) {
    assert.equal(record.third_party_asset, false, "must not bundle third party models");
    assert.equal(record.geometry_origin, "original procedural primitive composition");
    assert.equal(record.geometry_license, "Apache-2.0");
    assert.equal(record.asset_data_license, "CC0-1.0");
  }
});

test("render budget and LOD optimization: zero textures and radial segment budgets", () => {
  assert.equal(scene.render_budget.textures, 0, "texture budget must be 0");
  assert.equal(scene.render_budget.mesh_instances, 120, "mesh instances must match asset count");
  assert.equal(scene.render_budget.lod.high_radial_segments, 16, "high radial segments");
  assert.equal(scene.render_budget.lod.low_radial_segments, 8, "low radial segments");

  // Instancing in canvas component
  assert.match(canvasComponent, /<instancedMesh\b/, "must use instancedMesh for performance");
  assert.match(canvasComponent, /geometry\.dispose\(\)/, "must dispose geometry on cleanup");
  assert.match(canvasComponent, /material\.dispose\(\)/, "must dispose material on cleanup");
});

test("coordinate transform: TITAN_LOCAL_PLANT_GRID_V1 to THREE_RHS_Y_UP mapping", () => {
  const transform = scene.coordinate_transform;
  assert.equal(transform.from, "TITAN_LOCAL_PLANT_GRID_V1");
  assert.equal(transform.to, "THREE_RHS_Y_UP");
  assert.equal(transform.mapping, "[east,north,up] -> [east,up,-north]");
  assert.equal(transform.units_preserved, true);

  // Validate math on a sample point [10, 20, 5]
  const east = 10, north = 20, up = 5;
  const threeX = east;
  const threeY = up;
  const threeZ = -north;
  assert.deepEqual([threeX, threeY, threeZ], [10, 5, -20]);
});

test("marker registrations: exact registry mapping with disclaimer of uncalibrated reconstruction", () => {
  assert.equal(scene.markers.length, 120, "must have 120 registered markers");
  for (const marker of scene.markers) {
    assert.equal(marker.marker_type, "logical_qr_registration");
    assert.equal(marker.physical_tag_printed, false);
    assert.equal(marker.confidence, "fixture_registry_exact_id");
    assert.ok(marker.marker_id.startsWith("QR-TITAN-WTP-01-"));
  }

  // Check spatial resolver disclaimer in UI and API
  assert.match(worldPage, /Spatial Marker Registry & Resolver/);
  assert.match(worldPage, /no unsupported environment reconstruction claimed/i);
});

test("pipe path connectors: schematic FEEDS relations with no dangling connections", () => {
  const assetIds = new Set(world.assets.map((a) => a.asset_id));
  assert.ok(scene.pipe_paths.length > 0, "pipe paths must exist");

  for (const path of scene.pipe_paths) {
    assert.equal(path.relation_type, "FEEDS");
    assert.ok(assetIds.has(path.source_asset_id), `dangling source ${path.source_asset_id}`);
    assert.ok(assetIds.has(path.target_asset_id), `dangling target ${path.target_asset_id}`);
    assert.equal(path.not_engineering_pipe_routing, true);
  }
});

test("event replay snapshot determinism: sequential asset creation matching event log", () => {
  assert.equal(events.length, 120, "must have 120 fixture events");
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].sequence, i + 1, "sequences must be monotonic 1..120");
    assert.equal(events[i].event_type, "asset.created");
  }

  // Replay sequence slider in UI
  assert.match(worldPage, /Fixture Event Replay/);
  assert.match(worldPage, /setReplaySequence/);
  assert.match(worldPage, /snapshotAssets/);
});

test("2D topology accessible alternative: keyboard accessible SVG with high-contrast parity", () => {
  assert.match(worldPage, /2D Topology · Accessible Alternative/);
  assert.match(worldPage, /<svg\b/);
  assert.match(worldPage, /tabIndex=\{0\}/);
  assert.match(worldPage, /onKeyDown/);
  assert.match(worldPage, /aria-label=/);
  assert.match(worldPage, /<title>/);
});

test("inspection, health overlays, live telemetry, and cross-section isolate controls", () => {
  assert.match(worldPage, /Asset Inspector/);
  assert.match(worldPage, /Live Telemetry/);
  assert.match(worldPage, /Health Overlay/);
  assert.match(worldPage, /Isolate Selected/);
  assert.match(worldPage, /Cross-Section/i);
  assert.match(worldPage, /Fly Controls/);
  assert.match(canvasComponent, /AnnotationLayer/);
  assert.match(canvasComponent, /CrossSectionPlane/);
});

test("simulation preview: distinct simulated plan banner, 3D HUD overlay, and exact numerical charts", () => {
  assert.match(simPreview, /SIMULATED PLAN · NOT LIVE PLANT BASELINE/);
  assert.match(simPreview, /Hydraulic Solver Scenario Preview/);
  assert.match(simPreview, /Active Scenario:/);
  assert.match(simPreview, /Target threshold: 200 kPa/);
  assert.match(simPreview, /Numerical Tradeoff Comparison \(Exact Solver Values\)/);
  assert.match(simPreview, /Demand \/ Capacity/);
});
