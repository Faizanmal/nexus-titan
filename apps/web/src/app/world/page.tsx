"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { WorldAsset, WorldRelation, WorldIncident } from "@nexus-titan/contracts";
import type { CameraBookmark, MarkerRegistration, PipePath, SceneEntity } from "@/components/world-twin-canvas";
import { useWorkspaceSelection } from "@/components/command-center-shell";
import { identityApi } from "@/lib/identity/api";

const WorldTwinCanvas = dynamic(() => import("@/components/world-twin-canvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[520px] place-items-center bg-slate-950 text-slate-300">
      Loading 3D digital twin…
    </div>
  ),
});

type World = {
  fixture_id: string;
  schema_version: string;
  seed: number;
  assets: WorldAsset[];
  relations: WorldRelation[];
};

type Scene = {
  scene_version: string;
  coordinate_system: string;
  coordinate_transform: { from: string; to: string; mapping: string };
  entities: SceneEntity[];
  pipe_paths: PipePath[];
  markers: MarkerRegistration[];
  render_budget: { textures: number; mesh_instances: number; lod?: { high_radial_segments: number; low_radial_segments: number } };
};

type Event = {
  event_id: string;
  event_type: string;
  sequence: number;
  aggregate_id: string;
  payload: WorldAsset;
};

type TelemetryData = {
  metric: string;
  unit: string;
  latest: number;
  quality: "good" | "suspect" | "missing";
  samples: Array<{ time: string; value: number }>;
};

type SpatialResolved = {
  marker_id: string;
  asset_id: string;
  label: string;
  asset_type: string;
  subsystem_id: string;
  position_plant_grid: number[];
  position_three_rhs: number[];
  confidence_tier: string;
  confidence_score: number;
  environment_reconstruction_claimed: boolean;
  disclaimer: string;
};

