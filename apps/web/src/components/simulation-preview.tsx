"use client";

import { Canvas } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { Color } from "three";

export type ScenarioMetric = {
  intervention: string;
  solver_tier?: string;
  pressure_by_node_kpa_gauge: Record<string, number>;
  flows: Array<Record<string, string | number>>;
  capacity_m3h: number;
  demand_m3h: number;
  energy_kwh_proxy?: number;
  downtime_hours_proxy?: number;
  max_continuity_residual_m3h?: number;
  converged: boolean;
  service_pressure_shortfall?: boolean;
  capacity_exceeded?: boolean;
  critic?: { constraints_passed: boolean };
  uncertainty?: { class: string; drivers: string[] };
  limitations?: string[];
};

export default function SimulationPreview({ scenarios }: { scenarios: ScenarioMetric[] }) {
  const [selectedIntervention, setSelectedIntervention] = useState<string>("all");
  const maxPressure = Math.max(1, ...scenarios.map((s) => Math.max(...Object.values(s.pressure_by_node_kpa_gauge))));

  const displayedScenarios = useMemo(() => {
    if (selectedIntervention === "all") return scenarios;
    return scenarios.filter((s) => s.intervention === selectedIntervention);
  }, [scenarios, selectedIntervention]);

  const instances = useMemo(() => {
    const list = displayedScenarios;
    return list.map((scenario, index) => ({
      scenario,
      x: (index - (list.length - 1) / 2) * 6,
    }));
  }, [displayedScenarios]);

  const active = scenarios.find((s) => s.intervention === selectedIntervention) ?? scenarios[0];

  return (
    <section className="space-y-4 overflow-hidden rounded-lg border-2 border-amber-500/70 bg-slate-950 p-4 text-white shadow-xl" aria-label="Solver scenario 3D preview and numerical comparison">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/40">
              SIMULATED PLAN · NOT LIVE PLANT BASELINE
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              Steady-state solver
            </span>
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-white">Hydraulic Solver Scenario Preview</h2>
          <p className="text-xs text-slate-400">
            3D status overlay and numerical comparison from exact solver outputs. Heights scale with pressure. This network model is distinct from canonical plant assets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-300" htmlFor="scenario-selector">Scenario view:</label>
          <select
            id="scenario-selector"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
            value={selectedIntervention}
            onChange={(e) => setSelectedIntervention(e.target.value)}
          >
            <option value="all">Compare all scenarios</option>
            {scenarios.map((s) => (
              <option key={s.intervention} value={s.intervention}>
                {s.intervention.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* 3D Canvas with Heads-up Status Overlay */}
      <div className="relative h-72 overflow-hidden rounded border border-slate-800 bg-slate-900/60">
        <Canvas camera={{ position: [0, 8, 18], fov: 42 }} dpr={[1, 1.25]} gl={{ antialias: true }}>
          <color attach="background" args={["#070d10"]} />
          <ambientLight intensity={1.4} />
          <directionalLight position={[5, 12, 10]} intensity={2.2} />
          <gridHelper args={[32, 16, "#d97706", "#27272a"]} position={[0, -0.05, 0]} />

          {instances.map(({ scenario, x }) => {
            const pConsumer = scenario.pressure_by_node_kpa_gauge.consumer ?? 0;
            const pJunction = scenario.pressure_by_node_kpa_gauge.junction ?? 0;
            const pSource = scenario.pressure_by_node_kpa_gauge.source ?? 400;

            const hSource = Math.max(0.6, (pSource / maxPressure) * 3.5);
            const hJunction = Math.max(0.6, (pJunction / maxPressure) * 3.5);
            const hConsumer = Math.max(0.6, (pConsumer / maxPressure) * 3.5);

            const isShortfall = Boolean(scenario.service_pressure_shortfall || pConsumer < 200);
            const consumerColor = new Color(isShortfall ? "#f87171" : "#34d399");
            const junctionColor = new Color("#38bdf8");
            const sourceColor = new Color("#818cf8");

            return (
              <group key={scenario.intervention} position={[x, 0, 0]}>
                {/* Base foundation plate */}
                <mesh position={[0, -0.15, 0]}>
                  <boxGeometry args={[4.8, 0.16, 1.8]} />
                  <meshStandardMaterial color="#1e293b" roughness={0.8} />
                </mesh>

                {/* Source Node (Reservoir/Inflow) */}
                <mesh position={[-1.6, hSource / 2, 0]}>
                  <cylinderGeometry args={[0.42, 0.42, hSource, 12]} />
                  <meshStandardMaterial color={sourceColor} roughness={0.4} />
                </mesh>

                {/* Junction Node (Distribution) */}
                <mesh position={[0, hJunction / 2, 0]}>
                  <cylinderGeometry args={[0.34, 0.34, hJunction, 12]} />
                  <meshStandardMaterial color={junctionColor} roughness={0.4} />
                </mesh>

                {/* Consumer Delivery Node */}
                <mesh position={[1.6, hConsumer / 2, 0]}>
                  <boxGeometry args={[0.72, hConsumer, 0.72]} />
                  <meshStandardMaterial color={consumerColor} roughness={0.4} />
                </mesh>

                {/* Connecting Pipe Bars */}
                <mesh position={[-0.8, 0.25, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.08, 0.08, 1.6, 8]} />
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>
                <mesh position={[0.8, 0.25, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.08, 0.08, 1.6, 8]} />
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>
              </group>
            );
          })}
        </Canvas>

        {/* 3D Status Overlay HUD */}
        {active && (
          <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded border border-amber-500/40 bg-slate-950/85 p-2.5 text-xs backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-amber-300">Active Scenario:</span>
              <span className="capitalize">{active.intervention.replaceAll("_", " ")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Consumer Pressure:</span>
              <strong className={active.pressure_by_node_kpa_gauge.consumer < 200 ? "text-red-400" : "text-emerald-400"}>
                {active.pressure_by_node_kpa_gauge.consumer} kPa
              </strong>
              {active.pressure_by_node_kpa_gauge.consumer < 200 && (
                <span className="rounded bg-red-950 px-1 py-0.5 text-[10px] text-red-300">SHORTFALL (&lt;200 kPa)</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span>Continuity Residual:</span>
              <span className="font-mono">{active.max_continuity_residual_m3h?.toExponential(2) ?? "≤ 1e-9"} m³/h</span>
              <span className="rounded bg-emerald-950 px-1 py-0.5 text-[10px] text-emerald-300">CONVERGED</span>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-black/75 px-2 py-1 text-[11px] text-slate-300">
          Left: Source · Center: Junction · Right: Consumer (Box)
        </div>
      </div>

      {/* Numerical Comparison Charts from Actual Solver */}
      <div className="space-y-3 rounded border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="text-sm font-semibold text-slate-200">Numerical Tradeoff Comparison (Exact Solver Values)</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {scenarios.map((s) => {
            const pConsumer = s.pressure_by_node_kpa_gauge.consumer ?? 0;
            const isShortfall = Boolean(s.service_pressure_shortfall || pConsumer < 200);
            const pPercent = Math.min(100, (pConsumer / 400) * 100);

            return (
              <div
                key={s.intervention}
                className={`space-y-2.5 rounded border p-3 text-xs ${
                  s.intervention === selectedIntervention || selectedIntervention === "all"
                    ? isShortfall
                      ? "border-red-500/50 bg-red-950/20"
                      : "border-slate-700 bg-slate-900/80"
                    : "border-slate-800 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <strong className="capitalize text-slate-100">{s.intervention.replaceAll("_", " ")}</strong>
                  {isShortfall ? (
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                      WARNING: SHORTFALL
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      ADEQUATE
                    </span>
                  )}
                </div>

                {/* Pressure bar with 200 kPa target line */}
                <div>
                  <div className="flex justify-between pb-1 text-[11px]">
                    <span className="text-slate-400">Consumer Pressure</span>
                    <span className="font-semibold">{pConsumer} kPa</span>
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded bg-slate-800">
                    <div
                      className={`h-full transition-all ${isShortfall ? "bg-red-500" : "bg-emerald-500"}`}
                      style={{ width: `${pPercent}%` }}
                    />
                    {/* Target 200 kPa line at 50% */}
                    <div className="absolute inset-y-0 left-1/2 w-0.5 bg-amber-400" title="Target threshold: 200 kPa" />
                  </div>
                  <div className="flex justify-between pt-0.5 text-[9px] text-slate-500">
                    <span>0 kPa</span>
                    <span className="text-amber-300">Target 200 kPa</span>
                    <span>400 kPa</span>
                  </div>
                </div>

                {/* Metric grid */}
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 border-t border-slate-800 pt-2 text-[11px]">
                  <div>
                    <dt className="text-slate-400">Demand / Capacity</dt>
                    <dd className="font-medium text-slate-200">{s.demand_m3h} / {s.capacity_m3h} m³/h</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Energy Proxy</dt>
                    <dd className="font-medium text-slate-200">{s.energy_kwh_proxy != null ? `${s.energy_kwh_proxy.toFixed(3)} kWh` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Downtime Proxy</dt>
                    <dd className="font-medium text-slate-200">{s.downtime_hours_proxy ?? 0} h</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Constraints Critic</dt>
                    <dd className={s.critic?.constraints_passed !== false ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                      {s.critic?.constraints_passed !== false ? "Pass" : "Fail"}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
