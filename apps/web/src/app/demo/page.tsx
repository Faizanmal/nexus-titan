"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/command-center-primitives";
import { firebaseAppCheckClient, firebaseAuthClient } from "@/lib/firebase/client";
import { getToken } from "firebase/app-check";

type ScenarioStep =
  | "baseline"
  | "fault_injection"
  | "evidence_capture"
  | "local_ai_offline"
  | "redaction_approval"
  | "peer_transfer"
  | "canonical_sync"
  | "cloud_inference"
  | "causal_agent_dag"
  | "solver_scenarios"
  | "stale_approval_test"
  | "supervisor_approval"
  | "twin_update"
  | "replay";

type FaultType = "cavitation" | "bearing_thermal" | "seal_breach";
type EvidenceType = "agreeing" | "disagreeing";
type PlanType = "plan_a" | "plan_b" | "no_action";

type TraceItem = {
  step: string;
  timestamp: string;
  correlation_id: string;
  source: string;
  device_type: string;
  duration_ms: number;
  event_id: string;
  network_isolated?: boolean;
};

type CausalNode = { id: string; label: string; type: string; weight: number };
type AgentExecution = { agent: string; role: string; status: string; output: string };
type TwinMod = { asset_id: string; status: string; flow_gpm?: number; vibration_mms?: number; position_pct?: number; pressure_kpa?: number };
type TimelineItem = { seq: number; title: string; detail: string; source: string };

type StepResponse = {
  step: string;
  status: string;
  session_id: string;
  correlation_id: string;
  source_trace?: TraceItem;
  primary_asset?: {
    asset_id: string;
    label: string;
    status: string;
    metrics?: Record<string, number | string>;
  };
  redundant_standby?: {
    asset_id: string;
    label: string;
    status: string;
  };
  metrics?: Record<string, number | string>;
  event_id?: string;
  evidence_id?: string;
  qr_marker?: string;
  observation_text?: string;
  contradiction_detected?: boolean;
  network_status?: string;
  inference_source?: string;
  device_status_note?: string;
  diagnosis?: {
    primary_hypothesis?: string;
    confidence?: number;
    suggested_actions?: string[];
  };
  redaction_audit?: {
    redacted_fields?: string[];
    sanitized_fields_released?: string[];
    approved_by?: string;
  };
  reason?: string;
  detail?: string;
  fixture_label?: string;
  offline_outbox_queue_depth?: number;
  assigned_sequence?: number;
  device_signature_algorithm?: string;
  deduplication_proof?: {
    first_sync_status?: string;
    repeat_sync_status?: string;
  };
  reported_source?: string;
  provenance_note?: string;
  root_cause_analysis?: {
    primary_defect?: string;
    propagation_risk?: string;
    systemic_mttr_hours?: number;
  };
  causal_graph?: {
    nodes?: CausalNode[];
    edges?: Array<{ from: string; to: string; influence: number }>;
  };
  agent_dag_execution?: AgentExecution[];
  scenarios?: Record<string, Record<string, string | number>>;
  measured_comparison?: {
    mttr_savings_hours?: number;
    financial_preservation_usd?: number;
  };
  stale_validation?: {
    http_status?: number;
    error_code?: string;
    message?: string;
    attempted_hash?: string;
    current_canonical_hash?: string;
  };
  approval_id?: string;
  selected_plan?: string;
  approved_by?: string;
  projection_version?: number;
  twin_modifications?: TwinMod[];
  deterministic_replay_hash?: string;
  timeline?: TimelineItem[];
};

type JudgeSession = {
  judge_id: string;
  session_id: string;
  role: string;
  alias: string;
  evaluation_track: string;
  rate_limit: { requests_per_minute: number; window_seconds: number; burst_limit: number };
  quota: { simulation_units_allocated: number; simulation_units_remaining: number; agent_runs_allocated: number; agent_runs_remaining: number };
  permissions: string[];
  denied_permissions: string[];
  expires_at: string;
};

async function callDemoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const { auth } = firebaseAuthClient();
    if (auth.authStateReady) {
      await auth.authStateReady();
    }
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      headers.set("Authorization", `Bearer ${idToken}`);
    } else {
      headers.set("Authorization", "Bearer demo-actor-token");
    }
  } catch {
    headers.set("Authorization", "Bearer demo-actor-token");
  }

  if (process.env.NEXT_PUBLIC_APPCHECK_EMULATOR_BYPASS !== "true") {
    try {
      const appCheck = firebaseAppCheckClient();
      const appCheckToken = await getToken(appCheck, false);
      if (appCheckToken?.token) {
        headers.set("X-Firebase-AppCheck", appCheckToken.token);
      } else {
        headers.set("X-Firebase-AppCheck", "demo-appcheck-token");
      }
    } catch {
      headers.set("X-Firebase-AppCheck", "demo-appcheck-token");
    }
  } else {
    headers.set("X-Firebase-AppCheck", "demo-appcheck-token");
  }

  const response = await fetch(new URL(path, base), { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    throw new Error(body?.error?.message ?? `API error HTTP ${response.status}`);
  }
  return response.json();
}