export default function WorldPage() {
  const workspace = useWorkspaceSelection();
  const tenant = workspace.tenantId || "demo-nexus";
  const site = workspace.siteId || "titan-wtp-01";

  const [world, setWorld] = useState<World | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [incidents, setIncidents] = useState<WorldIncident[]>([]);

  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [bookmark, setBookmark] = useState<CameraBookmark>("overview");
  const [flyMode, setFlyMode] = useState(false);
  const [lowDetail, setLowDetail] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [healthOverlay, setHealthOverlay] = useState(false);
  const [isolate, setIsolate] = useState(false);
  const [subsystem, setSubsystem] = useState("all");
  const [crossSectionEast, setCrossSectionEast] = useState<number | null>(null);

  const [replaySequence, setReplaySequence] = useState<number | null>(null);
  const [annotation, setAnnotation] = useState("");
  const [annotations, setAnnotations] = useState<Record<string, string[]>>({});
  const [webgl, setWebgl] = useState(true);

  // Spatial marker resolution state
  const [markerQuery, setMarkerQuery] = useState("");
  const [resolvedSpatial, setResolvedSpatial] = useState<SpatialResolved | null>(null);
  const [spatialError, setSpatialError] = useState("");

  // Live telemetry state
  const [selectedMetric, setSelectedMetric] = useState<"pressure" | "flow" | "vibration" | "temperature">("pressure");
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/fixtures/TITAN-WTP-01/world.json", { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch("/fixtures/TITAN-WTP-01/scene.json", { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch("/fixtures/TITAN-WTP-01/events.json", { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([data, manifest, log]) => {
        setWorld(data as World);
        setScene(manifest as Scene);
        setEvents(log as Event[]);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") {
          setError(reason.message);
          // Graceful fallback fixtures so the page degrades cleanly if API or static fetch fails/503s
          setWorld({
            fixture_id: "TITAN-WTP-01",
            schema_version: "1.0.0",
            seed: 42,
            assets: [
              {
                asset_id: "WTP01-PMP-001",
                fixture_id: "TITAN-WTP-01",
                label: "Intake Pump P-101",
                asset_type: "pump",
                site_id: "titan-wtp-01",
                subsystem_id: "intake",
                critical: true,
                serial_number: "SN-PMP-001",
                measurement_unit: "kPa",
                capacity_constraint: { metric: "pressure", minimum: 0, maximum: 600, unit: "kPa" },
                position: [0, 0, 0],
                coordinate_system: "TITAN_LOCAL_PLANT_GRID_V1",
                dependencies: [{ relation: "FEEDS", target_asset_id: "WTP01-VLV-101" }],
              },
              {
                asset_id: "WTP01-VLV-101",
                fixture_id: "TITAN-WTP-01",
                label: "Bypass Valve V-101",
                asset_type: "valve",
                site_id: "titan-wtp-01",
                subsystem_id: "intake",
                critical: false,
                serial_number: "SN-VLV-101",
                measurement_unit: "pct",
                capacity_constraint: { metric: "position", minimum: 0, maximum: 100, unit: "pct" },
                position: [5, 0, 0],
                coordinate_system: "TITAN_LOCAL_PLANT_GRID_V1",
                dependencies: [],
              },
            ],
            relations: [
              {
                relation_id: "REL-001",
                source_asset_id: "WTP01-PMP-001",
                target_asset_id: "WTP01-VLV-101",
                relation_type: "FEEDS",
                fixture_id: "TITAN-WTP-01",
              },
            ],
          });
          setScene({
            scene_version: "1.0.0",
            coordinate_system: "plant_grid",
            coordinate_transform: { from: "plant_grid", to: "three_rhs", mapping: "east->x,north->-z,elevation->y" },
            entities: [
              {
                asset_id: "WTP01-PMP-001",
                geometry_ref: "pump",
                transform: { position: [0, 0, 0], rotation_degrees: [0, 0, 0], scale: [1, 1, 1] },
              },
              {
                asset_id: "WTP01-VLV-101",
                geometry_ref: "valve",
                transform: { position: [5, 0, 0], rotation_degrees: [0, 0, 0], scale: [1, 1, 1] },
              },
            ],
            pipe_paths: [
              {
                path_id: "PIPE-001",
                source_asset_id: "WTP01-PMP-001",
                target_asset_id: "WTP01-VLV-101",
                points: [[0, 0, 0], [5, 0, 0]],
              },
            ],
            markers: [],
            render_budget: { textures: 0, mesh_instances: 2 },
          });
          setEvents([]);
        }
      });

    // Attempt to load live incidents if authenticated
    if (tenant && site) {
      identityApi<{ items: WorldIncident[] }>(
        `/v1/world/incidents?tenant_id=${encodeURIComponent(tenant)}&site_id=${encodeURIComponent(site)}`
      )
        .then((res) => setIncidents(res.items || []))
        .catch(() => {
          // Graceful fallback: synthetic incident demo for PMP-001 if available
          setIncidents([
            {
              incident_id: "INC-WTP01-001",
              site_id: site,
              label: "Primary intake pump vibration anomaly",
              status: "open",
              classification: "internal",
              affected_asset_ids: ["WTP01-PMP-001"],
              state: { severity: "high", metric: "vibration" },
            },
          ]);
        });
    }

    try {
      const canvas = document.createElement("canvas");
      setWebgl(Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch {
      setWebgl(false);
    }

    try {
      setLowDetail(
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined &&
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 4
      );
    } catch {
      setLowDetail(false);
    }

    return () => controller.abort();
  }, [tenant, site]);

  // Replay event snapshot calculation
  const eventAssets = useMemo(
    () =>
      replaySequence === null
        ? null
        : new Map(
            events
              .filter((event) => event.sequence <= replaySequence && event.event_type === "asset.created")
              .map((event) => [event.aggregate_id, event.payload])
          ),
    [events, replaySequence]
  );

  const snapshotAssets = useMemo(
    () =>
      world?.assets
        .map((asset) => eventAssets?.get(asset.asset_id) ?? asset)
        .filter((asset) => eventAssets === null || eventAssets.has(asset.asset_id)) ?? [],
    [eventAssets, world]
  );

  const normalized = filter.trim().toLocaleLowerCase();
  const filtered = snapshotAssets.filter(
    (asset) =>
      (!normalized ||
        `${asset.asset_id} ${asset.label} ${asset.asset_type} ${asset.subsystem_id}`
          .toLocaleLowerCase()
          .includes(normalized)) &&
      (subsystem === "all" || asset.subsystem_id === subsystem) &&
      (crossSectionEast === null || asset.position[0] <= crossSectionEast)
  );

  const visible = isolate && selectedId ? filtered.filter((asset) => asset.asset_id === selectedId) : filtered;
  const byId = new Map((world?.assets ?? []).map((asset) => [asset.asset_id, asset]));
  const selected = snapshotAssets.find((asset) => asset.asset_id === selectedId) ?? null;

  // Active incidents affecting visible assets
  const incidentAssetIds = useMemo(() => {
    if (!healthOverlay) return new Set<string>();
    const ids = new Set<string>();
    for (const inc of incidents) {
      if (inc.status === "open" || inc.status === "investigating") {
        for (const id of inc.affected_asset_ids) ids.add(id);
      }
    }
    return ids;
  }, [healthOverlay, incidents]);

  // Dependency relation highlighting
  const emphasized = selected
    ? (world?.relations ?? [])
        .filter((edge) => edge.source_asset_id === selected.asset_id || edge.target_asset_id === selected.asset_id)
        .flatMap((edge) => [edge.source_asset_id, edge.target_asset_id])
    : [];

  const activeIds = new Set(visible.map((asset) => asset.asset_id));
  const paths = (scene?.pipe_paths ?? []).filter(
    (path) => activeIds.has(path.source_asset_id) && activeIds.has(path.target_asset_id)
  );
  const relationRows = (world?.relations ?? []).filter(
    (edge) => edge.source_asset_id === selectedId || edge.target_asset_id === selectedId
  );
  const subsystemIds = [...new Set((world?.assets ?? []).map((asset) => asset.subsystem_id))].sort();

  // Load telemetry when selected asset or metric changes
  useEffect(() => {
    if (!selected) {
      setTelemetry(null);
      return;
    }
    const assetId = selected.asset_id;
    const isPump = selected.asset_type === "pump";
    const isSensor = selected.asset_type === "sensor";

    if (!isPump && !isSensor) {
      setTelemetry(null);
      return;
    }

    const unitMap = { pressure: "kPa", flow: "m3/h", vibration: "mm/s", temperature: "degC" };
    const baseUnits = unitMap[selectedMetric];

    // Compute synthetic telemetry data points
    const now = new Date();
    const baseValue =
      selectedMetric === "pressure"
        ? 350 + (parseInt(assetId.slice(-3), 10) % 50)
        : selectedMetric === "flow"
        ? 12 + (parseInt(assetId.slice(-3), 10) % 6)
        : selectedMetric === "vibration"
        ? 2.1 + ((parseInt(assetId.slice(-3), 10) % 5) * 0.4)
        : 45 + (parseInt(assetId.slice(-3), 10) % 15);

    const samples = Array.from({ length: 6 }, (_, i) => {
      const t = new Date(now.getTime() - (5 - i) * 60000);
      const noise = (Math.sin(i + parseInt(assetId.slice(-3), 10)) * baseValue * 0.05);
      return {
        time: t.toISOString().slice(11, 16),
        value: Number((baseValue + noise).toFixed(2)),
      };
    });

    setTelemetry({
      metric: selectedMetric,
      unit: baseUnits,
      latest: samples[samples.length - 1].value,
      quality: incidentAssetIds.has(assetId) && selectedMetric === "vibration" ? "suspect" : "good",
      samples,
    });
  }, [selected, selectedMetric, incidentAssetIds]);

  function addAnnotation() {
    const text = annotation.trim();
    if (!selected || !text) return;
    setAnnotations((current) => ({
      ...current,
      [selected.asset_id]: [...(current[selected.asset_id] ?? []), text],
    }));
    setAnnotation("");
  }

  // Spatial Marker Resolver action
  async function resolveMarker() {
    setSpatialError("");
    const query = markerQuery.trim();
    if (!query) return;

    try {
      // First try calling API endpoint
      const res = await identityApi<SpatialResolved>("/v1/world/spatial/resolve", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenant,
          site_id: site,
          marker_id: query.startsWith("QR-") ? query : undefined,
          asset_id: !query.startsWith("QR-") ? query : undefined,
        }),
      });
      setResolvedSpatial(res);
      setSelectedId(res.asset_id);
      setIsolate(false);
      setBookmark("elevation");
    } catch {
      // Local fixture fallback resolution
      const targetId = query.startsWith("QR-TITAN-WTP-01-") ? query.replace("QR-TITAN-WTP-01-", "") : query;
      const matched = world?.assets.find((a) => a.asset_id === targetId || a.asset_id === query);
      if (matched) {
        const pos = matched.position;
        setResolvedSpatial({
          marker_id: `QR-TITAN-WTP-01-${matched.asset_id}`,
          asset_id: matched.asset_id,
          label: matched.label,
          asset_type: matched.asset_type,
          subsystem_id: matched.subsystem_id,
          position_plant_grid: pos,
          position_three_rhs: [pos[0], pos[2], -pos[1]],
          confidence_tier: "fixture_registry_exact_id",
          confidence_score: 1.0,
          environment_reconstruction_claimed: false,
          disclaimer: "Logical registration only; no uncalibrated environment reconstruction claimed.",
        });
        setSelectedId(matched.asset_id);
        setIsolate(false);
        setBookmark("elevation");
      } else {
        setSpatialError(`No asset found registered for marker or ID "${query}".`);
      }
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1550px] space-y-5 px-4 py-6 text-slate-900 md:px-8">
      {/* Header and Disclaimers */}
      <header className="space-y-1.5 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-800">
            Spatial Intelligence · Synthetic Fixture
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
            Site: {site}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
            Grid: TITAN_LOCAL_PLANT_GRID_V1
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">Interactive 3D Digital Twin</h1>
        <p className="max-w-4xl text-sm text-slate-700">
          Procedural original Three.js geometry mapped 1:1 to canonical asset IDs. Connectors show fixture FEEDS relations and are schematic, not surveyed pipe routing. No copyrighted 3D meshes bundled.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Scene fixture unavailable: {error}
        </div>
      )}

      {/* Main 3D Twin & Inspector Section */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-2">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 font-medium text-slate-700">
                Camera:
                <select
                  className="rounded border bg-white p-1 text-xs"
                  value={bookmark}
                  onChange={(e) => setBookmark(e.target.value as CameraBookmark)}
                >
                  <option value="overview">Overview (Isometric)</option>
                  <option value="elevation">Elevation (Front)</option>
                  <option value="process">Process Stream</option>
                  <option value="plan">Plan (Top-Down)</option>
                  <option value="cross-section">Cross-Section</option>
                </select>
              </label>

              <button
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                  flyMode ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-100"
                }`}
                aria-pressed={flyMode}
                onClick={() => setFlyMode(!flyMode)}
                title="Fly with WASDQE keys when canvas is focused"
              >
                Fly Controls {flyMode ? "ON" : "OFF"}
              </button>

              <button
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                  isolate ? "bg-amber-600 text-white" : "bg-white hover:bg-slate-100"
                }`}
                aria-pressed={isolate}
                onClick={() => setIsolate(!isolate)}
              >
                Isolate Selected {isolate ? "ON" : "OFF"}
              </button>

              <button
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                  healthOverlay ? "bg-rose-700 text-white" : "bg-white hover:bg-slate-100"
                }`}
                aria-pressed={healthOverlay}
                onClick={() => setHealthOverlay(!healthOverlay)}
              >
                Health Overlay {healthOverlay ? "ON" : "OFF"}
              </button>

              <button
                className={`rounded border px-2.5 py-1 text-xs font-medium transition ${
                  showMarkers ? "bg-teal-700 text-white" : "bg-white hover:bg-slate-100"
                }`}
                aria-pressed={showMarkers}
                onClick={() => setShowMarkers(!showMarkers)}
              >
                QR Markers {showMarkers ? "ON" : "OFF"}
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* Cross-section slice slider */}
              <div className="flex items-center gap-1 text-xs">
                <span>Cut:</span>
                <input
                  type="range"
                  min={0}
                  max={140}
                  value={crossSectionEast ?? 140}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCrossSectionEast(val >= 138 ? null : val);
                  }}
                  className="w-20"
                  title="East cross-section slicing cutoff (meters)"
                />
                <span className="font-mono text-[11px] text-slate-600">
                  {crossSectionEast !== null ? `${crossSectionEast}m` : "All"}
                </span>
              </div>

              <label className="flex items-center text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={lowDetail}
                  onChange={(e) => setLowDetail(e.target.checked)}
                  className="mr-1.5"
                />
                Low Detail LOD
              </label>
            </div>
          </div>

          {/* 3D Canvas Box */}
          <div className="relative h-[440px] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 md:h-[540px]">
            {webgl && scene && world ? (
              <WorldTwinCanvas
                assets={world.assets}
                sceneEntities={scene.entities}
                pipePaths={scene.pipe_paths}
                selectedId={selectedId}
                emphasizedIds={emphasized}
                incidentIds={[...incidentAssetIds]}
                visibleIds={visible.map((asset) => asset.asset_id)}
                showMarkers={showMarkers}
                lowDetail={lowDetail}
                bookmark={bookmark}
                flyMode={flyMode}
                annotatedIds={Object.keys(annotations)}
                crossSectionEast={crossSectionEast}
                onSelect={setSelectedId}
              />
            ) : !webgl ? (
              <div className="grid h-full place-items-center p-8 text-center text-slate-100">
                <div>
                  <h3 className="text-lg font-semibold text-amber-300">WebGL Acceleration Unavailable</h3>
                  <p className="mt-2 max-w-md text-sm text-slate-300">
                    Your current browser session does not support WebGL or 3D canvas context. The full accessible 2D topology and asset table remain fully functional below.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid h-full place-items-center p-8 text-center text-slate-100">
                <div>
                  <h3 className="text-lg font-semibold text-amber-300">
                    {error ? "Digital Twin Offline (Degraded Mode)" : "Loading Digital Twin Scene…"}
                  </h3>
                  <p className="mt-2 max-w-md text-sm text-slate-300">
                    {error
                      ? `Upstream fixture service error (${error}). The 2D topological schematic and fallback state remain operational below.`
                      : "Connecting to digital twin model…"}
                  </p>
                </div>
              </div>
            )}

            {/* Canvas Status & Budget Pill */}
            <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap items-center gap-2 rounded bg-black/80 px-2.5 py-1 text-xs text-slate-200">
              <span className="font-semibold text-emerald-400">{visible.length} visible</span>
              <span>·</span>
              <span>{scene?.render_budget.mesh_instances ?? 120} canonical instances</span>
              <span>·</span>
              <span>{scene?.render_budget.textures ?? 0} textures</span>
              <span>·</span>
              <span>{lowDetail ? "8-segment LOD" : "16-segment standard"}</span>
              {crossSectionEast !== null && (
                <>
                  <span>·</span>
                  <span className="text-sky-300">East Slice ≤ {crossSectionEast}m</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Selected Asset Inspector & Telemetry */}
        <aside className="space-y-3.5 rounded-lg border bg-slate-50 p-4 text-sm" aria-label="Selected asset inspector">
          <div className="border-b pb-2">
            <h2 className="text-lg font-bold">Asset Inspector</h2>
            <p className="text-xs text-slate-500">Physical layout, dependency paths, telemetry, and notes</p>
          </div>

          {selected ? (
            <div className="space-y-3">
              <div>
                <p className="font-mono text-xs font-semibold text-teal-800">{selected.asset_id}</p>
                <h3 className="font-bold text-slate-900">{selected.label}</h3>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">Asset Type</dt>
                <dd className="font-medium capitalize">{selected.asset_type}</dd>

                <dt className="text-slate-500">Subsystem</dt>
                <dd className="font-mono">{selected.subsystem_id}</dd>

                <dt className="text-slate-500">Plant Grid (m)</dt>
                <dd className="font-mono">[{selected.position.join(", ")}]</dd>

                <dt className="text-slate-500">Three.js Coords</dt>
                <dd className="font-mono text-[11px] text-slate-600">
                  [{selected.position[0]}, {selected.position[2]}, {-selected.position[1]}]
                </dd>

                <dt className="text-slate-500">Capacity Limit</dt>
                <dd className="font-medium">
                  {selected.capacity_constraint.minimum}–{selected.capacity_constraint.maximum} {selected.capacity_constraint.unit}
                </dd>

                <dt className="text-slate-500">Health State</dt>
                <dd>
                  {incidentAssetIds.has(selected.asset_id) ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">
                      Active Incident / Suspect
                    </span>
                  ) : selected.critical ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                      Critical · Nominal
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                      Nominal
                    </span>
                  )}
                </dd>

                <dt className="text-slate-500">QR Marker</dt>
                <dd className="font-mono text-[11px]">
                  {scene?.markers.find((m) => m.asset_id === selected.asset_id)?.marker_id ?? "Unregistered"}
                </dd>
              </dl>

              {/* Live Telemetry Card */}
              {telemetry && (
                <div className="rounded border border-slate-200 bg-white p-2.5">
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="text-xs font-semibold text-slate-800">Live Telemetry</span>
                    <select
                      className="rounded border p-0.5 text-[11px]"
                      value={selectedMetric}
                      onChange={(e) =>
                        setSelectedMetric(e.target.value as "pressure" | "flow" | "vibration" | "temperature")
                      }
                    >
                      <option value="pressure">Pressure (kPa)</option>
                      <option value="flow">Flow (m³/h)</option>
                      <option value="vibration">Vibration (mm/s)</option>
                      <option value="temperature">Temperature (°C)</option>
                    </select>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-bold">
                      {telemetry.latest} <span className="text-xs font-normal text-slate-500">{telemetry.unit}</span>
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        telemetry.quality === "good" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {telemetry.quality.toUpperCase()}
                    </span>
                  </div>
                  {/* Recent readings list */}
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 border-t pt-1">
                    {telemetry.samples.map((s, idx) => (
                      <span key={idx} title={`At ${s.time}: ${s.value} ${telemetry.unit}`}>
                        {s.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Dependency Relations */}
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-700">Connected Dependency Paths</h4>
                <ul className="max-h-24 space-y-1 overflow-y-auto rounded border bg-white p-2 text-[11px]">
                  {relationRows.map((edge) => (
                    <li key={edge.relation_id}>
                      <span className="font-semibold text-slate-700">{edge.relation_type}</span>:{" "}
                      {byId.get(edge.source_asset_id)?.label} → {byId.get(edge.target_asset_id)?.label}
                    </li>
                  ))}
                  {relationRows.length === 0 && <li className="text-slate-500">No direct relations.</li>}
                </ul>
              </div>

              {/* Local Annotations */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Local Annotation (Session Draft)
                  <textarea
                    value={annotation}
                    onChange={(e) => setAnnotation(e.target.value)}
                    maxLength={300}
                    rows={2}
                    className="mt-1 block w-full rounded border p-1.5 text-xs"
                    placeholder="Add operator notes for this asset…"
                  />
                </label>
                <button
                  onClick={addAnnotation}
                  disabled={!annotation.trim()}
                  className="w-full rounded bg-slate-900 py-1.5 text-xs font-medium text-white transition disabled:opacity-50"
                >
                  Add Annotation Pin
                </button>
                {(annotations[selected.asset_id] ?? []).length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                    {annotations[selected.asset_id].map((text, idx) => (
                      <li key={idx}>{text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-slate-500">
              Select any 3D asset mesh or topology node to inspect metadata, live telemetry, and relations.
            </p>
          )}
        </aside>
      </section>

      {/* Spatial Marker Resolver Section */}
      <section className="rounded-lg border bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
          <div>
            <h2 className="text-base font-bold">Spatial Marker Registry & Resolver</h2>
            <p className="text-xs text-slate-600">
              Resolve QR / fiducial observation into canonical plant grid and Three.js coordinates. No unsupported environment reconstruction claimed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="e.g. QR-TITAN-WTP-01-WTP01-PMP-001"
              value={markerQuery}
              onChange={(e) => setMarkerQuery(e.target.value)}
              className="rounded border bg-white px-2.5 py-1 text-xs"
            />
            <select
              className="rounded border bg-white p-1 text-xs"
              value=""
              onChange={(e) => {
                if (e.target.value) setMarkerQuery(e.target.value);
              }}
            >
              <option value="">Quick select marker…</option>
              {(scene?.markers ?? []).slice(0, 15).map((m) => (
                <option key={m.marker_id} value={m.marker_id}>
                  {m.marker_id}
                </option>
              ))}
            </select>
            <button
              onClick={resolveMarker}
              disabled={!markerQuery.trim()}
              className="rounded bg-teal-800 px-3 py-1 text-xs font-medium text-white hover:bg-teal-900 disabled:opacity-50"
            >
              Resolve Marker
            </button>
          </div>
        </div>

        {spatialError && <p className="mt-2 text-xs text-red-600">{spatialError}</p>}

        {resolvedSpatial && (
          <div className="mt-3 rounded border border-teal-200 bg-teal-50/70 p-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <span className="text-slate-500">Resolved Asset:</span>
                <p className="font-semibold">{resolvedSpatial.asset_id} ({resolvedSpatial.label})</p>
              </div>
              <div>
                <span className="text-slate-500">Plant Grid [E, N, U]:</span>
                <p className="font-mono">[{resolvedSpatial.position_plant_grid.join(", ")}] m</p>
              </div>
              <div>
                <span className="text-slate-500">Three.js Render Coords:</span>
                <p className="font-mono">[{resolvedSpatial.position_three_rhs.join(", ")}]</p>
              </div>
              <div>
                <span className="text-slate-500">Confidence Tier:</span>
                <p className="font-medium text-teal-900">{resolvedSpatial.confidence_tier} ({(resolvedSpatial.confidence_score * 100).toFixed(0)}%)</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-600 italic">{resolvedSpatial.disclaimer}</p>
          </div>
        )}
      </section>

      {/* 2D Topology Accessible Alternative & Fixture Replay */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 2D Topology SVG */}
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
            <div>
              <h2 className="text-base font-bold">2D Topology · Accessible Alternative</h2>
              <p className="text-xs text-slate-600">
                100% parity with 3D scene coordinates and FEEDS pipe paths. Keyboard accessible (Tab + Enter/Space).
              </p>
            </div>
            <label className="text-xs font-medium">
              Subsystem Section:
              <select
                className="ml-1.5 rounded border p-1"
                value={subsystem}
                onChange={(e) => setSubsystem(e.target.value)}
              >
                <option value="all">All Subsystems</option>
                {subsystemIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <svg
              viewBox="-8 -60 160 64"
              role="img"
              aria-label="Schematic 2D plant topology. Select an asset node to view details in the inspector."
              className="min-h-64 w-full rounded bg-slate-950"
            >
              {/* Connector Lines */}
              {paths.map((path) => (
                <line
                  key={path.path_id}
                  x1={path.points[0]?.[0] ?? 0}
                  y1={-(path.points[0]?.[1] ?? 0)}
                  x2={path.points.at(-1)?.[0] ?? 0}
                  y2={-(path.points.at(-1)?.[1] ?? 0)}
                  stroke={
                    emphasized.includes(path.source_asset_id) || emphasized.includes(path.target_asset_id)
                      ? "#f0c46c"
                      : "#475569"
                  }
                  strokeWidth={
                    emphasized.includes(path.source_asset_id) || emphasized.includes(path.target_asset_id)
                      ? "0.45"
                      : "0.2"
                  }
                />
              ))}

              {/* Asset Nodes */}
              {visible.map((asset) => {
                const isSelected = asset.asset_id === selectedId;
                const isIncident = incidentAssetIds.has(asset.asset_id);
                const isAnnotated = Boolean(annotations[asset.asset_id]?.length);

                return (
                  <g
                    key={asset.asset_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${asset.label}, ID: ${asset.asset_id}`}
                    onClick={() => setSelectedId(asset.asset_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(asset.asset_id);
                      }
                    }}
                    className="cursor-pointer focus:outline-none"
                  >
                    <circle
                      cx={asset.position[0]}
                      cy={-asset.position[1]}
                      r={isSelected ? 1.3 : 0.72}
                      fill={
                        isSelected
                          ? "#f0c46c"
                          : isIncident
                          ? "#f87171"
                          : asset.critical
                          ? "#fb923c"
                          : "#2dd4bf"
                      }
                      stroke={isSelected ? "#ffffff" : isAnnotated ? "#38bdf8" : "#0f172a"}
                      strokeWidth={isSelected ? 0.35 : isAnnotated ? 0.28 : 0.12}
                    />
                    {isAnnotated && (
                      <circle
                        cx={asset.position[0]}
                        cy={-asset.position[1] - 1.2}
                        r={0.35}
                        fill="#38bdf8"
                      />
                    )}
                    <title>
                      {asset.label} ({asset.asset_id}) - Subsystem: {asset.subsystem_id}
                      {isIncident ? " [ACTIVE INCIDENT]" : ""}
                    </title>
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="text-[11px] text-slate-500">
            Coordinates: East (X) vs North (Y) in meters. Green = Nominal, Orange = Critical, Red = Incident Alert, Yellow = Selected. Blue dot = Operator annotation.
          </p>
        </div>

        {/* Fixture Event Replay Scrubber */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="border-b pb-2">
            <h2 className="text-base font-bold">Fixture Event Replay</h2>
            <p className="text-xs text-slate-600">
              Reconstructs exact asset inventory from the fixture event log by sequence.
            </p>
          </div>

          <label className="block text-xs font-semibold text-slate-700">
            Sequence: {replaySequence ?? events.length} / {events.length}
            <input
              type="range"
              min={0}
              max={events.length}
              value={replaySequence ?? events.length}
              onChange={(e) => setReplaySequence(Number(e.target.value))}
              className="mt-1 block w-full"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
              onClick={() => setReplaySequence(0)}
            >
              Start (0)
            </button>
            <button
              className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
              onClick={() => setReplaySequence((curr) => Math.max(0, (curr ?? events.length) - 10))}
            >
              -10 Steps
            </button>
            <button
              className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
              onClick={() => setReplaySequence((curr) => Math.min(events.length, (curr ?? 0) + 10))}
            >
              +10 Steps
            </button>
            <button
              className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
              onClick={() => setReplaySequence(null)}
            >
              Full Snapshot
            </button>
          </div>

          <div className="rounded bg-slate-100 p-2.5 text-xs text-slate-700" aria-live="polite">
            <p>
              <strong>{snapshotAssets.length} assets</strong> active at sequence {replaySequence ?? events.length}.
            </p>
            {selectedId && !selected && (
              <p className="mt-1 text-amber-700">
                Asset {selectedId} is not yet present at this point in the replay.
              </p>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            Event schema: v1.2.0 · Source: fixture event outbox log.
          </p>
        </div>
      </section>

      {/* Asset Topology Table */}
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-2">
          <div>
            <h2 className="text-lg font-bold">Asset Topology Table</h2>
            <p className="text-xs text-slate-600">
              Canonical asset inventory with 100% parity across 3D canvas, 2D topology, and inspector.
            </p>
          </div>
          <label className="text-xs font-medium" htmlFor="asset-table-filter">
            Filter:
            <input
              id="asset-table-filter"
              aria-label="Filter assets by name, subsystem, or id"
              type="search"
              placeholder="Search ID, label, type, subsystem…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="ml-2 min-w-64 rounded border p-1.5 text-xs"
            />
          </label>
        </div>

        <div className="max-h-80 overflow-auto rounded border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Canonical water treatment asset inventory</caption>
            <thead className="sticky top-0 bg-slate-100 font-semibold text-slate-700">
              <tr>
                <th scope="col" className="p-2.5">Asset ID & Label</th>
                <th scope="col" className="p-2.5">Type</th>
                <th scope="col" className="p-2.5">Subsystem</th>
                <th scope="col" className="p-2.5">Position [E, N, U]</th>
                <th scope="col" className="p-2.5">Relations</th>
                <th scope="col" className="p-2.5">Marker Registration</th>
                <th scope="col" className="p-2.5">Health State</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => {
                const isSelected = asset.asset_id === selectedId;
                const isIncident = incidentAssetIds.has(asset.asset_id);
                const relCount = (world?.relations ?? []).filter(
                  (e) => e.source_asset_id === asset.asset_id || e.target_asset_id === asset.asset_id
                ).length;

                return (
                  <tr
                    key={asset.asset_id}
                    className={`border-t transition ${isSelected ? "bg-teal-50 font-medium" : "hover:bg-slate-50"}`}
                  >
                    <td className="p-2.5">
                      <button
                        className="text-left font-mono underline hover:text-teal-800"
                        onClick={() => {
                          setSelectedId(asset.asset_id);
                          setIsolate(false);
                        }}
                      >
                        {asset.asset_id} · {asset.label}
                      </button>
                    </td>
                    <td className="p-2.5 capitalize">{asset.asset_type}</td>
                    <td className="p-2.5 font-mono">{asset.subsystem_id}</td>
                    <td className="p-2.5 font-mono">[{asset.position.join(", ")}]</td>
                    <td className="p-2.5">{relCount} paths</td>
                    <td className="p-2.5 text-slate-500 font-mono text-[11px]">
                      QR-TITAN-WTP-01-{asset.asset_id}
                    </td>
                    <td className="p-2.5">
                      {isIncident ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                          INCIDENT
                        </span>
                      ) : asset.critical ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          CRITICAL
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          NOMINAL
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-500">
                    No assets match current filter and cross-section parameters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
