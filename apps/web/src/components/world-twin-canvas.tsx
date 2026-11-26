"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { BoxGeometry, Color, CylinderGeometry, InstancedMesh, LineBasicMaterial, BufferGeometry, LineSegments, MeshStandardMaterial, Object3D, TorusGeometry, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WorldAsset } from "@nexus-titan/contracts";

export type SceneEntity = { asset_id: string; geometry_ref: string; transform: { position: number[]; rotation_degrees: number[]; scale: number[] } };
export type PipePath = { path_id: string; source_asset_id: string; target_asset_id: string; points: number[][] };
export type MarkerRegistration = { marker_id: string; asset_id: string; position: number[]; physical_tag_printed: false };
export type CameraBookmark = "overview" | "elevation" | "process" | "plan" | "cross-section";

const colors: Record<WorldAsset["asset_type"], string> = {
  subsystem: "#40545d", pump: "#46c7b5", tank: "#7399b3", filter: "#a6b7c3", valve: "#c8a35f", sensor: "#8e9fc3",
};
const vectorToThree = (position: number[]) => new Vector3(position[0] ?? 0, position[2] ?? 0, -(position[1] ?? 0));

function meshGeometry(type: WorldAsset["asset_type"], lowDetail: boolean) {
  const radial = lowDetail ? 8 : 16;
  if (type === "pump") return new CylinderGeometry(0.72, 0.88, 1.8, radial, 1);
  if (type === "tank") return new CylinderGeometry(1.8, 1.8, 4.4, radial, 1);
  if (type === "filter") return new CylinderGeometry(1.05, 1.05, 3.0, radial, 1);
  if (type === "valve") return new TorusGeometry(0.86, 0.18, lowDetail ? 5 : 8, radial);
  if (type === "sensor") return new BoxGeometry(0.72, 0.85, 0.72);
  return new BoxGeometry(8, 0.75, 5);
}

function assetScale(type: WorldAsset["asset_type"]): [number, number, number] {
  if (type === "subsystem") return [1, 1, 1];
  if (type === "pump") return [1.35, 1, 1];
  if (type === "tank") return [1, 1, 1];
  if (type === "filter") return [1, 1, 1];
  if (type === "valve") return [0.8, 0.8, 0.8];
  return [0.72, 0.72, 0.72];
}

function colorFor(asset: WorldAsset, selectedId: string, emphasized: Set<string>, incidentIds: Set<string>) {
  if (selectedId === asset.asset_id) return new Color("#e9ffff");
  if (incidentIds.has(asset.asset_id)) return new Color("#ff8f75");
  if (emphasized.has(asset.asset_id)) return new Color("#f0c46c");
  if (asset.critical) return new Color("#c89868");
  return new Color(colors[asset.asset_type]);
}

function AssetInstances({ type, assets, lowDetail, selectedId, emphasized, incidentIds, onSelect }: {
  type: WorldAsset["asset_type"]; assets: WorldAsset[]; lowDetail: boolean; selectedId: string;
  emphasized: Set<string>; incidentIds: Set<string>; onSelect: (assetId: string) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => meshGeometry(type, lowDetail), [type, lowDetail]);
  const material = useMemo(() => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.68, metalness: 0.08 }), []);
  const dummy = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    assets.forEach((asset, index) => {
      dummy.position.copy(vectorToThree(asset.position));
      dummy.rotation.set(0, 0, type === "pump" ? Math.PI / 2 : 0);
      dummy.scale.set(...assetScale(type));
      dummy.updateMatrix();
      ref.current?.setMatrixAt(index, dummy.matrix);
      ref.current?.setColorAt(index, colorFor(asset, selectedId, emphasized, incidentIds));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [assets, dummy, emphasized, incidentIds, selectedId, type]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  if (!assets.length) return null;
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const instanceId = (event as { instanceId?: number }).instanceId;
    const asset = instanceId == null ? undefined : assets[instanceId];
    if (asset) onSelect(asset.asset_id);
  };
  return <instancedMesh ref={ref} args={[geometry, material, assets.length]} castShadow receiveShadow onClick={onClick} />;
}