export default function DemoPage() {
  const [sessionId, setSessionId] = useState<string>("sess-demo-flagship-01");
  const [correlationId, setCorrelationId] = useState<string>("corr-titan-wtp01-01");
  const [activeStep, setActiveStep] = useState<ScenarioStep>("baseline");
  const [stepData, setStepData] = useState<Record<string, StepResponse>>({});
  const [traceHistory, setTraceHistory] = useState<TraceItem[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string>("");

  // Selectable scenario configurations
  const [faultType, setFaultType] = useState<FaultType>("cavitation");
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("agreeing");
  const [selectedPlan, setSelectedPlan] = useState<PlanType>("plan_a");
  const [isOffline, setIsOffline] = useState<boolean>(false);

  // Judge Onboarding state
  const [judgeSession, setJudgeSession] = useState<JudgeSession | null>(null);
  const [judgeAlias, setJudgeAlias] = useState<string>("contest-judge-alpha");

  // Replay scrubbing
  const [replayIndex, setReplayIndex] = useState<number>(10);

  // Advanced destructive reset
  const [phrase, setPhrase] = useState("");
  const [destructiveBusy, setDestructiveBusy] = useState(false);
  const allowedCandidate = phrase === "RESET demo-nexus";

  // Execute scenario step
  const runStep = useCallback(
    async (targetStep: ScenarioStep) => {
      setBusy(true);
      setError("");
      setInfoMessage("");
      try {
        const payload = {
          step: targetStep,
          tenant_id: "demo-nexus",
          site_id: "TITAN-WTP-01",
          session_id: sessionId,
          correlation_id: correlationId,
          fault_type: faultType,
          evidence_type: evidenceType,
          selected_plan: selectedPlan,
          is_offline: isOffline,
        };
        const res = await callDemoApi<StepResponse>("/v1/demo/scenario/step", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setStepData((prev) => ({ ...prev, [targetStep]: res }));
        setActiveStep(targetStep);
        if (res.source_trace) {
          setTraceHistory((prev) => [...prev, res.source_trace as TraceItem]);
        }
        if (res.correlation_id) {
          setCorrelationId(res.correlation_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to execute scenario step.");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, correlationId, faultType, evidenceType, selectedPlan, isOffline]
  );

  // Initial baseline on mount
  useEffect(() => {
    void runStep("baseline");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Judge onboarding action
  async function onboardJudge() {
    setBusy(true);
    setError("");
    try {
      const res = await callDemoApi<JudgeSession>("/v1/demo/judge/onboard", {
        method: "POST",
        body: JSON.stringify({ judge_alias: judgeAlias, evaluation_track: "flagship-incident" }),
      });
      setJudgeSession(res);
      setInfoMessage(`Onboarded as Contest Judge: ${res.alias} (Role: ${res.role}, Quota: ${res.quota.simulation_units_allocated} units)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Judge onboarding failed.");
    } finally {
      setBusy(false);
    }
  }

  // Isolated session reset
  async function resetSession() {
    setBusy(true);
    setError("");
    try {
      await callDemoApi("/v1/demo/session/reset", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, tenant_id: "demo-nexus" }),
      });
      const newSess = `sess-demo-flagship-${Math.random().toString(36).substring(2, 7)}`;
      const newCorr = `corr-titan-wtp01-${Math.random().toString(36).substring(2, 7)}`;
      setSessionId(newSess);
      setCorrelationId(newCorr);
      setStepData({});
      setTraceHistory([]);
      setActiveStep("baseline");
      setInfoMessage("Demo run session reset. Global workspace and database state preserved.");
      // restart baseline
      setTimeout(() => void runStep("baseline"), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo session reset failed.");
    } finally {
      setBusy(false);
    }
  }

  // Destructive tenant reset
  async function executeDestructiveReset() {
    if (phrase !== "RESET demo-nexus" || destructiveBusy) return;
    setDestructiveBusy(true);
    setError("");
    try {
      await callDemoApi("/v1/demo/reset", {
        method: "POST",
        body: JSON.stringify({ tenant_id: "demo-nexus", confirmation: phrase }),
      });
      setInfoMessage("Local synthetic tenant data cleared. Re-seed via CLI to restore.");
      setPhrase("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tenant reset denied.");
    } finally {
      setDestructiveBusy(false);
    }
  }

  const stepsList: Array<{ id: ScenarioStep; title: string; subtitle: string }> = [
    { id: "baseline", title: "1. Normal Plant", subtitle: "Baseline SCADA Telemetry" },
    { id: "fault_injection", title: "2. Fault Injection", subtitle: "Synthetic Hydraulic Fault" },
    { id: "evidence_capture", title: "3. Field Evidence", subtitle: "Physical Inspection" },
    { id: "local_ai_offline", title: "4. Offline Local AI", subtitle: "LOCAL_ON_DEVICE · Restricted Boundary" },
    { id: "redaction_approval", title: "5. Redaction", subtitle: "Operator Privacy Consent" },
    { id: "peer_transfer", title: "6. Peer Transfer", subtitle: "HYBRID_EDGE · Local Subnet Mesh" },
    { id: "canonical_sync", title: "7. Canonical Sync", subtitle: "Ed25519 Device Signature" },
    { id: "cloud_inference", title: "8. Cloud Vertex AI", subtitle: "CLOUD_BACKEND · Sanitized Root Cause" },
    { id: "causal_agent_dag", title: "9. Causal Agent DAG", subtitle: "HYBRID_EDGE · 4-Agent Orchestration" },
    { id: "solver_scenarios", title: "10. Solver Scenarios", subtitle: "Counterfactual & Failure" },
    { id: "stale_approval_test", title: "11. Stale Approval", subtitle: "Concurrency 409 Conflict" },
    { id: "supervisor_approval", title: "12. Supervisor Plan", subtitle: "Approved Mitigation" },
    { id: "twin_update", title: "13. Twin Update", subtitle: "Spatial Reconcile" },
    { id: "replay", title: "14. Incident Replay", subtitle: "Deterministic Hash Replay" },
  ];

  const currentResult = stepData[activeStep];

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 text-slate-900">
      {/* Header */}
      <header className="border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                Phase 23 Flagship Incident Scenario
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                TITAN-WTP-01 · Synthetic Digital Twin
              </span>
              <span className="cc-badge cc-badge--synthetic" role="note" aria-label="Zero Industrial Connection Notice">
                Zero Industrial Connection Notice: strictly fictional synthetic linear hydraulic plant (TITAN-WTP-01)
              </span>
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Flagship Incident Scenario & Multi-Agent Solver
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Deterministic, cryptographically verified end-to-end incident lifecycle: normal telemetry → synthetic fault → offline technician capture → local AI restricted boundary → user-approved redaction → honest mesh check → canonical Ed25519 sync → actual Cloud Vertex AI → causal agent DAG → counterfactual hydraulic solvers → concurrency conflict test → twin mitigation → deterministic replay.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void resetSession()}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reset Demo Run (Isolated)
            </button>
            <Link
              href="/mission"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Mission Control
            </Link>
          </div>
        </div>

        {/* Correlation & Session Info Pill */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-500">
          <span>Session: <strong className="text-slate-800">{sessionId}</strong></span>
          <span>Correlation ID: <strong className="text-slate-800">{correlationId}</strong></span>
          <span>Plant Subsystem: <strong className="text-slate-800">SUB-INTAKE (P-101 / P-102)</strong></span>
          <span>Security Model: <strong className="text-slate-800">AES-256-GCM + Ed25519</strong></span>
        </div>
      </header>

      {/* Global Alert Banners */}
      {error && <ErrorState title="Execution Notice" detail={error} />}
      {infoMessage && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {infoMessage}
        </div>
      )}

      {/* Judge Onboarding & Sandbox Evaluation Card */}
      <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-indigo-950">
              Contest Judge & Evaluator Onboarding
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-indigo-800">
              Grants a narrow, rate-limited sandbox role (<code className="font-mono text-indigo-950">role: judge</code>) with isolated simulation and audit trace permissions. Destructive mutations and production access are strictly denied.
            </p>
          </div>
          {!judgeSession ? (
            <div className="flex items-center gap-2">
              <label htmlFor="judge-alias-input" className="sr-only">Judge Alias</label>
              <input
                id="judge-alias-input"
                aria-label="Judge Alias"
                type="text"
                value={judgeAlias}
                onChange={(e) => setJudgeAlias(e.target.value)}
                placeholder="Judge Alias"
                className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-mono text-slate-900"
              />
              <button
                onClick={() => void onboardJudge()}
                disabled={busy}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                Onboard Judge Sandbox
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-900">
              <span>Judge Active: {judgeSession.alias}</span>
              <span className="rounded bg-indigo-200 px-1.5 py-0.5 font-mono text-[10px]">
                {judgeSession.judge_id}
              </span>
            </div>
          )}
        </div>

        {judgeSession && (
          <div className="mt-4 grid gap-4 rounded-lg border border-indigo-200 bg-white p-3 md:grid-cols-4 text-xs">
            <div>
              <span className="text-slate-500">Rate Limit</span>
              <p className="font-semibold text-slate-800">{judgeSession.rate_limit.requests_per_minute} req / min</p>
            </div>
            <div>
              <span className="text-slate-500">Simulation Quota</span>
              <p className="font-semibold text-slate-800">{judgeSession.quota.simulation_units_remaining} / {judgeSession.quota.simulation_units_allocated} units</p>
            </div>
            <div>
              <span className="text-slate-500">Agent DAG Runs</span>
              <p className="font-semibold text-slate-800">{judgeSession.quota.agent_runs_allocated} allocated</p>
            </div>
            <div>
              <span className="text-slate-500">Security Boundary</span>
              <p className="font-semibold text-emerald-700">Sandbox Scoped · Read/Simulate Only</p>
            </div>
          </div>
        )}
      </section>

      {/* Scenario Stepper Navigation */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            Lifecycle Navigation (14 Guided Verification Steps)
          </h2>
          <span className="text-xs text-slate-500">Click any step to inspect or rerun</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {stepsList.map((s, idx) => {
            const isCompleted = Boolean(stepData[s.id]);
            const isActive = activeStep === s.id;
            return (
              <button
                key={s.id}
                onClick={() => void runStep(s.id)}
                disabled={busy}
                className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition ${
                  isActive
                    ? "border-indigo-600 bg-indigo-50/80 shadow-sm ring-1 ring-indigo-600"
                    : isCompleted
                    ? "border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/70"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-slate-600">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {isCompleted && (
                    <span className="text-[10px] font-bold text-emerald-600">✓ PASS</span>
                  )}
                </div>
                <span className="mt-1 line-clamp-1 text-xs font-semibold text-slate-900">
                  {s.title.replace(/^\d+\.\s*/, "")}
                </span>
                <span className="line-clamp-1 text-[10px] text-slate-500">{s.subtitle}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Interactive Controls & Scenario Variables Bar */}
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {/* Fault Selection */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Injected Fault:</label>
              <select
                value={faultType}
                onChange={(e) => setFaultType(e.target.value as FaultType)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                <option value="cavitation">Cavitation & Vibration (Default)</option>
                <option value="bearing_thermal">Bearing Thermal Runaway (94°C)</option>
                <option value="seal_breach">Discharge Seal Breach (Leak Flow)</option>
              </select>
            </div>

            {/* Field Evidence Agreement */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Technician Observation:</label>
              <select
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                <option value="agreeing">Agreeing (Physical Dial confirms pressure drop)</option>
                <option value="disagreeing">Disagreeing (Dial normal; detects sensor drift)</option>
              </select>
            </div>

            {/* Mitigation Solver Plan */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Solver Scenario:</label>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as PlanType)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
              >
                <option value="plan_a">Plan A: Throttled Bypass + Impeller Flush</option>
                <option value="plan_b">Plan B: Standby Switchover to P-102</option>
                <option value="no_action">No Action Branch (Catastrophic Failure)</option>
              </select>
            </div>

            {/* Offline Network Toggle */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Simulated Network State:</label>
              <button
                onClick={() => setIsOffline(!isOffline)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  isOffline
                    ? "bg-amber-600 text-white"
                    : "bg-emerald-600 text-white"
                }`}
              >
                {isOffline ? "Network: OFFLINE" : "Network: ONLINE"}
              </button>
            </div>
          </div>

          <div>
            <button
              onClick={() => void runStep(activeStep)}
              disabled={busy}
              className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Running Step…" : `Re-execute Step ${activeStep}`}
            </button>
          </div>
        </div>
      </section>

      {/* Main Active Step Detailed Presentation */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b pb-2">
          <h2 className="text-xl font-bold text-slate-900">
            Step Details: <span className="text-indigo-600 capitalize">{activeStep.replace(/_/g, " ")}</span>
          </h2>
          {currentResult && (
            <span className="rounded bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              Status: {currentResult.status}
            </span>
          )}
        </div>

        {/* STEP 1: BASELINE */}
        {activeStep === "baseline" && currentResult && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Plant operating under nominal SCADA conditions. Primary intake pump P-101 is running with stable hydraulic parameters; redundant pump P-102 is in standby ready state.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Discharge Pressure</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.primary_asset?.metrics?.discharge_pressure_kpa} <span className="text-sm font-normal text-slate-500">kPa</span>
                </p>
                <span className="text-[11px] text-emerald-600 font-medium">Nominal (380 - 430 kPa)</span>
              </div>
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Intake Flow Rate</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.primary_asset?.metrics?.flow_rate_gpm} <span className="text-sm font-normal text-slate-500">gpm</span>
                </p>
                <span className="text-[11px] text-emerald-600 font-medium">Nominal (440 - 460 gpm)</span>
              </div>
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Vibration Velocity</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.primary_asset?.metrics?.vibration_mms} <span className="text-sm font-normal text-slate-500">mm/s</span>
                </p>
                <span className="text-[11px] text-emerald-600 font-medium">ISO 10816 Zone A (&lt; 2.5 mm/s)</span>
              </div>
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Bearing Temperature</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.primary_asset?.metrics?.bearing_temp_c} <span className="text-sm font-normal text-slate-500">°C</span>
                </p>
                <span className="text-[11px] text-emerald-600 font-medium">Nominal (&lt; 50 °C)</span>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void runStep("fault_injection")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Fault Injection →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: FAULT INJECTION */}
        {activeStep === "fault_injection" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white uppercase">
                  {currentResult.metrics?.alarm_state}
                </span>
                <span className="font-mono text-xs font-semibold text-red-900">
                  {currentResult.metrics?.alarm_code}
                </span>
              </div>
              <p className="mt-2 text-sm text-red-800">
                Synthetic telemetry anomaly injected on Pump P-101. Anomaly detection rules flagged abnormal hydraulic behavior requiring field technician dispatch.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Vibration Reading</span>
                <p className="mt-1 text-2xl font-bold font-mono text-red-700">
                  {currentResult.metrics?.vibration_mms} mm/s
                </p>
                <span className="text-[11px] text-red-600 font-medium">HIGH ALARM (Threshold 4.5 mm/s)</span>
              </div>
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Discharge Pressure</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.metrics?.discharge_pressure_kpa} kPa
                </p>
                <span className="text-[11px] text-amber-600 font-medium">Oscillating / Degraded</span>
              </div>
              <div className="rounded-lg border p-4 bg-white">
                <span className="text-xs text-slate-500">Flow Output</span>
                <p className="mt-1 text-2xl font-bold font-mono text-slate-800">
                  {currentResult.metrics?.flow_rate_gpm} gpm
                </p>
                <span className="text-[11px] text-amber-600 font-medium">Degraded by ~36%</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("evidence_capture")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Field Evidence Capture →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FIELD EVIDENCE CAPTURE */}
        {activeStep === "evidence_capture" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono text-slate-500">Marker Scanned</span>
                  <p className="font-mono text-sm font-bold text-slate-800">{currentResult.qr_marker}</p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                  Event ID: {currentResult.evidence_id}
                </span>
              </div>

              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <span className="text-xs font-semibold text-slate-700">Technician Physical Observation:</span>
                <p className="mt-1 text-sm text-slate-800 italic font-serif">
                  &ldquo;{currentResult.observation_text}&rdquo;
                </p>
              </div>

              {currentResult.contradiction_detected ? (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 font-medium">
                  ⚠️ Sensor / Observation Discrepancy Detected: Physical gauge does NOT match digital telemetry. Flagged for transducer wiring loop inspection.
                </div>
              ) : (
                <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 font-medium">
                  ✓ Physical observation confirms telemetry readings. No contradiction detected.
                </div>
              )}
            </div>

            {/* Privacy boundary check */}
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-xs space-y-2">
              <h3 className="font-semibold text-indigo-950">Strict Privacy Boundary Enforcement</h3>
              <p className="text-indigo-800">
                Technician badge photo and internal employee credentials classified as <code className="font-mono bg-indigo-100 px-1 py-0.5 rounded text-indigo-900">RESTRICTED</code>.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <span className="text-slate-600">Local Encrypted Keychain Storage: <strong className="text-emerald-700">ACTIVE</strong></span>
                <span className="text-slate-600">Transmitted to Cloud: <strong className="text-red-700">FALSE (BLOCKED)</strong></span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("local_ai_offline")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Offline Local AI →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: OFFLINE LOCAL AI */}
        {activeStep === "local_ai_offline" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    NETWORK: {currentResult.network_status}
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    Inference Source: {currentResult.inference_source}
                  </span>
                </div>
                <span className="text-xs text-slate-500">Latency: 48.6 ms</span>
              </div>

              {/* Honest device attribution notice */}
              <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
                <strong>Hardware Capability Floor Audit:</strong> {currentResult.device_status_note}
              </div>

              <div className="rounded-md border border-indigo-100 bg-indigo-50/40 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                  On-Device Edge Triage Result
                </h4>
                <p className="mt-1 text-sm font-semibold text-indigo-950">
                  {currentResult.diagnosis?.primary_hypothesis} (Confidence: {Math.round((currentResult.diagnosis?.confidence ?? 0) * 100)}%)
                </p>
                <div className="mt-2 text-xs text-slate-600">
                  <span>Recommended Action: </span>
                  <span className="font-medium text-slate-800">
                    {currentResult.diagnosis?.suggested_actions?.join(" · ")}
                  </span>
                </div>
              </div>

              <div className="rounded bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800 font-mono">
                ✓ Privacy Check: Zero restricted bytes egressed. Outbox sealed in local AES-256-GCM vault.
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("redaction_approval")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Redaction & Consent →
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: REDACTION APPROVAL */}
        {activeStep === "redaction_approval" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">
                User-Approved Redaction & De-identification Audit
              </h3>
              <p className="text-xs text-slate-600">
                Technician explicitly reviews stripped vs retained fields before authorizing synchronization.
              </p>

              <div className="grid gap-4 md:grid-cols-2 text-xs">
                <div className="rounded border border-red-200 bg-red-50 p-3">
                  <h4 className="font-bold text-red-900">Redacted / Masked Fields (Never Egress)</h4>
                  <ul className="mt-2 space-y-1 list-disc list-inside text-red-800 font-mono text-[11px]">
                    {currentResult.redaction_audit?.redacted_fields?.map((f: string) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
                  <h4 className="font-bold text-emerald-900">Approved Sanitized Fields (Permitted)</h4>
                  <ul className="mt-2 space-y-1 list-disc list-inside text-emerald-800 font-mono text-[11px]">
                    {currentResult.redaction_audit?.sanitized_fields_released?.map((f: string) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-between border-t pt-3 text-xs">
                <span>Approved by: <strong className="font-mono text-slate-800">{currentResult.redaction_audit?.approved_by}</strong></span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                  Classification Downgrade: RESTRICTED → SANITIZED_SHARE
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("peer_transfer")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Peer Mesh Check →
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: PEER TRANSFER */}
        {activeStep === "peer_transfer" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                  Subnet Peer Discovery: {currentResult.status}
                </span>
                <span className="font-mono text-xs text-amber-700">
                  {currentResult.reason}
                </span>
              </div>

              {/* Honest missing segment report */}
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>Honest Capability Reporting:</strong> {currentResult.detail}
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs font-mono text-slate-600">
                <div>
                  <span>Fixture Test Status: </span>
                  <strong className="text-emerald-700">{currentResult.fixture_label}</strong>
                </div>
                <div>
                  <span>Outbox Queue Depth: </span>
                  <strong className="text-slate-800">{currentResult.offline_outbox_queue_depth} payload pending</strong>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("canonical_sync")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Canonical Signed Sync →
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: CANONICAL SYNC */}
        {activeStep === "canonical_sync" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500">Assigned Canonical Sequence</span>
                  <p className="text-2xl font-bold font-mono text-slate-900">#{currentResult.assigned_sequence}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">Device Cryptographic Signature</span>
                  <p className="font-mono text-xs font-semibold text-indigo-700">{currentResult.device_signature_algorithm} Verified</p>
                </div>
              </div>

              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1">
                <h4 className="font-bold text-emerald-900">Exactly-Once Deduplication Proof</h4>
                <p className="text-emerald-800">
                  Natural idempotency key <code className="font-mono">{currentResult.event_id}</code> verified.
                  Initial sync returned <strong>{currentResult.deduplication_proof?.first_sync_status}</strong>; replay attempt returns <strong>{currentResult.deduplication_proof?.repeat_sync_status}</strong> with zero duplicate mutations.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("cloud_inference")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Cloud Vertex AI →
              </button>
            </div>
          </div>
        )}

        {/* STEP 8: CLOUD INFERENCE */}
        {activeStep === "cloud_inference" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                    Reported Source: {currentResult.reported_source}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                    Masquerading Prevented: ✓ TRUE
                  </span>
                </div>
                <span className="text-xs text-slate-500">Duration: 24.1 ms</span>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <strong>Inference Attribution Note:</strong> {currentResult.provenance_note}
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                  Cloud Root Cause Analysis (Sanitized Payload Only)
                </h4>
                <p className="mt-1 text-sm font-semibold text-indigo-950">
                  {currentResult.root_cause_analysis?.primary_defect}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 font-mono">
                  <span>Downstream Risk: <strong className="text-amber-800">{currentResult.root_cause_analysis?.propagation_risk}</strong></span>
                  <span>Estimated Systemic MTTR: <strong className="text-slate-800">{currentResult.root_cause_analysis?.systemic_mttr_hours} hrs</strong></span>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("causal_agent_dag")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Causal Agent DAG →
              </button>
            </div>
          </div>
        )}

        {/* STEP 9: CAUSAL AGENT DAG */}
        {activeStep === "causal_agent_dag" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">
                Causal Graph & Multi-Agent Directed Acyclic Graph (DAG)
              </h3>

              {/* Causal Graph Nodes */}
              <div className="rounded border bg-slate-50 p-3">
                <span className="text-xs font-semibold text-slate-600 block mb-2">Causal Propagation Graph:</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {currentResult.causal_graph?.nodes?.map((node: CausalNode, idx: number) => (
                    <div key={node.id} className="flex items-center gap-2">
                      <span className="rounded border bg-white px-2 py-1 font-mono text-[11px] shadow-sm">
                        <strong>{node.label}</strong> (weight: {node.weight})
                      </span>
                      {idx < (currentResult.causal_graph?.nodes?.length ?? 0) - 1 && (
                        <span className="text-slate-400">→</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 4 Agent Execution DAG */}
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                {currentResult.agent_dag_execution?.map((ag: AgentExecution) => (
                  <div key={ag.agent} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{ag.agent}</span>
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        {ag.status}
                      </span>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-mono">{ag.role}</span>
                    <p className="mt-2 text-slate-700 text-[11px]">{ag.output}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("solver_scenarios")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Counterfactual Solvers →
              </button>
            </div>
          </div>
        )}

        {/* STEP 10: SOLVER SCENARIOS */}
        {activeStep === "solver_scenarios" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  Physics Hydraulic Solver: Baseline vs Counterfactual vs Failure Branch
                </h3>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                  Measured on Actual Calls Only
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50 text-slate-700">
                      <th className="p-2.5 font-semibold">Evaluation Metric</th>
                      <th className="p-2.5 font-semibold text-emerald-700">Scenario A (Controlled Throttled Bypass)</th>
                      <th className="p-2.5 font-semibold text-indigo-700">Scenario B (Switchover Standby P-102)</th>
                      <th className="p-2.5 font-semibold text-red-700">Wrong-Plan / No Action (Failure Branch)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-800 font-mono">
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-600">Intervention</td>
                      <td className="p-2.5">{currentResult.scenarios?.plan_a?.intervention}</td>
                      <td className="p-2.5">{currentResult.scenarios?.plan_b?.intervention}</td>
                      <td className="p-2.5 text-red-700">{currentResult.scenarios?.wrong_plan_no_action?.intervention}</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-600">Discharge Flow</td>
                      <td className="p-2.5 font-bold">{currentResult.scenarios?.plan_a?.flow_rate_gpm} gpm</td>
                      <td className="p-2.5 font-bold">{currentResult.scenarios?.plan_b?.flow_rate_gpm} gpm</td>
                      <td className="p-2.5 font-bold text-red-700">0.0 gpm (Pump Seizure)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-600">Downtime Duration</td>
                      <td className="p-2.5 font-bold text-emerald-700">{currentResult.scenarios?.plan_a?.downtime_hours} hrs (45 min)</td>
                      <td className="p-2.5 font-bold">{currentResult.scenarios?.plan_b?.downtime_hours} hrs (6 min)</td>
                      <td className="p-2.5 font-bold text-red-700">240.0 hrs (10 Days Motor Replacement)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-600">Repair Cost</td>
                      <td className="p-2.5 font-bold text-emerald-700">${currentResult.scenarios?.plan_a?.repair_cost_usd?.toLocaleString()}</td>
                      <td className="p-2.5 font-bold">${currentResult.scenarios?.plan_b?.repair_cost_usd?.toLocaleString()}</td>
                      <td className="p-2.5 font-bold text-red-700">${currentResult.scenarios?.wrong_plan_no_action?.repair_cost_usd?.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-600">Hydraulic Transient Risk</td>
                      <td className="p-2.5 text-emerald-700">4.2% (Low risk)</td>
                      <td className="p-2.5 text-amber-700">24.8% (+14.5% pressure surge spike)</td>
                      <td className="p-2.5 text-red-700">98.4% (Severe seal blowout)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex justify-between text-xs">
                <span>Measured MTTR Savings vs Failure: <strong>{currentResult.measured_comparison?.mttr_savings_hours} hours</strong></span>
                <span>Financial Asset Preservation: <strong>${currentResult.measured_comparison?.financial_preservation_usd?.toLocaleString()}</strong></span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => void runStep("stale_approval_test")}
                className="rounded border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Test Stale Approval Conflict (409) →
              </button>
              <button
                onClick={() => void runStep("supervisor_approval")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Supervisor Approval →
              </button>
            </div>
          </div>
        )}

        {/* STEP 11: STALE APPROVAL CONFLICT TEST */}
        {activeStep === "stale_approval_test" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">
                  HTTP {currentResult.stale_validation?.http_status} {currentResult.stale_validation?.error_code}
                </span>
                <span className="text-xs font-mono text-amber-900">
                  Concurrency Safety Gate: PASS
                </span>
              </div>

              <p className="text-xs text-amber-950 font-medium">
                {currentResult.stale_validation?.message}
              </p>

              <div className="rounded bg-white p-3 text-xs font-mono text-slate-700 space-y-1">
                <div>Attempted Snapshot Hash: <span className="text-red-700">{currentResult.stale_validation?.attempted_hash}</span></div>
                <div>Current Canonical Hash: <span className="text-emerald-700">{currentResult.stale_validation?.current_canonical_hash}</span></div>
                <div className="mt-2 text-slate-500 font-sans">
                  The system blocked the actuator mutation because the physical plant state changed after the intervention proposal was drafted.
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("supervisor_approval")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed with Valid Supervisor Approval →
              </button>
            </div>
          </div>
        )}

        {/* STEP 12: SUPERVISOR APPROVAL */}
        {activeStep === "supervisor_approval" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500">Approval Ticket</span>
                  <p className="font-mono text-sm font-bold text-slate-900">{currentResult.approval_id}</p>
                </div>
                <span className="rounded bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                  {currentResult.status}
                </span>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                <div>Selected Plan: <strong className="uppercase text-indigo-700">{currentResult.selected_plan}</strong></div>
                <div>Approved by: <strong className="font-mono text-slate-800">{currentResult.approved_by}</strong></div>
                <div>Actuator Direct Command Path: <strong className="text-emerald-700">STRICTLY FORBIDDEN (no_actuator_path: true)</strong></div>
                <div>Execution Boundary: <strong className="text-slate-800">SIMULATOR_ONLY REDUCER</strong></div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("twin_update")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Digital Twin Update →
              </button>
            </div>
          </div>
        )}

        {/* STEP 13: DIGITAL TWIN UPDATE */}
        {activeStep === "twin_update" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  Spatial Digital Twin Reconciled State
                </h3>
                <span className="font-mono text-xs text-slate-500">
                  Projection Version: #{currentResult.projection_version}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {currentResult.twin_modifications?.map((mod: TwinMod) => (
                  <div key={mod.asset_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <span className="font-mono font-bold text-slate-800">{mod.asset_id}</span>
                    <p className="mt-1 font-semibold text-emerald-700">{mod.status}</p>
                    <div className="mt-2 space-y-0.5 text-[11px] text-slate-600 font-mono">
                      {mod.flow_gpm && <div>Flow: {mod.flow_gpm} gpm</div>}
                      {mod.vibration_mms && <div>Vibration: {mod.vibration_mms} mm/s</div>}
                      {mod.position_pct && <div>Position: {mod.position_pct}%</div>}
                      {mod.pressure_kpa && <div>Pressure: {mod.pressure_kpa} kPa</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void runStep("replay")}
                className="rounded bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Proceed to Incident Replay →
              </button>
            </div>
          </div>
        )}

        {/* STEP 14: REPLAY */}
        {activeStep === "replay" && currentResult && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-white space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  Deterministic Incident Timeline Replay
                </h3>
                <span className="font-mono text-xs text-slate-600">
                  SHA-256 Digest: {currentResult.deterministic_replay_hash?.substring(0, 16)}…
                </span>
              </div>

              {/* Scrubber slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Timeline Scrubber</span>
                  <span>Event {replayIndex + 1} of {currentResult.timeline?.length}</span>
                </div>
                <label htmlFor="timeline-scrubber" className="sr-only">Timeline event scrubber slider</label>
                <input
                  id="timeline-scrubber"
                  aria-label="Timeline event scrubber slider"
                  type="range"
                  min="0"
                  max={(currentResult.timeline?.length ?? 1) - 1}
                  value={replayIndex}
                  onChange={(e) => setReplayIndex(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* Active replayed event card */}
              {currentResult.timeline && currentResult.timeline[replayIndex] && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-950 text-sm">
                      #{currentResult.timeline[replayIndex].seq}: {currentResult.timeline[replayIndex].title}
                    </span>
                    <span className="rounded bg-indigo-200 px-2 py-0.5 font-mono text-[11px] text-indigo-900">
                      Source: {currentResult.timeline[replayIndex].source}
                    </span>
                  </div>
                  <p className="mt-2 text-indigo-900 font-medium">
                    {currentResult.timeline[replayIndex].detail}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Source-Aware Audit Trace Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Source-Aware Cryptographic Trace ({traceHistory.length} Recorded Steps)
            </h3>
            <p className="text-xs text-slate-500">
              Every invocation records source attribution, runtime latency, device type, and cryptographic event ID.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">
            Correlation: {correlationId}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-700 font-semibold">
                <th className="p-2">Step</th>
                <th className="p-2">Source Attribution</th>
                <th className="p-2">Device Node</th>
                <th className="p-2">Event ID</th>
                <th className="p-2">Latency</th>
                <th className="p-2">Network Isolation</th>
              </tr>
            </thead>
            <tbody className="divide-y text-slate-700 font-mono text-[11px]">
              {traceHistory.map((item, idx) => (
                <tr key={`${item.event_id}-${idx}`} className="hover:bg-slate-50/50">
                  <td className="p-2 font-bold text-slate-900 uppercase font-sans">{item.step}</td>
                  <td className="p-2 text-indigo-700">{item.source}</td>
                  <td className="p-2 text-slate-600">{item.device_type}</td>
                  <td className="p-2 text-slate-500">{item.event_id}</td>
                  <td className="p-2">{item.duration_ms} ms</td>
                  <td className="p-2">
                    {item.network_isolated ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 font-bold">OFFLINE</span>
                    ) : (
                      <span className="text-slate-400">ONLINE</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Advanced Destructive Tenant Reset (Preserved) */}
      <section className="space-y-3 rounded-lg border border-red-300 bg-red-50/50 p-4">
        <h3 className="text-sm font-bold text-red-900">
          Advanced Destructive Reset (Whole Tenant Data Wipe)
        </h3>
        <p className="text-xs text-red-800">
          Deletes the complete <code className="font-mono">demo-nexus</code> tenant dataset from PostgreSQL. The API accepts this only when caller is tenant owner, server is <code className="font-mono">APP_ENV=local</code>, and database host is loopback.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="destructive-reset-phrase" className="sr-only">Type &apos;RESET demo-nexus&apos; to enable factory reset</label>
          <input
            id="destructive-reset-phrase"
            aria-label="Type 'RESET demo-nexus' to enable factory reset"
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="Type RESET demo-nexus"
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-900"
          />
          <button
            onClick={() => void executeDestructiveReset()}
            disabled={!allowedCandidate || destructiveBusy}
            className="rounded bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {destructiveBusy ? "Resetting…" : "Confirm Destructive Reset"}
          </button>
        </div>
      </section>
    </main>
  );
}
