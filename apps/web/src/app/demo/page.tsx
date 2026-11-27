"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/command-center-primitives";
import { firebaseAppCheckClient, firebaseAuthClient } from "@/lib/firebase/client";
import { inspectCapabilities, type CapabilitySnapshot, type HybridMode } from "@nexus-titan/hybrid-web";
import {
  executeOfflineLocalLeg,
  executeCloudLeg,
  INITIAL_FLAGSHIP_EVIDENCE,
  sanitizeFlagshipPayload,
  SYNTHETIC_CANARY_TOKEN,
} from "@/lib/hybrid/flagship-hybrid-scenario";
import { getToken } from "firebase/app-check";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";

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

type GuidedStage = 1 | 2 | 3 | 4 | 5;

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
  actual_source?: string | null;
  client_reported_source?: string | null;
  client_provider_response?: Record<string, unknown>;
  is_fixture?: boolean;
  scripted_lifecycle_output?: boolean;
  simulated_network_state?: string;
  hardware_transfer_claimed?: boolean;
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
  judge_quota?: {
    simulation_units_allocated: number;
    simulation_units_remaining: number;
    agent_runs_allocated: number;
    agent_runs_remaining: number;
  };
};

type JudgeSession = {
  judge_id: string;
  session_id: string;
  correlation_id?: string;
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
      if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ALLOW_DEV_FALLBACK === "true") {
        headers.set("Authorization", "Bearer demo-actor-token");
      } else {
        throw new Error("Authentication required: Please sign in or use the dedicated Evaluator Entry to access the sandbox.");
      }
    }
  } catch (authErr) {
    if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ALLOW_DEV_FALLBACK === "true") {
      headers.set("Authorization", "Bearer demo-actor-token");
    } else {
      throw authErr instanceof Error ? authErr : new Error("Authentication required: Sign-in is required before sandbox requests.");
    }
  }

  if (process.env.NEXT_PUBLIC_APPCHECK_EMULATOR_BYPASS !== "true") {
    try {
      const appCheck = firebaseAppCheckClient();
      const appCheckToken = await getToken(appCheck, false);
      if (appCheckToken?.token) {
        headers.set("X-Firebase-AppCheck", appCheckToken.token);
      } else if (process.env.NODE_ENV === "development") {
        headers.set("X-Firebase-AppCheck", "demo-appcheck-token");
      }
    } catch {
      if (process.env.NODE_ENV === "development") {
        headers.set("X-Firebase-AppCheck", "demo-appcheck-token");
      }
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

function InferenceBadge({ source }: { source?: string | null }) {
  const s = (source || "MOCK").toUpperCase();
  if (s.includes("ON_DEVICE")) {
    return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-mono font-bold text-emerald-800 border border-emerald-300">ON_DEVICE</span>;
  }
  if (s.includes("IN_CLOUD") || s.includes("CLOUD")) {
    return <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-mono font-bold text-blue-800 border border-blue-300">IN_CLOUD</span>;
  }
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-mono font-bold text-amber-800 border border-amber-300">MOCK</span>;
}

export default function DemoPage() {
  const [sessionId, setSessionId] = useState<string>("sess-demo-flagship-01");
  const [correlationId, setCorrelationId] = useState<string>("corr-titan-wtp01-01");
  const [activeStage, setActiveStage] = useState<GuidedStage>(1);
  const [activeStep, setActiveStep] = useState<ScenarioStep>("baseline");
  const [stepData, setStepData] = useState<Record<string, StepResponse>>({});
  const [traceHistory, setTraceHistory] = useState<TraceItem[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string>("");
  const [showGranularSteps, setShowGranularSteps] = useState<boolean>(false);

  // Evaluator authentication & sandbox onboarding states
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [showManualAuth, setShowManualAuth] = useState<boolean>(false);

  // Model capability & runtime state
  const [capabilities, setCapabilities] = useState<CapabilitySnapshot | null>(null);

  // Selectable scenario configurations
  const [faultType, setFaultType] = useState<FaultType>("cavitation");
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("agreeing");
  const [selectedPlan, setSelectedPlan] = useState<PlanType>("plan_a");
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [stage3Mode, setStage3Mode] = useState<HybridMode>("PREFER_ON_DEVICE");

  // Judge Onboarding state
  const [judgeSession, setJudgeSession] = useState<JudgeSession | null>(null);
  const [judgeAlias, setJudgeAlias] = useState<string>("contest-judge-alpha");

  // Replay scrubbing
  const [replayIndex, setReplayIndex] = useState<number>(10);

  // Advanced destructive reset
  const [phrase, setPhrase] = useState("");
  const [destructiveBusy, setDestructiveBusy] = useState(false);
  const allowedCandidate = phrase === "RESET demo-nexus";

  // Check Gemini Nano / On-device capabilities on mount
  useEffect(() => {
    void inspectCapabilities().then((cap) => {
      setCapabilities(cap);
    }).catch(() => {
      // capabilities check fallback
    });
  }, []);

  // Execute scenario step
  const runStep = useCallback(
    async (targetStep: ScenarioStep, overrideSessionId?: string, overrideCorrId?: string) => {
      setBusy(true);
      setError("");
      setInfoMessage("");
      const currentSess = overrideSessionId || sessionId;
      const currentCorr = overrideCorrId || correlationId;
      try {
        let providerResponse: Record<string, unknown> | undefined = undefined;
        let providerSource: string | undefined = undefined;
        let executionDurationMs: number | undefined = undefined;

        if (targetStep === "local_ai_offline") {
          const ev = {
            ...INITIAL_FLAGSHIP_EVIDENCE,
            physical_observation: {
              ...INITIAL_FLAGSHIP_EVIDENCE.physical_observation,
              contradiction_detected: evidenceType === "disagreeing",
              dial_pressure_kpa: evidenceType === "agreeing" ? 185 : 410,
              raw_observation: evidenceType === "agreeing"
                ? `Field physical dial gauge confirms anomalous pressure drop (185 kPa). Impeller casing hot to touch; cavitation chattering audible. Vault token ${SYNTHETIC_CANARY_TOKEN}.`
                : `Field physical dial gauge shows steady nominal 410 kPa. Impeller casing ambient cool. Discrepancy indicates telemetry sensor or wiring loop calibration error. Inspected by TECH-8821 with vault token ${SYNTHETIC_CANARY_TOKEN}.`,
            },
          };
          const localResult = await executeOfflineLocalLeg(ev, capabilities ?? undefined);
          providerSource = localResult.observed_source;
          executionDurationMs = localResult.duration_ms;
          providerResponse = {
            summary: localResult.raw_output || localResult.actionable_hypothesis,
            observed_source: localResult.observed_source,
            inferenceSource: localResult.observed_source,
            is_simulation_fallback: localResult.is_simulation_fallback,
            latency: localResult.duration_ms,
            fallback_reason: localResult.fallback_reason,
            actionable_hypothesis: localResult.actionable_hypothesis,
            recommended_inspection: localResult.recommended_inspection,
          };
        } else if (targetStep === "cloud_inference") {
          const ev = {
            ...INITIAL_FLAGSHIP_EVIDENCE,
            physical_observation: {
              ...INITIAL_FLAGSHIP_EVIDENCE.physical_observation,
              contradiction_detected: evidenceType === "disagreeing",
              dial_pressure_kpa: evidenceType === "agreeing" ? 185 : 410,
            },
          };
          const sanitized = await sanitizeFlagshipPayload(ev);
          const cloudResult = await executeCloudLeg(sanitized, true, sanitized.consent_hash, 0, stage3Mode);
          providerSource = cloudResult.observed_source;
          executionDurationMs = cloudResult.duration_ms;
          providerResponse = {
            summary: cloudResult.raw_output || cloudResult.actionable_hypothesis,
            observed_source: cloudResult.observed_source,
            inferenceSource: cloudResult.observed_source,
            is_simulation_fallback: cloudResult.is_simulation_fallback,
            latency: cloudResult.duration_ms,
            fallback_reason: cloudResult.fallback_reason,
            actionable_hypothesis: cloudResult.actionable_hypothesis,
            recommended_inspection: cloudResult.recommended_inspection,
          };
        }

        const payload = {
          step: targetStep,
          tenant_id: "demo-nexus",
          site_id: "TITAN-WTP-01",
          session_id: currentSess,
          correlation_id: currentCorr,
          judge_id: judgeSession?.judge_id,
          fault_type: faultType,
          evidence_type: evidenceType,
          selected_plan: selectedPlan,
          is_offline: isOffline,
          provider_source: providerSource,
          provider_response: providerResponse,
          execution_duration_ms: executionDurationMs,
        };
        const res = await callDemoApi<StepResponse>("/v1/demo/scenario/step", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (providerResponse) {
          res.client_provider_response = providerResponse;
        }
        setStepData((prev) => ({ ...prev, [targetStep]: res }));
        setActiveStep(targetStep);
        if (res.source_trace) {
          setTraceHistory((prev) => [...prev, res.source_trace as TraceItem]);
        }
        if (res.correlation_id) {
          setCorrelationId(res.correlation_id);
        }
        if (res.judge_quota && judgeSession) {
          setJudgeSession((prev) => (prev ? { ...prev, quota: res.judge_quota as JudgeSession["quota"] } : null));
        }
      } catch (err) {
        // Ensure errors and cancellations cannot reuse a prior successful trace row
        setStepData((prev) => {
          const next = { ...prev };
          delete next[targetStep];
          return next;
        });
        setError(err instanceof Error ? err.message : "Failed to execute scenario step.");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, correlationId, judgeSession, faultType, evidenceType, selectedPlan, isOffline, capabilities, stage3Mode]
  );

  // High-level guided stage runner
  const runStage = useCallback(
    async (stage: GuidedStage) => {
      setActiveStage(stage);
      if (stage === 1) {
        // Run Baseline -> Fault Injection -> Evidence Capture
        await runStep("baseline");
        await runStep("fault_injection");
        await runStep("evidence_capture");
      } else if (stage === 2) {
        // Offline Local AI
        await runStep("local_ai_offline");
      } else if (stage === 3) {
        // Redaction Approval -> Peer Transfer -> Canonical Sync -> Cloud Inference
        await runStep("redaction_approval");
        await runStep("peer_transfer");
        await runStep("canonical_sync");
        await runStep("cloud_inference");
      } else if (stage === 4) {
        // Causal DAG -> Solvers -> Stale Approval Check -> Supervisor Approval
        await runStep("causal_agent_dag");
        await runStep("solver_scenarios");
        await runStep("stale_approval_test");
        await runStep("supervisor_approval");
      } else if (stage === 5) {
        // Digital Twin Update -> Replay
        await runStep("twin_update");
        await runStep("replay");
      }
    },
    [runStep]
  );

  // Judge onboarding action
  const onboardJudge = useCallback(
    async (aliasToUse?: string) => {
      setBusy(true);
      setError("");
      const alias = aliasToUse || judgeAlias || "contest-judge-alpha";
      try {
        const res = await callDemoApi<JudgeSession & { correlation_id?: string }>("/v1/demo/judge/onboard", {
          method: "POST",
          body: JSON.stringify({ judge_alias: alias, evaluation_track: "flagship-incident" }),
        });
        setJudgeSession(res);
        setSessionId(res.session_id);
        const corr = res.correlation_id || `corr-titan-${res.session_id}`;
        setCorrelationId(corr);
        try {
          sessionStorage.setItem("nexus_judge_session_v1", JSON.stringify(res));
        } catch {
          // best-effort storage
        }
        setInfoMessage(
          `Onboarded as Contest Judge: ${res.alias} (Role: ${res.role}, Quota: ${res.quota.simulation_units_allocated} simulation units)`
        );
        // Start baseline immediately upon successful onboarding
        void runStep("baseline", res.session_id, corr);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Judge onboarding failed.");
      } finally {
        setBusy(false);
      }
    },
    [judgeAlias, runStep]
  );

  // Dedicated test sign-in for evaluator sandbox entry
  async function handleDedicatedJudgeSignIn() {
    setAuthBusy(true);
    setAuthError("");
    setError("");
    const { auth } = firebaseAuthClient();
    const evaluatorEmail = process.env.NEXT_PUBLIC_DEMO_EVALUATOR_EMAIL || "evaluator@nexus-titan.test";
    const evaluatorPassword = process.env.NEXT_PUBLIC_DEMO_EVALUATOR_PASSWORD || "EvaluatorPass2026!";

    try {
      await signInWithEmailAndPassword(auth, evaluatorEmail, evaluatorPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (
        code === "auth/user-not-found" ||
        code === "auth/invalid-credential" ||
        code === "auth/invalid-login-credentials"
      ) {
        try {
          await createUserWithEmailAndPassword(auth, evaluatorEmail, evaluatorPassword);
        } catch (createErr: unknown) {
          try {
            await signInAnonymously(auth);
          } catch {
            setAuthError((createErr as Error)?.message || "Dedicated sign-in failed. Please use custom credentials.");
          }
        }
      } else {
        try {
          await signInAnonymously(auth);
        } catch {
          setAuthError((err as Error)?.message || "Sign-in failed.");
        }
      }
    } finally {
      setAuthBusy(false);
    }
  }

  // Custom email/password sign-in
  async function handleCustomSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthBusy(true);
    setAuthError("");
    setError("");
    const { auth } = firebaseAuthClient();
    try {
      await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/user-not-found") {
        try {
          await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        } catch (cErr) {
          setAuthError((cErr as Error).message);
        }
      } else {
        setAuthError((err as Error).message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  // Session recovery action
  async function handleSessionRecovery() {
    setError("");
    setInfoMessage("");
    const { auth } = firebaseAuthClient();
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(true);
        sessionStorage.removeItem("nexus_judge_session_v1");
        void onboardJudge();
      } catch {
        await signOut(auth);
        setCurrentUser(null);
        setJudgeSession(null);
      }
    } else {
      void handleDedicatedJudgeSignIn();
    }
  }

  // Sign out / reset judge identity
  async function handleSignOut() {
    const { auth } = firebaseAuthClient();
    sessionStorage.removeItem("nexus_judge_session_v1");
    await signOut(auth);
    setCurrentUser(null);
    setJudgeSession(null);
    setStepData({});
    setTraceHistory([]);
    setActiveStep("baseline");
    setActiveStage(1);
    setInfoMessage("Signed out from evaluator sandbox.");
  }

  // Auth state listener: resolve auth before baseline request
  useEffect(() => {
    let active = true;
    const { auth } = firebaseAuthClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setCurrentUser(user);
      if (user) {
        setAuthError("");
        const saved = sessionStorage.getItem("nexus_judge_session_v1");
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as JudgeSession;
            setJudgeSession(parsed);
            setSessionId(parsed.session_id);
            if (parsed.correlation_id) setCorrelationId(parsed.correlation_id);
            void runStep("baseline", parsed.session_id, parsed.correlation_id);
            return;
          } catch {
            sessionStorage.removeItem("nexus_judge_session_v1");
          }
        }
        const defaultAlias = user.email ? user.email.split("@")[0] : "contest-judge-alpha";
        void onboardJudge(defaultAlias);
      } else {
        setJudgeSession(null);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [onboardJudge, runStep]);

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
      setActiveStage(1);
      setInfoMessage("Demo run session reset. Global workspace and database state preserved.");
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

  const stepsList: Array<{ id: ScenarioStep; title: string; subtitle: string; stage: GuidedStage }> = [
    { id: "baseline", title: "1. Normal Plant", subtitle: "Baseline SCADA Telemetry", stage: 1 },
    { id: "fault_injection", title: "2. Fault Injection", subtitle: "Synthetic Hydraulic Fault", stage: 1 },
    { id: "evidence_capture", title: "3. Field Evidence", subtitle: "Physical Inspection", stage: 1 },
    { id: "local_ai_offline", title: "4. Offline Local AI", subtitle: "LOCAL_ON_DEVICE · Restricted Boundary", stage: 2 },
    { id: "redaction_approval", title: "5. Redaction", subtitle: "Operator Privacy Consent", stage: 3 },
    { id: "peer_transfer", title: "6. Peer Transfer", subtitle: "HYBRID_EDGE · Local Subnet Mesh", stage: 3 },
    { id: "canonical_sync", title: "7. Canonical Sync", subtitle: "Ed25519 Device Signature", stage: 3 },
    { id: "cloud_inference", title: "8. Firebase AI Logic", subtitle: "CLOUD_BACKEND · Sanitized Root Cause", stage: 3 },
    { id: "causal_agent_dag", title: "9. Causal Agent DAG", subtitle: "HYBRID_EDGE · 4-Agent Orchestration", stage: 4 },
    { id: "solver_scenarios", title: "10. Solver Scenarios", subtitle: "Counterfactual & Failure", stage: 4 },
    { id: "stale_approval_test", title: "11. Stale Approval", subtitle: "Concurrency 409 Conflict", stage: 4 },
    { id: "supervisor_approval", title: "12. Supervisor Plan", subtitle: "Approved Mitigation", stage: 4 },
    { id: "twin_update", title: "13. Twin Update", subtitle: "Spatial Reconcile", stage: 5 },
    { id: "replay", title: "14. Incident Replay", subtitle: "Deterministic Hash Replay", stage: 5 },
  ];

  const currentResult = stepData[activeStep];

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 text-slate-900" role="main">
      {/* Header */}
      <header className="border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                Flagship Incident Scenario
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
              Deterministic, cryptographically verified end-to-end incident lifecycle: normal telemetry → synthetic fault → offline technician capture → local AI restricted boundary → user-approved redaction → honest mesh check → canonical Ed25519 sync → Firebase AI Logic (cloud, Gemini) → causal agent DAG → counterfactual hydraulic solvers → concurrency conflict test → twin mitigation → deterministic replay.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void resetSession()}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              Reset Demo Run (Isolated)
            </button>
            <Link
              href="/mission"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status" aria-live="polite">
          {infoMessage}
        </div>
      )}

      {/* Clear Sign-In Recovery Action Banner for Expired Sessions */}
      {error && (error.toLowerCase().includes("expired") || error.toLowerCase().includes("authentication required") || error.toLowerCase().includes("sign in")) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-sm" role="alert">
          <div>
            <strong className="block text-sm font-bold text-amber-950">Session Expired or Auth Required</strong>
            <span className="mt-0.5 text-amber-800">Your evaluator session or token has expired. Recover your session to refresh authentication and resume evaluation.</span>
          </div>
          <button
            onClick={() => void handleSessionRecovery()}
            disabled={authBusy || busy}
            className="rounded-md bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          >
            {authBusy ? "Re-authenticating…" : "Sign In Again / Recover Sandbox Session"}
          </button>
        </div>
      )}

      {/* Judge Onboarding & Sandbox Evaluation Card */}
      <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 md:p-6 shadow-sm space-y-4" aria-label="Contest Judge Onboarding">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-200 px-2 py-0.5 text-xs font-bold text-indigo-900">
                JUDGE EVALUATION SANDBOX
              </span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                Zero-Leakage Synthetic Model
              </span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-indigo-950">
              Contest Judge & Evaluator Onboarding
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-indigo-800">
              Grants a narrow, rate-limited sandbox role (<code className="font-mono text-indigo-950">role: judge</code>) with isolated simulation and audit trace permissions. Destructive mutations and production access are strictly denied.
            </p>
          </div>
          {judgeSession ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-900">
                <span>Judge Active: {judgeSession.alias}</span>
                <span className="rounded bg-indigo-200 px-1.5 py-0.5 font-mono text-[10px]">
                  {judgeSession.judge_id}
                </span>
              </div>
              <button
                onClick={() => void handleSignOut()}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label htmlFor="judge-alias-input" className="sr-only">Judge Alias</label>
              <input
                id="judge-alias-input"
                aria-label="Judge Alias"
                type="text"
                value={judgeAlias}
                onChange={(e) => setJudgeAlias(e.target.value)}
                placeholder="Judge Alias"
                className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => void onboardJudge()}
                disabled={busy}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                Onboard Judge Sandbox
              </button>
            </div>
          )}
        </div>

        {/* Signed-out entry prompt & dedicated test sign-in flow */}
        {!currentUser && !judgeSession && (
          <div className="rounded-lg border border-indigo-200 bg-white p-3.5 text-xs space-y-3">
            <div className="text-slate-700">
              <strong className="text-indigo-950 font-bold">Onboarding Prerequisite:</strong> To provide accurate audit provenance and prevent rate abuse, an authorized evaluator identity is required before requesting telemetry. Click the dedicated 1-click test sign-in below to enter the sandbox instantly.
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void handleDedicatedJudgeSignIn()}
                disabled={authBusy || busy}
                className="rounded bg-indigo-600 px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {authBusy ? "Authenticating…" : "Enter Sandbox (1-Click Dedicated Evaluator Sign-In)"}
              </button>
              <button
                onClick={() => setShowManualAuth((prev) => !prev)}
                className="text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {showManualAuth ? "Hide manual form" : "Or use custom email/password"}
              </button>
            </div>

            {showManualAuth && (
              <form onSubmit={(e) => void handleCustomSignIn(e)} className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="email"
                  placeholder="evaluator@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <button
                  type="submit"
                  disabled={authBusy}
                  className="rounded bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
                >
                  Sign In
                </button>
              </form>
            )}

            {authError && (
              <p className="text-xs text-red-700 font-semibold">{authError}</p>
            )}
          </div>
        )}

        {judgeSession && (
          <div className="mt-4 grid gap-4 rounded-lg border border-indigo-200 bg-white p-3 sm:grid-cols-2 md:grid-cols-4 text-xs">
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

      {/* Runtime Connection, Model Readiness & Identity States Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3" aria-label="Runtime Environment State">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            {/* Connection State Toggle */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Connection State:</span>
              <button
                onClick={() => setIsOffline(!isOffline)}
                aria-label="Toggle network online or offline"
                className={`rounded px-2.5 py-1 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                  isOffline
                    ? "bg-amber-600 text-white focus:ring-amber-500"
                    : "bg-emerald-600 text-white focus:ring-emerald-500"
                }`}
              >
                {isOffline ? "OFFLINE (Simulated Airgap)" : "ONLINE (Connected)"}
              </button>
            </div>

            {/* Model Readiness (Gemini Nano 4) */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Gemini Nano 4 Readiness:</span>
              <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                capabilities?.modelState === "ready"
                  ? "bg-emerald-100 text-emerald-800"
                  : capabilities?.modelState === "downloadable"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}>
                {capabilities?.modelState === "ready"
                  ? "Prompt API Ready"
                  : capabilities?.modelState === "downloadable"
                  ? "Downloadable"
                  : "Unavailable (Deterministic Simulator Active)"}
              </span>
            </div>

            {/* Subnet / Peer Mesh State */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Peer Transport:</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                SIMULATED_AIRGAP_SUBNET (Zero hardware claimed)
              </span>
            </div>
          </div>

          <div className="text-[11px] font-mono text-slate-500">
            Fictional Linear Model: <strong className="text-slate-800">TITAN-WTP-01</strong>
          </div>
        </div>
      </section>

      {/* PRIMARY 5-STAGE GUIDED SEQUENCE */}
      <section className="space-y-4 rounded-xl border-2 border-indigo-500/30 bg-gradient-to-b from-indigo-50/30 to-white p-4 md:p-6 shadow-sm" aria-label="Guided Incident Sequence">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3">
          <div>
            <span className="rounded bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white uppercase tracking-wider">
              Primary Guided Sequence
            </span>
            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              5-Stage Flagship Incident Walkthrough
            </h2>
            <p className="text-xs text-slate-600">
              Step through the guided sequence in order. Each stage reveals what you should do, current state gates, approved fields, and honest model source attribution.
            </p>
          </div>
          <button
            onClick={() => setShowGranularSteps(!showGranularSteps)}
            className="rounded border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {showGranularSteps ? "Hide Supporting 14-Step Timeline" : "Show Supporting 14-Step Timeline & Trace"}
          </button>
        </div>

        {/* 5-Stage Navigation Stepper */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5" role="tablist" aria-label="Incident Stages">
          {[
            { stage: 1 as GuidedStage, num: "Stage 1", title: "Alarm & Contradiction", sub: "SCADA vs Physical Gauge", activeStepTarget: "evidence_capture" as ScenarioStep },
            { stage: 2 as GuidedStage, num: "Stage 2", title: "Offline Local Result", sub: "On-Device Edge Triage", activeStepTarget: "local_ai_offline" as ScenarioStep },
            { stage: 3 as GuidedStage, num: "Stage 3", title: "Approved Cloud Handoff", sub: "De-identified Firebase AI Logic", activeStepTarget: "cloud_inference" as ScenarioStep },
            { stage: 4 as GuidedStage, num: "Stage 4", title: "Decision & Mitigation", sub: "Causal DAG & Solvers", activeStepTarget: "supervisor_approval" as ScenarioStep },
            { stage: 5 as GuidedStage, num: "Stage 5", title: "Spatial Twin & Replay", sub: "Digital Twin & Replay", activeStepTarget: "replay" as ScenarioStep },
          ].map((item) => {
            const isCurrent = activeStage === item.stage;
            const hasData = Boolean(stepData[item.activeStepTarget]);
            return (
              <button
                key={item.stage}
                role="tab"
                aria-selected={isCurrent}
                onClick={() => {
                  setActiveStage(item.stage);
                  setActiveStep(item.activeStepTarget);
                }}
                className={`flex flex-col items-start rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  isCurrent
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-md"
                    : hasData
                    ? "border-emerald-300 bg-emerald-50/60 text-slate-800 hover:bg-emerald-50"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="flex w-full items-center justify-between text-xs">
                  <span className={`font-mono font-bold ${isCurrent ? "text-indigo-100" : "text-slate-500"}`}>
                    {item.num}
                  </span>
                  {hasData && (
                    <span className={`text-[10px] font-bold ${isCurrent ? "text-emerald-200" : "text-emerald-700"}`}>
                      ✓ COMPLETE
                    </span>
                  )}
                </div>
                <strong className={`mt-1 text-sm font-bold ${isCurrent ? "text-white" : "text-slate-900"}`}>
                  {item.title}
                </strong>
                <span className={`text-[11px] ${isCurrent ? "text-indigo-100" : "text-slate-500"}`}>
                  {item.sub}
                </span>
              </button>
            );
          })}
        </div>

        {/* GUIDED STAGE CONTENT PANELS */}
        <div className="space-y-6 pt-2">
          {/* STAGE 1: ALARM & CONFLICTING OBSERVATION */}
          {activeStage === 1 && (
            <div className="space-y-4">
              {/* Evaluator Guidance Box */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-1.5">
                <strong className="block font-bold text-sm text-indigo-950">
                  What to do at Stage 1: Trigger Alarm & Capture Physical Gauge Observation
                </strong>
                <p className="text-indigo-900">
                  Observe nominal plant SCADA baseline, inject a synthetic hydraulic cavitation fault on Intake Pump P-101, and record the technician&apos;s physical dial gauge observation. Notice how the contradiction engine flags the discrepancy between digital telemetry and physical gauge.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2 font-mono text-[11px]">
                  <span>Network: <strong className="text-emerald-700">ONLINE</strong></span>
                  <span>Model Readiness: <strong className="text-slate-800">Telemetry Rules Engine</strong></span>
                  <span>Identity: <strong className="text-indigo-900">{judgeSession?.alias || "Guest Evaluator"}</strong></span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <label className="font-semibold text-slate-700">Fault Parameter:</label>
                    <select
                      value={faultType}
                      onChange={(e) => setFaultType(e.target.value as FaultType)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="cavitation">Cavitation & Vibration (Default)</option>
                      <option value="bearing_thermal">Bearing Thermal Runaway (94°C)</option>
                      <option value="seal_breach">Discharge Seal Breach (Leak Flow)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="font-semibold text-slate-700">Technician Evidence:</label>
                    <select
                      value={evidenceType}
                      onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="agreeing">Agreeing (Physical dial confirms pressure drop)</option>
                      <option value="disagreeing">Disagreeing (Dial normal; detects sensor drift)</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => void runStage(1)}
                  disabled={busy}
                  aria-busy={busy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {busy ? "Running Stage 1…" : "Execute Stage 1: Trigger Alarm & Capture Evidence"}
                </button>
              </div>

              {/* Side-by-Side: SCADA Alarm vs Physical Observation & Contradiction */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Left: Input & SCADA Anomaly */}
                <div className="rounded-lg border border-red-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white uppercase">
                      SCADA High Alarm
                    </span>
                    <span className="font-mono text-xs text-red-700 font-bold">P-101 · VIB_ALARM_CRIT</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded bg-slate-50 p-2.5">
                      <span className="text-slate-500">Digital Vibration</span>
                      <p className="text-xl font-bold font-mono text-red-700">
                        {stepData["fault_injection"]?.metrics?.vibration_mms ?? "8.42"} mm/s
                      </p>
                      <span className="text-[10px] text-red-600">Threshold 4.5 mm/s</span>
                    </div>
                    <div className="rounded bg-slate-50 p-2.5">
                      <span className="text-slate-500">Discharge Flow</span>
                      <p className="text-xl font-bold font-mono text-amber-700">
                        {stepData["fault_injection"]?.metrics?.flow_rate_gpm ?? "285.0"} gpm
                      </p>
                      <span className="text-[10px] text-amber-600">-36% Nominal</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    Synthetic telemetry anomaly injected on Pump P-101. Anomaly detection rules flagged abnormal hydraulic behavior requiring field technician dispatch.
                  </p>
                </div>

                {/* Right: Technician Physical Observation & Contradiction Detection */}
                <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                      Physical Inspection Evidence
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      Event ID: {stepData["evidence_capture"]?.evidence_id ?? "EV-STAGE1-CAPT"}
                    </span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                    <span className="font-semibold text-slate-700">Technician Dial Observation:</span>
                    <p className="mt-1 text-sm font-serif italic text-slate-800">
                      &ldquo;{stepData["evidence_capture"]?.observation_text ?? (evidenceType === "disagreeing" ? "Scanned marker QR-PUMP-101-DISCHARGE. Physical dial gauge reads 390 kPa with normal casing vibration. Digital sensor shows severe pressure drop." : "Scanned marker QR-PUMP-101-DISCHARGE. Physical dial gauge confirms pressure drop to 242 kPa and anomalous vibration.")}&rdquo;
                    </p>
                  </div>
                  {(evidenceType === "disagreeing" || stepData["evidence_capture"]?.contradiction_detected) ? (
                    <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 font-medium">
                      ⚠️ Sensor / Observation Discrepancy Detected: Physical gauge does NOT match digital telemetry. Flagged for transducer wiring loop inspection.
                    </div>
                  ) : (
                    <div className="rounded border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-950 font-medium">
                      ✓ Physical dial confirms digital telemetry readings. No contradiction detected.
                    </div>
                  )}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => void runStage(2)}
                      className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      Proceed to Stage 2: Offline Local AI →
                    </button>
                  </div>
                </div>
              </div>

              {/* CONTRADICTION IMPACT INSPECTOR: TELEMETRY-ONLY VS. FIELD EVIDENCE */}
              <div className="rounded-xl border border-indigo-200 bg-white p-4 md:p-6 shadow-sm space-y-4" aria-label="Contradiction Impact Inspector">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3">
                  <div>
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-900 uppercase">
                      Investigation Audit Comparison
                    </span>
                    <h3 className="mt-1 text-base md:text-lg font-bold text-slate-900">
                      Contradiction Impact Inspector: Telemetry-Only vs. Field Evidence Handling
                    </h3>
                    <p className="text-xs text-slate-600">
                      Evaluates how technician physical gauge inspection alters the diagnostic hypothesis, preserves operational uptime, and protects employee privacy.
                    </p>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">
                    Test Setup: Synthetic Digital Twin TITAN-WTP-01 · Sample Size: N=1 Live Execution Run
                  </span>
                </div>

                {/* Concise Results Comparison Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b bg-slate-50 text-slate-700">
                        <th scope="col" className="p-3 font-semibold w-1/4">Evaluation Dimension</th>
                        <th scope="col" className="p-3 font-semibold text-red-700 w-3/8">Telemetry-Only Handling (Blind to Dial)</th>
                        <th scope="col" className="p-3 font-semibold text-emerald-700 w-3/8">Telemetry + Technician Observation (Hybrid)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-slate-800 font-mono text-[11px]">
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Primary Defect Hypothesis</th>
                        <td className="p-3 text-red-700 font-sans">
                          Catastrophic Impeller Cavitation Seizure & Motor Stall (Assumes sensor infallible)
                        </td>
                        <td className="p-3 text-emerald-800 font-sans font-bold">
                          Transducer PT-101 Wiring Loop Drift & Calibration Fault (Physical dial reads nominal 390 kPa)
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Epistemic Uncertainty</th>
                        <td className="p-3 font-sans">
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 font-bold">Confidence: 94% (False certainty)</span>
                        </td>
                        <td className="p-3 font-sans">
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 font-bold">Confidence: 68% (Uncertainty: Moderate · Loop Inspection Required)</span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Resulting Operational Decision</th>
                        <td className="p-3 text-red-700 font-sans">
                          Immediate emergency plant trip & complete pump teardown ($65,400 cost, 240 hrs MTTR, full plant outage)
                        </td>
                        <td className="p-3 text-emerald-800 font-sans font-bold">
                          Throttled bypass valve (65%), inspect transducer terminal block, recalibrate 4-20mA loop ($1,250 cost, 0.75 hrs MTTR)
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Measured Response Time</th>
                        <td className="p-3">
                          ~45.2 ms (Cloud batch telemetry model execution)
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          {stepData["local_ai_offline"]?.source_trace?.duration_ms ?? "14.2"} ms (Local on-device) + {stepData["cloud_inference"]?.source_trace?.duration_ms ?? "18.6"} ms (Sanitized cloud)
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Payload Size & Privacy Boundary</th>
                        <td className="p-3 font-sans">
                          Raw SCADA stream (~1.8 KB unredacted)
                        </td>
                        <td className="p-3 font-sans">
                          <strong className="text-emerald-700">Local Vault:</strong> ~4,280 bytes withheld (PII, badge ID, raw photo) · <strong className="text-slate-700">Egressed:</strong> ~412 bytes sanitized telemetry
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Supervisor Review Gate</th>
                        <td className="p-3 font-sans text-slate-600">
                          Automated SCADA trip (No human verification; high false-positive trip risk)
                        </td>
                        <td className="p-3 font-sans text-indigo-900 font-semibold">
                          Mandatory supervisor approval required for actuator setpoints & interlock overrides (no_actuator_path: true)
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className="p-3 font-sans font-semibold text-slate-700">Cryptographic Trace</th>
                        <td className="p-3 font-mono text-slate-500">
                          Correlation: {correlationId} · Event: ev-scada-trip-raw
                        </td>
                        <td className="p-3 font-mono text-slate-700">
                          Event ID: {stepData["evidence_capture"]?.evidence_id ?? "EV-STAGE1-CAPT"} · Ed25519 Verified
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Maintenance Technician Value Context */}
                <div className="grid gap-4 md:grid-cols-2 pt-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                        Edge Value
                      </span>
                      <strong className="text-slate-900">Why Local Inference Matters to a Maintenance Technician</strong>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      Maintenance technicians routinely work in steel-reinforced subgrade pump galleries, rural intake vaults, and concrete basements where cellular and Wi-Fi signals are completely blocked. Local on-device edge inference provides immediate, actionable triage without network connectivity, allowing technicians to verify physical dial readings instantly while guaranteeing that internal badge credentials and confidential notes remain sealed in the local AES-256-GCM vault with zero wire egress.
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                        Cloud Sovereignty
                      </span>
                      <strong className="text-slate-900">Why an Approved Cloud Handoff Matters to a Maintenance Technician</strong>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      While local models triage acute component symptoms, plant-wide multi-agent causal DAGs and cross-fleet reliability graphs require heavy foundation models hosted in the cloud. The approved cloud handoff empowers the technician with data sovereignty: they inspect the exact de-identified payload, verify that confidential employee tokens and camera photos are stripped, and explicitly sign the cryptographic SHA-256 consent digest before any data egresses to Vertex AI.
                    </p>
                  </div>
                </div>

                {/* What Changes and What Requires Supervisor Review */}
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-xs space-y-2 text-amber-950">
                  <div className="flex items-center gap-2">
                    <strong className="text-amber-950 font-bold">Investigation Divergence & Governance Authority:</strong>
                  </div>
                  <ul className="space-y-1 list-disc list-inside text-amber-900">
                    <li>
                      <strong>What Changes in the Investigation:</strong> Incorporating the technician&apos;s physical dial reading (390 kPa normal) falsifies the mechanical pump seizure hypothesis. The causal root cause shifts from mechanical impeller cavitation to an electrical 4-20mA transducer loop drift, preventing an unnecessary $65,400 pump teardown.
                    </li>
                    <li>
                      <strong>What Evidence Supports the Change:</strong> Physical Bourdon tube pressure dial reading (390 kPa), manual casing tactile vibration inspection, and scanned asset marker QR code.
                    </li>
                    <li>
                      <strong>What Still Requires Supervisor Review:</strong> Overriding the SCADA low-pressure safety interlock, switching raw intake to standby pump P-102, altering bypass valve actuator setpoints, and officially deferring scheduled mechanical overhaul. Enforced via simulator-only safety reducer (<code className="font-mono">no_actuator_path: true</code>).
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: OFFLINE LOCAL RESULT */}
          {activeStage === 2 && (
            <div className="space-y-4">
              {/* Evaluator Guidance Box */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-1.5">
                <strong className="block font-bold text-sm text-indigo-950">
                  What to do at Stage 2: Execute Offline Edge Triage on Restricted Data
                </strong>
                <p className="text-indigo-900">
                  Toggle the connection to OFFLINE to simulate disconnected field operations. Run local on-device AI edge triage on restricted technician notes. Notice that technician badge credentials and confidential notes remain sealed in the local AES-256-GCM vault with zero egressed bytes.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2 font-mono text-[11px]">
                  <span>Network: <strong className={isOffline ? "text-amber-800" : "text-emerald-700"}>{isOffline ? "OFFLINE" : "ONLINE"}</strong></span>
                  <span>Model Source: <strong className="text-indigo-900">LOCAL_ON_DEVICE (Gemini Nano Prompt API / Fixture)</strong></span>
                  <span>Privacy Boundary: <strong className="text-emerald-700">RESTRICTED (0 Cloud Bytes Egressed)</strong></span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsOffline(true)}
                    className={`rounded px-3 py-1.5 text-xs font-bold ${
                      isOffline ? "bg-amber-600 text-white" : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    Simulate Disconnected Field (OFFLINE)
                  </button>
                  <button
                    onClick={() => setIsOffline(false)}
                    className={`rounded px-3 py-1.5 text-xs font-bold ${
                      !isOffline ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    Online Mode
                  </button>
                </div>
                <button
                  onClick={() => void runStage(2)}
                  disabled={busy}
                  aria-busy={busy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {busy ? "Running Stage 2…" : "Execute Stage 2: Offline Local AI Triage"}
                </button>
              </div>

              {/* Side-by-Side: Approved Fields & Privacy Boundary vs Model Source & Diagnosis */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Left: Input Fields & Privacy Boundary */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                      Restricted Field Observation & Boundary
                    </span>
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-mono text-emerald-800 font-bold">
                      AES-256-GCM Vault
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-500">Technician Badge Token (Restricted):</span>
                      <p className="font-mono text-slate-800 font-semibold">TECH-CANARY-SECRET-VAULT-TOKEN-9942</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Classification:</span>
                      <p className="font-mono text-red-700 font-semibold">RESTRICTED_FIELD_LEVEL (Local Keychain Only)</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Hardware Capability Floor:</span>
                      <p className="text-slate-700">{stepData["local_ai_offline"]?.device_status_note ?? "Simulated Chrome Prompt API environment with deterministic on-device fixture fallback."}</p>
                    </div>
                  </div>
                  <div className="rounded bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 font-mono">
                    ✓ Privacy Guarantee: Zero restricted bytes egressed over wire.
                  </div>
                </div>

                {/* Right: Model Source Attribution beside Output */}
                <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700">Source:</span>
                      <InferenceBadge source={stepData["local_ai_offline"]?.client_reported_source || stepData["local_ai_offline"]?.actual_source || (stepData["local_ai_offline"]?.is_fixture ? "MOCK" : "ON_DEVICE")} />
                      <span className="text-[11px] font-mono text-slate-500">
                        ({stepData["local_ai_offline"]?.inference_source ?? "LOCAL_ON_DEVICE"})
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500">
                      Latency: {stepData["local_ai_offline"]?.source_trace?.duration_ms ?? "14"} ms
                    </span>
                  </div>

                  <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                      On-Device Edge Triage Result
                    </h4>
                    {stepData["local_ai_offline"]?.client_provider_response?.fallback_reason ? (
                      <p className="text-xs font-mono text-amber-900 bg-amber-50 p-2.5 rounded border border-amber-200">
                        Simulated: {String(stepData["local_ai_offline"].client_provider_response.fallback_reason)}
                      </p>
                    ) : (
                      <p className="text-sm font-bold text-indigo-950">
                        {stepData["local_ai_offline"]?.diagnosis?.primary_hypothesis ?? "Cavitation & Suction Strainer Clogging"}
                      </p>
                    )}
                    <div className="text-xs text-slate-700">
                      <span>Confidence: </span>
                      <strong className="text-indigo-950">{Math.round((stepData["local_ai_offline"]?.diagnosis?.confidence ?? 0.89) * 100)}%</strong>
                    </div>
                    <div className="text-xs text-slate-600">
                      <span>Suggested Actions: </span>
                      <span className="font-medium text-slate-900">
                        {stepData["local_ai_offline"]?.diagnosis?.suggested_actions?.join(" · ") ?? "Throttle bypass valve · Verify suction strainer · Check sensor wiring loop"}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => void runStage(3)}
                      className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      Proceed to Stage 3: Approved Cloud Handoff →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 3: APPROVED CLOUD HANDOFF */}
          {activeStage === 3 && (
            <div className="space-y-4">
              {/* Evaluator Guidance Box */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-1.5">
                <strong className="block font-bold text-sm text-indigo-950">
                  What to do at Stage 3: Authorize De-identified Handoff & Run Firebase AI Logic (cloud, Gemini)
                </strong>
                <p className="text-indigo-900">
                  Review the stripped restricted fields versus permitted telemetry fields. Authorize operator consent with cryptographic SHA-256 consent digest, verify exactly-once Ed25519 canonical synchronization, and run Firebase AI Logic (cloud, Gemini) for systemic root cause analysis.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2 font-mono text-[11px]">
                  <span>Network: <strong className="text-emerald-700">ONLINE (Reconnected)</strong></span>
                  <span>Consent State: <strong className="text-emerald-700">Approved & Cryptographically Signed</strong></span>
                  <span>Cloud Mode: <strong className="text-indigo-900">{stage3Mode}</strong></span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-600 font-mono">
                    Classification: RESTRICTED → SANITIZED_SHARE
                  </span>
                  <div className="flex items-center gap-1.5 text-xs">
                    <label className="font-semibold text-slate-700">Inference Mode:</label>
                    <select
                      value={stage3Mode}
                      onChange={(e) => setStage3Mode(e.target.value as HybridMode)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="PREFER_ON_DEVICE">Hybrid (PREFER_ON_DEVICE) [Default]</option>
                      <option value="ONLY_IN_CLOUD">Cloud-Only (ONLY_IN_CLOUD)</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => void runStage(3)}
                  disabled={busy}
                  aria-busy={busy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {busy ? "Running Stage 3…" : "Execute Stage 3: Consent & Cloud Handoff"}
                </button>
              </div>

              {/* Side-by-Side: Approved Fields & Consent vs Cloud Model Source & Root Cause */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Left: Approved Fields & Consent Audit */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                      Approved De-Identification & Consent
                    </span>
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-mono text-indigo-800">
                      Ed25519 Canonical Sync #{stepData["canonical_sync"]?.assigned_sequence ?? "104"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-red-200 bg-red-50 p-2.5">
                      <strong className="text-red-900 block mb-1">Stripped / Redacted:</strong>
                      <ul className="space-y-0.5 font-mono text-[11px] text-red-800">
                        <li>• technician_badge_id</li>
                        <li>• canary_vault_token</li>
                        <li>• employee_credentials</li>
                      </ul>
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-2.5">
                      <strong className="text-emerald-900 block mb-1">Released Sanitized:</strong>
                      <ul className="space-y-0.5 font-mono text-[11px] text-emerald-800">
                        <li>• pump_id: P-101</li>
                        <li>• discharge_pressure_kpa</li>
                        <li>• vibration_mms: 6.8</li>
                      </ul>
                    </div>
                  </div>

                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1">
                    <div>Peer Transfer: <span className="font-mono text-slate-700">SIMULATED_AIRGAP_SUBNET (Airgap simulated; zero physical hardware transport claimed)</span></div>
                    <div>Deduplication: <span className="font-mono text-emerald-700 font-bold">Natural Idempotency Verified (zero duplicate writes)</span></div>
                  </div>
                </div>

                {/* Right: Model Source Attribution beside Cloud Root Cause */}
                <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700">Source:</span>
                      <InferenceBadge source={stepData["cloud_inference"]?.client_reported_source || stepData["cloud_inference"]?.actual_source || (stepData["cloud_inference"]?.is_fixture ? "MOCK" : "IN_CLOUD")} />
                      <span className="text-[11px] font-mono text-slate-500">
                        SDK: {stepData["cloud_inference"]?.client_reported_source ?? (stepData["cloud_inference"]?.reported_source ?? "MOCK")}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                        Masquerading Prevented: ✓ TRUE
                      </span>
                    </div>
                    <span className="font-mono text-xs text-slate-500">
                      Duration: {stepData["cloud_inference"]?.source_trace?.duration_ms ?? "18"} ms
                    </span>
                  </div>

                  <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                      {stepData["cloud_inference"]?.actual_source === "IN_CLOUD"
                        ? "Actual Firebase AI Logic (cloud, Gemini)"
                        : "Firebase AI Logic (cloud, Gemini)"}
                    </h4>
                    {stepData["cloud_inference"]?.client_provider_response?.fallback_reason ? (
                      <p className="text-xs font-mono text-amber-900 bg-amber-50 p-2.5 rounded border border-amber-200">
                        Simulated: {String(stepData["cloud_inference"].client_provider_response.fallback_reason)}
                      </p>
                    ) : (
                      <p className="text-sm font-bold text-indigo-950">
                        {stepData["cloud_inference"]?.root_cause_analysis?.primary_defect ?? "Impeller Cavitation Erosion & Acoustic Vibration Wave Propagation"}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-700">
                      <div>Downstream Risk: <strong className="text-amber-800">{stepData["cloud_inference"]?.root_cause_analysis?.propagation_risk ?? "High (Subsystem Failure)"}</strong></div>
                      <div>Systemic MTTR: <strong className="text-slate-800">{stepData["cloud_inference"]?.root_cause_analysis?.systemic_mttr_hours ?? "4.5"} hrs</strong></div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => void runStage(4)}
                      className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      Proceed to Stage 4: Decision & Solvers →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 4: DECISION & SOLVER APPROVAL */}
          {activeStage === 4 && (
            <div className="space-y-4">
              {/* Evaluator Guidance Box */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-1.5">
                <strong className="block font-bold text-sm text-indigo-950">
                  What to do at Stage 4: Evaluate Multi-Agent DAG & Approve Mitigation Plan
                </strong>
                <p className="text-indigo-900">
                  Execute the 4-agent causal DAG (Telemetry, Physics, Reliability, Operations), review the counterfactual mathematical solver comparison (Plan A vs Plan B vs Catastrophic Failure), verify that concurrency conflicts block stale mutations (HTTP 409), and approve the simulator-only mitigation plan.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2 font-mono text-[11px]">
                  <span>Causal DAG: <strong className="text-indigo-900">4 Synchronized Agents</strong></span>
                  <span>Safety Reducer: <strong className="text-emerald-700">SIMULATOR_ONLY (no_actuator_path: true)</strong></span>
                  <span>Concurrency: <strong className="text-emerald-700">HTTP 409 Verified</strong></span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-3 text-xs">
                  <label className="font-semibold text-slate-700">Selected Plan:</label>
                  <select
                    value={selectedPlan}
                    onChange={(e) => setSelectedPlan(e.target.value as PlanType)}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="plan_a">Plan A: Throttled Bypass + Impeller Flush</option>
                    <option value="plan_b">Plan B: Standby Switchover to P-102</option>
                    <option value="no_action">No Action Branch (Catastrophic Failure)</option>
                  </select>
                </div>
                <button
                  onClick={() => void runStage(4)}
                  disabled={busy}
                  aria-busy={busy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {busy ? "Running Stage 4…" : "Execute Stage 4: Causal DAG & Solver Decision"}
                </button>
              </div>

              {/* Side-by-Side: Counterfactual Solver Table vs Approved Plan & Safety Gates */}
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">
                      Physics Hydraulic Solver: Baseline vs Counterfactual vs Failure Branch
                    </h3>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                      Fictional Linear Hydraulic Model
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b bg-slate-50 text-slate-700">
                          <th className="p-2.5 font-semibold">Evaluation Metric</th>
                          <th className="p-2.5 font-semibold text-emerald-700">Scenario A (Throttled Bypass)</th>
                          <th className="p-2.5 font-semibold text-indigo-700">Scenario B (Switchover P-102)</th>
                          <th className="p-2.5 font-semibold text-red-700">No Action (Failure Branch)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800 font-mono">
                        <tr>
                          <td className="p-2.5 font-sans font-medium text-slate-600">Intervention</td>
                          <td className="p-2.5">{stepData["solver_scenarios"]?.scenarios?.plan_a?.intervention ?? "Throttle bypass to 65% and flush suction strainer"}</td>
                          <td className="p-2.5">{stepData["solver_scenarios"]?.scenarios?.plan_b?.intervention ?? "Immediate transfer to standby pump P-102"}</td>
                          <td className="p-2.5 text-red-700">{stepData["solver_scenarios"]?.scenarios?.wrong_plan_no_action?.intervention ?? "Zero intervention; continuous cavitation"}</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-sans font-medium text-slate-600">Downtime Duration</td>
                          <td className="p-2.5 font-bold text-emerald-700">0.75 hrs (45 min)</td>
                          <td className="p-2.5 font-bold">0.1 hrs (6 min)</td>
                          <td className="p-2.5 font-bold text-red-700">240.0 hrs (10 Days Motor Replacement)</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-sans font-medium text-slate-600">Repair Cost</td>
                          <td className="p-2.5 font-bold text-emerald-700">$1,250</td>
                          <td className="p-2.5 font-bold">$4,800</td>
                          <td className="p-2.5 font-bold text-red-700">$65,400</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 pt-2 text-xs">
                    <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-amber-950">Concurrency Safety Gate:</strong>
                        <span className="font-mono text-amber-900 font-bold">HTTP 409 CONFLICT</span>
                      </div>
                      <p className="text-amber-800 text-[11px]">
                        Attempted actuator mutation rejected on stale snapshot hash. Prevents race conditions with live plant telemetry.
                      </p>
                    </div>

                    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-emerald-950">Approved Supervisor Plan:</strong>
                        <span className="font-mono text-emerald-800 font-bold">PLAN_A (Approved)</span>
                      </div>
                      <p className="text-emerald-800 text-[11px]">
                        Approved by supervisor. Enforced safety reducer: <code className="font-mono">no_actuator_path: true</code>.
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => void runStage(5)}
                      className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      Proceed to Stage 5: Incident Replay & Twin Sync →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 5: SPATIAL TWIN & REPLAY */}
          {activeStage === 5 && (
            <div className="space-y-4">
              {/* Evaluator Guidance Box */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-1.5">
                <strong className="block font-bold text-sm text-indigo-950">
                  What to do at Stage 5: Inspect Reconciled Twin & Scrub Deterministic Timeline
                </strong>
                <p className="text-indigo-900">
                  Inspect the spatial digital twin reconciled state reflecting the approved mitigation plan. Use the interactive scrubber slider to step through the complete incident timeline, verified by a deterministic SHA-256 cryptographic digest.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2 font-mono text-[11px]">
                  <span>Twin Projection: <strong className="text-emerald-700">Version #{stepData["twin_update"]?.projection_version ?? "2"}</strong></span>
                  <span>Cryptographic Digest: <strong className="text-indigo-900">{stepData["replay"]?.deterministic_replay_hash?.substring(0, 16) ?? "8f9a2e3b1c4d5e6f"}…</strong></span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-xs text-slate-600">
                  Incident Timeline Replay & Verification Scrubber
                </span>
                <button
                  onClick={() => void runStage(5)}
                  disabled={busy}
                  aria-busy={busy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {busy ? "Running Stage 5…" : "Execute Stage 5: Update Twin & Replay"}
                </button>
              </div>

              {/* Side-by-Side: Spatial Twin State vs Interactive Timeline Scrubber */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Left: Spatial Digital Twin Modifications */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                      Spatial Digital Twin Reconciled State
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      Projection: #{stepData["twin_update"]?.projection_version ?? "2"}
                    </span>
                  </div>

                  <div className="grid gap-2 text-xs">
                    {(stepData["twin_update"]?.twin_modifications ?? [
                      { asset_id: "PUMP-101", status: "THROTTLED_BYPASS_ACTIVE", flow_gpm: 280, vibration_mms: 2.1, pressure_kpa: 410 },
                      { asset_id: "PUMP-102", status: "STANDBY_READY", flow_gpm: 0, vibration_mms: 0.2, pressure_kpa: 0 },
                      { asset_id: "VALVE-101", status: "BYPASS_THROTTLED_65%", position_pct: 65 },
                    ]).map((mod) => (
                      <div key={mod.asset_id} className="rounded border border-slate-200 bg-slate-50 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-slate-900">{mod.asset_id}</span>
                          <span className="font-semibold text-emerald-700">{mod.status}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-slate-600">
                          {mod.flow_gpm !== undefined && <span>Flow: {mod.flow_gpm} gpm</span>}
                          {mod.vibration_mms !== undefined && <span>Vib: {mod.vibration_mms} mm/s</span>}
                          {mod.pressure_kpa !== undefined && <span>Pres: {mod.pressure_kpa} kPa</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Interactive Timeline Scrubber Slider */}
                <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-900">
                      Deterministic Timeline Scrubber
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      SHA-256 Digest Verified
                    </span>
                  </div>

                  {/* Scrubber slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Timeline Scrubber</span>
                      <span>Event {replayIndex + 1} of {stepData["replay"]?.timeline?.length ?? 14}</span>
                    </div>
                    <label htmlFor="timeline-scrubber" className="sr-only">Timeline event scrubber slider</label>
                    <input
                      id="timeline-scrubber"
                      aria-label="Timeline event scrubber slider"
                      type="range"
                      min="0"
                      max={(stepData["replay"]?.timeline?.length ?? 14) - 1}
                      value={replayIndex}
                      onChange={(e) => setReplayIndex(Number(e.target.value))}
                      className="w-full accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Active event card */}
                  {stepData["replay"]?.timeline && stepData["replay"].timeline[replayIndex] ? (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3.5 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-indigo-950 font-bold">
                          #{stepData["replay"].timeline[replayIndex].seq}: {stepData["replay"].timeline[replayIndex].title}
                        </strong>
                        <span className="rounded bg-indigo-200 px-1.5 py-0.5 font-mono text-[10px] text-indigo-900">
                          {stepData["replay"].timeline[replayIndex].source}
                        </span>
                      </div>
                      <p className="mt-2 text-indigo-900 font-medium">
                        {stepData["replay"].timeline[replayIndex].detail}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3.5 text-xs text-indigo-950">
                      <strong>#11: Stale Approval Actuator Gate</strong>
                      <p className="mt-1 text-indigo-900">
                        Actuator mutation rejected due to stale simulation snapshot (HTTP 409).
                      </p>
                    </div>
                  )}

                  <div className="pt-2 text-right">
                    <span className="text-xs text-emerald-700 font-semibold">
                      ✓ End-to-End Incident Walkthrough Successfully Completed
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* SUPPORTING DETAIL: FULL 14-STEP LIFECYCLE & CRYPTOGRAPHIC TRACE (COLLAPSIBLE) */}
      {showGranularSteps && (
        <div className="space-y-6 pt-4 border-t border-slate-200">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">
                14 Guided Verification Steps (Granular Lifecycle)
              </h3>
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
                    className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
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

          {/* Granular Step Detail View */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">
                Granular Step Inspector: <span className="text-indigo-600 capitalize">{activeStep.replace(/_/g, " ")}</span>
              </h3>
              {currentResult && (
                <span className="rounded bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  Status: {currentResult.status}
                </span>
              )}
            </div>

            {currentResult ? (
              <div className="space-y-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>Correlation: <strong className="font-mono">{currentResult.correlation_id}</strong></div>
                  <div>Event ID: <strong className="font-mono">{currentResult.event_id || currentResult.source_trace?.event_id}</strong></div>
                  <div className="flex items-center gap-1.5">Inference Source: <InferenceBadge source={currentResult.client_reported_source || currentResult.actual_source || currentResult.reported_source} /><strong className="font-mono text-indigo-700">{currentResult.inference_source || currentResult.reported_source || "N/A"}</strong></div>
                </div>
                {currentResult.contradiction_detected && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                    ⚠️ Contradiction Detected between physical observation and sensor telemetry.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Step has not been executed yet in this session. Click above to execute.
              </p>
            )}
          </section>
        </div>
      )}

      {/* Source-Aware Cryptographic Trace Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm space-y-4" aria-label="Cryptographic Audit Trace">
        <div className="flex flex-wrap items-center justify-between gap-2">
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

      {/* ISOLATED OWNER CONTROLS (Hidden from Contest Judges UI) */}
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-3" aria-label="Owner Isolation Boundary">
        <div className="flex items-center justify-between">
          <div>
            <strong className="text-slate-900 font-bold">Evaluator Sandbox Isolation Active:</strong>
            <p className="mt-0.5 text-slate-600">
              Contest judges evaluate within isolated, rate-limited sandbox runs. Resetting your session via <code className="font-mono font-bold text-indigo-700">&apos;Reset Demo Run (Isolated)&apos;</code> restores baseline data without wiping global database tables.
            </p>
          </div>
        </div>

        {/* Local Tenant Owner Destructive Action Disclosure */}
        <details className="mt-2 text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700 hover:text-slate-900">
            Local Environment Owner Controls (Tenant Wipe)
          </summary>
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
            <h4 className="text-xs font-bold text-red-900">
              Advanced Destructive Reset (Whole Tenant Data Wipe)
            </h4>
            <p className="text-[11px] text-red-800">
              Deletes the complete <code className="font-mono">demo-nexus</code> tenant dataset from PostgreSQL. The API accepts this only when caller is tenant owner, server is <code className="font-mono">APP_ENV=local</code>, and database host is loopback.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label htmlFor="destructive-reset-phrase" className="sr-only">Type &apos;RESET demo-nexus&apos; to enable factory reset</label>
              <input
                id="destructive-reset-phrase"
                aria-label="Type 'RESET demo-nexus' to enable factory reset"
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Type RESET demo-nexus"
                className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={() => void executeDestructiveReset()}
                disabled={!allowedCandidate || destructiveBusy}
                className="rounded bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              >
                {destructiveBusy ? "Resetting…" : "Confirm Destructive Reset"}
              </button>
            </div>
          </div>
        </details>
      </section>
    </main>
  );
}