function ConnectorLayer({ paths, visibleIds, selectedId, emphasized }: { paths: PipePath[]; visibleIds: Set<string>; selectedId: string; emphasized: Set<string> }) {
  const all = useMemo(() => {
    const points: Vector3[] = [];
    for (const path of paths) {
      if (!visibleIds.has(path.source_asset_id) || !visibleIds.has(path.target_asset_id)) continue;
      const start = vectorToThree(path.points[0] ?? []); const end = vectorToThree(path.points.at(-1) ?? []);
      points.push(start.add(new Vector3(0, 0.28, 0)), end.add(new Vector3(0, 0.28, 0)));
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({ color: "#6c8992", transparent: true, opacity: 0.52 });
    return new LineSegments(geometry, material);
  }, [paths, visibleIds]);
  const highlight = useMemo(() => {
    const points: Vector3[] = [];
    for (const path of paths) {
      if (!emphasized.has(path.source_asset_id) && !emphasized.has(path.target_asset_id) && path.source_asset_id !== selectedId && path.target_asset_id !== selectedId) continue;
      if (!visibleIds.has(path.source_asset_id) || !visibleIds.has(path.target_asset_id)) continue;
      points.push(vectorToThree(path.points[0] ?? []).add(new Vector3(0, 0.36, 0)), vectorToThree(path.points.at(-1) ?? []).add(new Vector3(0, 0.36, 0)));
    }
    return new LineSegments(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: "#f0c46c", transparent: true, opacity: 0.95 }));
  }, [emphasized, paths, selectedId, visibleIds]);
  useEffect(() => () => { all.geometry.dispose(); (all.material as LineBasicMaterial).dispose(); }, [all]);
  useEffect(() => () => { highlight.geometry.dispose(); (highlight.material as LineBasicMaterial).dispose(); }, [highlight]);
  return <><primitive object={all} /><primitive object={highlight} /></>;
}

function MarkerLayer({ assets, enabled, selectedId }: { assets: WorldAsset[]; enabled: boolean; selectedId: string }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(0.18, 0.18, 0.18), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: "#f2f4f5", roughness: 0.36, metalness: 0.12 }), []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    assets.forEach((asset, index) => {
      const position = vectorToThree(asset.position); position.y += 2.4;
      const dummy = new Object3D(); dummy.position.copy(position); dummy.updateMatrix();
      ref.current?.setMatrixAt(index, dummy.matrix);
      ref.current?.setColorAt(index, new Color(asset.asset_id === selectedId ? "#56d9c3" : "#f2f4f5"));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [assets, selectedId]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  if (!enabled || !assets.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, assets.length]} />;
}

function AnnotationLayer({ assets, annotatedIds, selectedId }: { assets: WorldAsset[]; annotatedIds: Set<string>; selectedId: string }) {
  const ref = useRef<InstancedMesh>(null);
  const annotated = useMemo(() => assets.filter((asset) => annotatedIds.has(asset.asset_id)), [assets, annotatedIds]);
  const geometry = useMemo(() => new BoxGeometry(0.26, 0.42, 0.26), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: "#38bdf8", roughness: 0.28, metalness: 0.14 }), []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    annotated.forEach((asset, index) => {
      const position = vectorToThree(asset.position); position.y += 3.2;
      const dummy = new Object3D(); dummy.position.copy(position); dummy.rotation.set(0, Math.PI / 4, 0); dummy.updateMatrix();
      ref.current?.setMatrixAt(index, dummy.matrix);
      ref.current?.setColorAt(index, new Color(asset.asset_id === selectedId ? "#fde047" : "#38bdf8"));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [annotated, selectedId]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  if (!annotated.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, annotated.length]} />;
}

function CrossSectionPlane({ x }: { x: number | null }) {
  if (x == null) return null;
  return (
    <mesh position={[x, 10, -12]}>
      <boxGeometry args={[0.3, 24, 40]} />
      <meshStandardMaterial color="#38bdf8" transparent opacity={0.18} wireframe />
    </mesh>
  );
}

function CameraRig({ bookmark, flyMode }: { bookmark: CameraBookmark; flyMode: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  const keySet = useRef(new Set<string>());
  useEffect(() => {
    const presets: Record<CameraBookmark, { position: [number, number, number]; target: [number, number, number] }> = {
      overview: { position: [156, 112, 168], target: [65, 1.5, -12] },
      elevation: { position: [65, 54, 178], target: [65, 2, -12] },
      process: { position: [6, 62, 108], target: [65, 1.5, -12] },
      plan: { position: [65, 165, -12], target: [65, 0, -12.1] },
      "cross-section": { position: [175, 22, -12], target: [65, 8, -12] },
    };
    const preset = presets[bookmark]; camera.position.set(...preset.position); controls.target.set(...preset.target);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true;
    controls.minDistance = 12; controls.maxDistance = 330; controls.maxPolarAngle = Math.PI * 0.49;
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange); controls.update(); invalidate();
    return () => controls.removeEventListener("change", onChange);
  }, [bookmark, camera, controls, invalidate]);
  useEffect(() => {
    const element = gl.domElement; element.tabIndex = 0; element.setAttribute("aria-label", "3D twin canvas. Use mouse to orbit, wheel to zoom, and focus then use W A S D to fly when fly mode is enabled.");
    const down = (event: KeyboardEvent) => { if (document.activeElement === element && ["w", "a", "s", "d", "q", "e"].includes(event.key.toLowerCase())) { keySet.current.add(event.key.toLowerCase()); event.preventDefault(); } };
    const up = (event: KeyboardEvent) => keySet.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [gl]);
  useFrame((_state, delta) => {
    if (flyMode && keySet.current.size) {
      const step = Math.min(delta, 0.05) * 15;
      const direction = new Vector3(); camera.getWorldDirection(direction);
      const right = new Vector3().crossVectors(direction, camera.up).normalize();
      if (keySet.current.has("w")) camera.position.addScaledVector(direction, step);
      if (keySet.current.has("s")) camera.position.addScaledVector(direction, -step);
      if (keySet.current.has("a")) camera.position.addScaledVector(right, -step);
      if (keySet.current.has("d")) camera.position.addScaledVector(right, step);
      if (keySet.current.has("q")) camera.position.y -= step;
      if (keySet.current.has("e")) camera.position.y += step;
      controls.target.addScaledVector(direction, step * (keySet.current.has("w") ? 1 : keySet.current.has("s") ? -1 : 0));
      controls.update();
    } else controls.update();
  });
  return null;
}

export default function WorldTwinCanvas({
  assets, sceneEntities, pipePaths, selectedId, emphasizedIds, incidentIds, visibleIds,
  showMarkers, lowDetail, bookmark, flyMode, annotatedIds = [], crossSectionEast = null, onSelect,
}: {
  assets: WorldAsset[]; sceneEntities: SceneEntity[]; pipePaths: PipePath[]; selectedId: string; emphasizedIds: string[];
  incidentIds: string[]; visibleIds: string[]; showMarkers: boolean; lowDetail: boolean; bookmark: CameraBookmark; flyMode: boolean;
  annotatedIds?: string[]; crossSectionEast?: number | null; onSelect: (assetId: string) => void;
}) {
  const emphasized = useMemo(() => new Set(emphasizedIds), [emphasizedIds]);
  const incidents = useMemo(() => new Set(incidentIds), [incidentIds]);
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const annotated = useMemo(() => new Set(annotatedIds), [annotatedIds]);
  const allowed = assets.filter((asset) => visible.has(asset.asset_id));
  const byType = useMemo(() => Object.fromEntries(["subsystem", "pump", "tank", "filter", "valve", "sensor"].map((type) => [type, allowed.filter((asset) => asset.asset_type === type)])) as Record<WorldAsset["asset_type"], WorldAsset[]>, [allowed]);
  const sceneIds = new Set(sceneEntities.map((entity) => entity.asset_id));
  const renderAssets = allowed.filter((asset) => sceneIds.has(asset.asset_id));
  return <Canvas camera={{ position: [156, 112, 168], fov: 42, near: 0.1, far: 600 }} dpr={lowDetail ? 1 : [1, 1.5]} shadows={false} gl={{ antialias: !lowDetail, powerPreference: lowDetail ? "low-power" : "default" }} fallback={<p>WebGL rendering is unavailable. Use the accessible 2D topology and asset table below.</p>}>
    <color attach="background" args={["#0b1216"]} />
    <ambientLight intensity={1.65} /><directionalLight position={[70, 100, 50]} intensity={2.4} />
    <gridHelper args={[180, 36, "#42606b", "#263a42"]} position={[65, -0.16, -12]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[65, -0.28, -12]} receiveShadow><planeGeometry args={[165, 42]} /><meshStandardMaterial color="#142127" roughness={0.96} /></mesh>
    <CrossSectionPlane x={crossSectionEast} />
    {(["subsystem", "pump", "tank", "filter", "valve", "sensor"] as const).map((type) => <AssetInstances key={type} type={type} assets={byType[type]} lowDetail={lowDetail} selectedId={selectedId} emphasized={emphasized} incidentIds={incidents} onSelect={onSelect} />)}
    <ConnectorLayer paths={pipePaths} visibleIds={visible} selectedId={selectedId} emphasized={emphasized} />
    <MarkerLayer assets={renderAssets} enabled={showMarkers} selectedId={selectedId} />
    <AnnotationLayer assets={renderAssets} annotatedIds={annotated} selectedId={selectedId} />
    <CameraRig bookmark={bookmark} flyMode={flyMode} />
  </Canvas>;
}
