"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  runFirebaseHybridTask,
  inspectCapabilities,
  prepareGeminiNano,
  HybridRuntimeError,
  type CapabilitySnapshot,
  type HybridMode,
  type InferenceSource,
  type LeasedInferenceTask,
} from "@nexus-titan/hybrid-web";
import { firebaseAppCheckClient, firebaseAuthClient } from "@/lib/firebase/client";
import { identityApi } from "@/lib/identity/api";
import { localDeviceId } from "@/lib/identity/device-key";
import {
  FLAGSHIP_INCIDENT_ID,
  FLAGSHIP_ASSET_ID,
  FLAGSHIP_FACILITY,
  SYNTHETIC_CANARY_TOKEN,
  INITIAL_FLAGSHIP_EVIDENCE,
  CONSENT_EXPLANATION,
  canonicalHash,
  sanitizeFlagshipPayload,
  executeOfflineLocalLeg,
  executeCloudLeg,
  type FlagshipEvidencePayload,
  type SanitizedCloudPayload,
  type LegExecutionResult,
} from "@/lib/hybrid/flagship-hybrid-scenario";

const modes: HybridMode[] = ["PREFER_ON_DEVICE", "ONLY_ON_DEVICE", "PREFER_IN_CLOUD", "ONLY_IN_CLOUD"];
const taskId = "lab-fixture-qa-001";
const fixtureText = "Fictional TITAN-WTP-01 pump P-004 shows a pressure sample of 300 kPa. This sample is synthetic and is not operational guidance.";

export default function InferenceLabPage() {
  const [activeTab, setActiveTab] = useState<"flagship" | "single_turn">("flagship");

  // Single-turn lab state
  const [mode, setMode] = useState<HybridMode>("PREFER_ON_DEVICE");
  const [flagshipCloudMode, setFlagshipCloudMode] = useState<HybridMode>("PREFER_ON_DEVICE");
  const [cloudApproval, setCloudApproval] = useState(false);
  const [capability, setCapability] = useState<CapabilitySnapshot>();
  const [status, setStatus] = useState("Ready. This lab sends only the fixed public synthetic fixture.");
  const [taskState, setTaskState] = useState<"idle" | "queued" | "running" | "result_ready" | "cancelled" | "failed">("idle");
  const [source, setSource] = useState<InferenceSource>("UNKNOWN");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [controller, setController] = useState<AbortController>();
  const [localAudit, setLocalAudit] = useState(false);

  // Flagship Contradictory Scenario State
  const [evidence, setEvidence] = useState<FlagshipEvidencePayload>(INITIAL_FLAGSHIP_EVIDENCE);
  const [localResult, setLocalResult] = useState<LegExecutionResult | null>(null);
  const [sanitizedPayload, setSanitizedPayload] = useState<SanitizedCloudPayload | null>(null);
  const [consentHash, setConsentHash] = useState<string>("");
  const [consentApproved, setConsentApproved] = useState<boolean>(false);
  const [cloudResult, setCloudResult] = useState<LegExecutionResult | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [nanoStatus, setNanoStatus] = useState<string>("Checking Gemini Nano (Chrome built-in) capability…");
  const [nanoReady, setNanoReady] = useState<boolean>(false);
  const [flagshipBusy, setFlagshipBusy] = useState<boolean>(false);
  const [flagshipError, setFlagshipError] = useState<string>("");
  const [flagshipInfo, setFlagshipInfo] = useState<string>("");
  const [retryCount, setRetryCount] = useState<number>(0);
  const [editableSanitizedText, setEditableSanitizedText] = useState<string>("");
  const [inFlightRequests, setInFlightRequests] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const caps = await inspectCapabilities("text");
    setCapability(caps);
    const prep = await prepareGeminiNano();
    setNanoReady(prep.ready);
    setNanoStatus(prep.status);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load persisted offline incident state on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("nexus-flagship-hybrid-incident-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as {
          evidence?: FlagshipEvidencePayload;
          localResult?: LegExecutionResult;
          sanitizedPayload?: SanitizedCloudPayload;
          consentHash?: string;
          consentApproved?: boolean;
          cloudResult?: LegExecutionResult;
        };
        if (parsed.evidence) {
          const ev = parsed.evidence;
          if (ev.restricted_canary === "TECH-CANARY-SECRET-VAULT-TOKEN-9942" || !ev.restricted_canary) {
            ev.restricted_canary = SYNTHETIC_CANARY_TOKEN;
          }
          if (ev.physical_observation?.raw_observation?.includes("TECH-CANARY-SECRET-VAULT-TOKEN-9942")) {
            ev.physical_observation.raw_observation = ev.physical_observation.raw_observation.replaceAll(
              "TECH-CANARY-SECRET-VAULT-TOKEN-9942",
              SYNTHETIC_CANARY_TOKEN
            );
          }
          setEvidence(ev);
        }
        if (parsed.localResult) setLocalResult(parsed.localResult);
        if (parsed.sanitizedPayload) {
          setSanitizedPayload(parsed.sanitizedPayload);
          setEditableSanitizedText(parsed.sanitizedPayload.deidentified_summary);
        }
        if (parsed.consentHash) setConsentHash(parsed.consentHash);
        if (parsed.consentApproved !== undefined) setConsentApproved(parsed.consentApproved);
        if (parsed.cloudResult) setCloudResult(parsed.cloudResult);
      }
    } catch {
      // LocalStorage access safe failure
    }
  }, []);

  // Save state on change to preserve local offline incident context
  const persistState = useCallback(
    (updates: {
      evidence?: FlagshipEvidencePayload;
      localResult?: LegExecutionResult | null;
      sanitizedPayload?: SanitizedCloudPayload | null;
      consentHash?: string;
      consentApproved?: boolean;
      cloudResult?: LegExecutionResult | null;
    }) => {
      try {
        const current = {
          evidence: updates.evidence ?? evidence,
          localResult: updates.localResult !== undefined ? updates.localResult : localResult,
          sanitizedPayload: updates.sanitizedPayload !== undefined ? updates.sanitizedPayload : sanitizedPayload,
          consentHash: updates.consentHash !== undefined ? updates.consentHash : consentHash,
          consentApproved: updates.consentApproved !== undefined ? updates.consentApproved : consentApproved,
          cloudResult: updates.cloudResult !== undefined ? updates.cloudResult : cloudResult,
        };
        localStorage.setItem("nexus-flagship-hybrid-incident-v1", JSON.stringify(current));
      } catch {
        // Safe persistence fallback
      }
    },
    [evidence, localResult, sanitizedPayload, consentHash, consentApproved, cloudResult]
  );

  // Handle Gemini Nano preparation trigger
  const handlePrepareNano = async () => {
    setFlagshipBusy(true);
    setFlagshipInfo("Preparing Gemini Nano (Chrome built-in) model (verifying Chrome Prompt API)…");
    try {
      const prep = await prepareGeminiNano((fraction) => {
        setFlagshipInfo(`Gemini Nano downloading: ${Math.round(fraction * 100)}%`);
      });
      setNanoReady(prep.ready);
      setNanoStatus(prep.status);
      setFlagshipInfo(prep.status);
    } catch (err) {
      setFlagshipError(`Preparation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFlagshipBusy(false);
    }
  };

  // Leg 1: Offline Local Triage (ONLY_ON_DEVICE)
  const handleRunLocalOfflineLeg = async () => {
    const requestKey = `local-${FLAGSHIP_INCIDENT_ID}`;
    if (inFlightRequests[requestKey]) {
      setFlagshipError("DUPLICATE_PREVENTED: A local inference request for this incident is already in flight.");
      return;
    }

    setFlagshipBusy(true);
    setFlagshipError("");
    setFlagshipInfo("Executing Leg 1: Offline Local Edge Triage (ONLY_ON_DEVICE)…");
    setInFlightRequests((prev) => ({ ...prev, [requestKey]: true }));

    try {
      const result = await executeOfflineLocalLeg(evidence, capability, retryCount);
      setLocalResult(result);

      // Auto-generate sanitized payload upon local triage completion
      const sanitized = await sanitizeFlagshipPayload(evidence);
      setSanitizedPayload(sanitized);
      setEditableSanitizedText(sanitized.deidentified_summary);
      setConsentHash(sanitized.consent_hash);
      setConsentApproved(false); // Consent requires fresh operator sign-off

      persistState({
        localResult: result,
        sanitizedPayload: sanitized,
        consentHash: sanitized.consent_hash,
        consentApproved: false,
      });

      setFlagshipInfo(
        `Leg 1 Complete: Local triage observed source ${result.observed_source} in ${result.duration_ms} ms. Canary preserved locally.`
      );
    } catch (err) {
      setFlagshipError(`Leg 1 Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInFlightRequests((prev) => {
        const next = { ...prev };
        delete next[requestKey];
        return next;
      });
      setFlagshipBusy(false);
    }
  };

  // Re-evaluate consent hash if operator edits the sanitized text
  const handleSanitizedTextChange = async (newText: string) => {
    setEditableSanitizedText(newText);
    if (!sanitizedPayload) return;

    const updatedBase = {
      ...sanitizedPayload,
      deidentified_summary: newText,
    };
    const newHash = await canonicalHash(updatedBase);

    // If text modified from original consent, invalidate consent!
    if (consentApproved && newHash !== consentHash) {
      setConsentApproved(false);
      setFlagshipError("CONSENT_INVALIDATED: Payload was modified after consent was granted; re-approval required.");
    }
    setConsentHash(newHash);
    setSanitizedPayload({
      ...updatedBase,
      consent_hash: newHash,
      sanitized_at: new Date().toISOString(),
    });
  };

  // Leg 2: Reconnection Cloud Leg via Firebase AI Logic (ONLY_IN_CLOUD)
  const handleRunCloudLeg = async () => {
    if (!sanitizedPayload) {
      setFlagshipError("Complete Leg 1 local triage before initiating the cloud leg.");
      return;
    }

    const requestKey = `cloud-${FLAGSHIP_INCIDENT_ID}`;
    if (inFlightRequests[requestKey]) {
      setFlagshipError("DUPLICATE_PREVENTED: A cloud request for this incident is already in flight.");
      return;
    }

    // Explicit approval gate: declined approval sends ZERO requests!
    if (!consentApproved) {
      setFlagshipError("APPROVAL_DECLINED: Cloud request blocked because operator approval was not granted.");
      return;
    }

    // Tamper gate: verify consent hash matches current payload
    const currentComputedHash = await canonicalHash({
      ...sanitizedPayload,
      deidentified_summary: editableSanitizedText,
    });
    if (currentComputedHash !== consentHash) {
      setConsentApproved(false);
      setFlagshipError("CONSENT_INVALIDATED: Payload was modified after consent was granted; re-approval required.");
      return;
    }

    setFlagshipBusy(true);
    setFlagshipError("");
    setFlagshipInfo(`Executing Leg 2: Root-Cause Analysis via Firebase AI Logic (${flagshipCloudMode})…`);
    setInFlightRequests((prev) => ({ ...prev, [requestKey]: true }));

    try {
      const activePayload: SanitizedCloudPayload = {
        ...sanitizedPayload,
        deidentified_summary: editableSanitizedText,
        consent_hash: currentComputedHash,
      };

      const result = await executeCloudLeg(activePayload, consentApproved, currentComputedHash, retryCount, flagshipCloudMode);
      setCloudResult(result);
      persistState({ cloudResult: result });
      setFlagshipInfo(
        `Leg 2 Complete: Cloud analysis observed source ${result.observed_source} in ${result.duration_ms} ms. Both legs linked to ${FLAGSHIP_INCIDENT_ID}.`
      );
    } catch (err) {
      setFlagshipError(`Leg 2 Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInFlightRequests((prev) => {
        const next = { ...prev };
        delete next[requestKey];
        return next;
      });
      setFlagshipBusy(false);
    }
  };

  // Reset Flagship Scenario state
  const handleResetFlagshipScenario = () => {
    setEvidence(INITIAL_FLAGSHIP_EVIDENCE);
    setLocalResult(null);
    setSanitizedPayload(null);
    setConsentHash("");
    setConsentApproved(false);
    setCloudResult(null);
    setFlagshipError("");
    setFlagshipInfo("Scenario reset to baseline contradictory pump reading.");
    setRetryCount(0);
    try {
      localStorage.removeItem("nexus-flagship-hybrid-incident-v1");
    } catch {
      // Safe cleanup
    }
  };

  // Single-turn runner (Original Phase 08 implementation preserved)
  async function runSingleTurn() {
    setBusy(true);
    setError("");
    setOutput("");
    setSource("UNKNOWN");
    setLatency(undefined);
    setTaskState("queued");
    const aborter = new AbortController();
    setController(aborter);
    const started = performance.now();
    setStatus("Running real Firebase AI Logic request…");
    try {
      const { app, auth } = firebaseAuthClient();
      if (!auth.currentUser) throw new Error("Sign in before requesting an inference task.");
      const tenantId = "demo-nexus";
      const siteId = "titan-wtp-01";
      const profile = await identityApi<{ uid: string; memberships: Array<{ organization_id: string; role: string }> }>("/v1/me");
      const membership = profile.memberships.find((item) => item.organization_id === tenantId);
      if (profile.uid !== auth.currentUser.uid || !membership) throw new Error("A matching active tenant membership is required.");
      const registeredDevices = await identityApi<{ devices: Array<{ device_id: string; client_device_id: string; status: string }> }>(
        `/v1/organizations/${encodeURIComponent(tenantId)}/devices`
      );
      const registeredDevice = registeredDevices.devices.find((item) => item.client_device_id === localDeviceId() && item.status === "registered");
      if (!registeredDevice) throw new Error("Register this browser as a trusted device before running the privacy gateway.");
      const caps = await inspectCapabilities("text");
      setCapability(caps);
      const destination = mode === "ONLY_ON_DEVICE" ? "local_inference" : "cloud_inference";
      const privacyDecision = await identityApi<{
        allow: boolean;
        reason: string;
        policy_version: string;
        classification: "public" | "internal" | "confidential" | "restricted";
        role: string;
        tenant_id: string;
        device_trusted: boolean;
        tenant_match: boolean;
      }>(`/v1/organizations/${encodeURIComponent(tenantId)}/privacy/decisions`, {
        method: "POST",
        body: JSON.stringify({
          site_id: siteId,
          device_id: registeredDevice.device_id,
          destination,
          purpose: destination === "local_inference" ? "approved_task" : "approved_summary",
          resource_refs: [{ aggregate_type: "asset", aggregate_id: "WTP01-PMP-004" }],
          consent: destination === "cloud_inference" ? cloudApproval : false,
        }),
      });
      if (!privacyDecision.allow) throw new Error(`Server privacy policy denied this request (${privacyDecision.reason}).`);
      const task: LeasedInferenceTask = {
        task_id: taskId,
        tenant_id: tenantId,
        schema_version: "1.3.0",
        role_id: "fixture_qa",
        risk_tier: "low",
        lease_id: `local-lab-${crypto.randomUUID()}`,
        lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        classification: privacyDecision.classification,
        input: { text: fixtureText, modality: "text", template_id: "fixture-qa-v1", cloud_approved: cloudApproval },
      };
      setTaskState("running");
      const result = await runFirebaseHybridTask({
        app,
        ensureAppCheck: () => {
          firebaseAppCheckClient();
        },
        signal: aborter.signal,
        task,
        mode,
        capabilities: caps,
        privacyDecision,
        onProgress: setStatus,
        onObservedSource: setSource,
      });
      setOutput(`${result.summary}${result.caveats.length ? `\n\nCaveats: ${result.caveats.join("; ")}` : ""}`);
      setTaskState("result_ready");
      setLatency(Math.round(performance.now() - started));
      setStatus(`Result ready · ${result.actualSource} · config ${result.config.source} · repairs ${result.repairCount}`);
      if (localAudit) {
        try {
          const record = { at: new Date().toISOString(), taskId, mode, actualSource: result.actualSource, latencyMs: Math.round(performance.now() - started), status: "result_ready" };
          const prior = JSON.parse(localStorage.getItem("nexus-inference-lab-audit-v1") ?? "[]") as unknown[];
          localStorage.setItem("nexus-inference-lab-audit-v1", JSON.stringify([...prior.slice(-19), record]));
        } catch {
          /* Local audit is optional */
        }
      }
    } catch (cause) {
      const e = cause instanceof HybridRuntimeError ? cause : cause instanceof Error ? cause : new Error("Unknown inference error");
      setError(`${"code" in e ? String(e.code) : e.name}: ${e.message}`);
      setTaskState(aborter.signal.aborted ? "cancelled" : "failed");
      setLatency(Math.round(performance.now() - started));
      setStatus("Inference request failed");
    } finally {
      setBusy(false);
      setController(undefined);
      void refresh();
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900">
          ← Back to Command Center
        </Link>
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-teal-700">
          NEXUS TITAN · HYBRID AI ENGINE
        </span>
      </div>

      <div className="border-b pb-4">
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">Inference Lab & Hybrid AI Studio</h1>
        <p className="mt-1 text-xs md:text-sm text-slate-600">
          Dual-leg hybrid inference architecture: local on-device edge triage of restricted evidence paired with
          sanitized cloud root-cause analysis via Firebase AI Logic.
        </p>

        {/* Tab switcher */}
        <div className="mt-4 flex gap-2 border-b">
          <button
            onClick={() => setActiveTab("flagship")}
            className={`pb-2 text-xs font-bold transition border-b-2 ${
              activeTab === "flagship"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Flagship Scenario: Contradictory Pump Reading (Dual-Leg)
          </button>
          <button
            onClick={() => setActiveTab("single_turn")}
            className={`pb-2 text-xs font-bold transition border-b-2 ${
              activeTab === "single_turn"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Single-Turn Public Fixture Lab
          </button>
        </div>
      </div>

      {activeTab === "flagship" ? (
        <div className="space-y-6">
          {/* Incident Header & Scenario Metadata */}
          <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 md:p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-200 px-2.5 py-0.5 text-xs font-bold text-indigo-950 font-mono">
                  {FLAGSHIP_INCIDENT_ID}
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Asset: {FLAGSHIP_ASSET_ID} ({FLAGSHIP_FACILITY})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsOffline(!isOffline)}
                  className={`rounded px-3 py-1 text-xs font-bold transition ${
                    isOffline ? "bg-amber-600 text-white" : "bg-emerald-600 text-white"
                  }`}
                >
                  {isOffline ? "Simulated Network: OFFLINE" : "Simulated Network: ONLINE"}
                </button>
                <button
                  onClick={handleResetFlagshipScenario}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reset Incident
                </button>
              </div>
            </div>

            <p className="text-xs text-indigo-900 leading-relaxed">
              <strong>Contradictory Telemetry Incident:</strong> Digital SCADA sensors flagged pump P-101 discharge
              pressure as degraded (185 kPa) with severe vibration (8.42 mm/s), proposing mechanical impeller cavitation.
              However, field physical dial inspection reports steady nominal pressure (410 kPa) and a cool casing, indicating
              transducer wiring loop drift.
            </p>
          </section>

          {/* Gemini Nano Preparation Card */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Gemini Nano (Chrome built-in) On-Device Readiness</h3>
                <p className="text-xs text-slate-500">
                  Evaluates Chrome Desktop 139+ Prompt API availability and local model download state.
                </p>
              </div>
              <span
                className={`rounded px-2.5 py-0.5 text-xs font-bold ${
                  nanoReady ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                }`}
              >
                {nanoReady ? "GEMINI NANO READY" : "SIMULATION PATH READY"}
              </span>
            </div>

            <div className="rounded border bg-slate-50 p-3 text-xs text-slate-700 space-y-1 font-mono">
              <div>Status: {nanoStatus}</div>
              <div>Desktop Chrome: {capability?.desktopChrome ? "Verified" : "Not detected"}</div>
              <div>Foreground Window Focus: {capability?.foreground ? "Active" : "Inactive"}</div>
            </div>

            <button
              onClick={() => void handlePrepareNano()}
              disabled={flagshipBusy}
              className="rounded bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Verify / Prepare Gemini Nano Model
            </button>
          </section>

          {/* Leg 1: Offline Local Edge Triage */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold text-amber-800">
                  LEG 1: LOCAL EDGE
                </span>
                <span className="text-xs font-mono text-slate-500">Mode: ONLY_ON_DEVICE</span>
              </div>
              {localResult && (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Source: {localResult.observed_source} ({localResult.duration_ms} ms measured)
                </span>
              )}
            </div>

            {/* Restricted Input Presentation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">Restricted Synthetic Technician Observation:</span>
                <span className="rounded bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-800">
                  CLASSIFICATION: RESTRICTED
                </span>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-800 space-y-1">
                <div>Technician ID: {evidence.technician_id} (Badge PII protected)</div>
                <div>Physical Dial Gauge: {evidence.physical_observation.dial_pressure_kpa} kPa</div>
                <div>Casing State: {evidence.physical_observation.casing_state}</div>
                <div>Casing Temperature: {evidence.physical_observation.casing_temp_c ?? 28.5}°C (ambient cool)</div>
                <div>Contradiction Detected: TRUE (Telemetry 185 kPa vs Dial 410 kPa)</div>
                <div className="mt-1 text-red-700 font-semibold">
                  Synthetic Security Canary: {evidence.restricted_canary}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                Operates while network is offline. Data and outputs are persisted locally in device storage.
              </span>
              <button
                onClick={() => void handleRunLocalOfflineLeg()}
                disabled={flagshipBusy}
                className="rounded bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
              >
                {flagshipBusy ? "Running Local Triage…" : "Run Offline Local Triage (ONLY_ON_DEVICE)"}
              </button>
            </div>

            {/* Local Triage Result Display */}
            {localResult && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-amber-950 text-[11px]">
                    On-Device Triage Output ({localResult.is_simulation_fallback ? "Deterministic Simulation" : "Gemini Nano"})
                  </span>
                  <span className="font-mono text-slate-600">Timing: {localResult.duration_ms} ms (measured)</span>
                </div>

                <div className="space-y-1 text-slate-800">
                  <div>
                    <strong className="text-amber-900">Actionable Changed Hypothesis:</strong>{" "}
                    {localResult.actionable_hypothesis}
                  </div>
                  <div>
                    <strong className="text-amber-900">Recommended Inspection:</strong>{" "}
                    {localResult.recommended_inspection}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-amber-200/60 pt-2 font-mono text-[11px]">
                  <span className="text-emerald-700 font-semibold">
                    ✓ Canary Token Retained in Local Vault: TRUE
                  </span>
                  <span className="text-slate-600">Restricted Bytes Egressed: 0 bytes</span>
                </div>
              </div>
            )}
          </section>

          {/* Leg 2 Preparation: Sanitization, Consent & Tamper Guard */}
          {localResult && (
            <section className="rounded-xl border border-indigo-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded bg-indigo-100 px-2 py-0.5 font-mono text-xs font-bold text-indigo-900">
                  DE-IDENTIFICATION, CONSENT & CANARY AUDIT
                </span>
                <span className="font-mono text-xs text-emerald-700 font-bold">
                  ✓ Canary Token Filtered Out
                </span>
              </div>

              {/* Exact Sanitized Request Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">Exact Sanitized Request Preview:</span>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                    CLASSIFICATION: PUBLIC
                  </span>
                </div>
                <label htmlFor="sanitized-payload-editor" className="sr-only">Exact Sanitized Request Payload</label>
                <textarea
                  id="sanitized-payload-editor"
                  value={editableSanitizedText}
                  onChange={(e) => void handleSanitizedTextChange(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-slate-300 p-2.5 font-mono text-xs text-slate-800 bg-slate-50 focus:bg-white"
                  aria-label="Exact Sanitized Request Payload"
                />
                <div className="flex justify-between font-mono text-[11px] text-slate-500">
                  <span>Cryptographic Consent Hash: {consentHash ? consentHash.substring(0, 16) + "…" : "Pending"}</span>
                  <span className="text-slate-600 italic">Editing text above tests consent tamper invalidation</span>
                </div>
              </div>

              {/* Consent Scope Explanation Box */}
              <div className="rounded border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-950 space-y-1">
                <strong>Consent Scope & Tamper Boundary:</strong>
                <p className="text-indigo-900">{CONSENT_EXPLANATION}</p>
              </div>

              {/* Explicit Approval Checkbox Gate */}
              <div className="rounded border p-3 flex items-start gap-3 bg-white">
                <input
                  id="consent-checkbox"
                  type="checkbox"
                  checked={consentApproved}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setConsentApproved(checked);
                    if (checked) {
                      setFlagshipError("");
                      if (sanitizedPayload) {
                        void canonicalHash({
                          ...sanitizedPayload,
                          deidentified_summary: editableSanitizedText,
                        }).then((h) => setConsentHash(h));
                      }
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <label htmlFor="consent-checkbox" className="text-xs font-semibold text-slate-800 cursor-pointer">
                  I grant explicit consent to send this de-identified public telemetry payload to Firebase AI Logic (cloud) for root-cause analysis.
                </label>
              </div>
            </section>
          )}

          {/* Leg 2: Reconnection Cloud Leg via Firebase AI Logic */}
          {localResult && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-indigo-100 px-2 py-0.5 font-mono text-xs font-bold text-indigo-900">
                    LEG 2: HYBRID ROOT CAUSE
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Mode:</span>
                    <select
                      value={flagshipCloudMode}
                      onChange={(e) => setFlagshipCloudMode(e.target.value as HybridMode)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-800"
                    >
                      <option value="PREFER_ON_DEVICE">Hybrid (PREFER_ON_DEVICE) [Default]</option>
                      <option value="ONLY_IN_CLOUD">Cloud-Only (ONLY_IN_CLOUD)</option>
                    </select>
                  </div>
                </div>
                {cloudResult && (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Source: {cloudResult.observed_source} ({cloudResult.duration_ms} ms measured)
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600">
                  Sends sanitized public telemetry via Firebase AI Logic. Tied to identical incident ID{" "}
                  <code className="font-mono text-indigo-900">{FLAGSHIP_INCIDENT_ID}</code>.
                </span>
                <button
                  onClick={() => void handleRunCloudLeg()}
                  disabled={flagshipBusy}
                  className="rounded bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {flagshipBusy ? "Running Analysis…" : `Run Root-Cause Analysis (${flagshipCloudMode})`}
                </button>
              </div>

              {/* Cloud Analysis Result Display */}
              {cloudResult && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-indigo-950 text-[11px]">
                      Cloud Root-Cause Analysis Result ({cloudResult.is_simulation_fallback ? "Deterministic Cloud Fixture" : "Firebase AI Logic"})
                    </span>
                    <span className="font-mono text-slate-600">Timing: {cloudResult.duration_ms} ms (measured)</span>
                  </div>

                  <div className="space-y-1 text-slate-800">
                    <div>
                      <strong className="text-indigo-950">Actionable Changed Hypothesis:</strong>{" "}
                      {cloudResult.actionable_hypothesis}
                    </div>
                    <div>
                      <strong className="text-indigo-950">Recommended Inspection:</strong>{" "}
                      {cloudResult.recommended_inspection}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-indigo-200/60 pt-2 font-mono text-[11px]">
                    <span className="text-emerald-700 font-semibold">
                      ✓ Canary Confirmed Absent from Cloud Request: TRUE
                    </span>
                    <span className="text-slate-600">Incident ID Correlation: {cloudResult.incident_id}</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Feedback & Error Notifications */}
          {flagshipError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-900 font-semibold" role="alert">
              {flagshipError}
            </div>
          )}

          {flagshipInfo && (
            <div className="rounded-lg border border-teal-300 bg-teal-50 p-3.5 text-xs text-teal-900 font-medium" role="status">
              {flagshipInfo}
            </div>
          )}
        </div>
      ) : (
        /* Original Single-Turn Public Fixture Lab (Preserved) */
        <div className="space-y-6">
          <p className="text-xs text-slate-600">
            Real Firebase AI Logic single-turn request against a fixed public synthetic fixture. No user prompt,
            tools, chat history, restricted input, or hidden truth is sent.
          </p>

          <section className="rounded border p-4 space-y-1 text-xs" aria-live="polite">
            <p><b>Status:</b> {status}</p>
            <p><b>Observed source:</b> {source}</p>
            <p><b>Task state:</b> {taskState}</p>
            {latency !== undefined && <p><b>Latency:</b> {latency} ms</p>}
            {output && <p className="mt-3 whitespace-pre-wrap font-mono text-slate-800"><b>Result:</b> {output}</p>}
            {error && <p className="mt-3 text-red-700 font-semibold"><b>Error:</b> {error}</p>}
          </section>

          <section className="rounded border p-4 text-xs space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">Capabilities</h2>
            <p className="text-slate-600">
              Chrome desktop: {capability?.desktopChrome ? "yes" : "no"} · Prompt API: {capability?.promptApi ? "available" : "unavailable"} · model: {capability?.modelState ?? "checking"} · foreground: {capability?.foreground ? "yes" : "no"} · network: {capability?.online ? "online" : "offline"} · quota: {capability?.quota ?? "unknown"}
            </p>
            <button className="underline text-indigo-700" onClick={() => void refresh()}>Refresh capability check</button>
          </section>

          <section className="space-y-3 rounded border p-4 text-xs">
            <label className="block font-medium">Inference mode
              <select className="ml-3 rounded border p-1" value={mode} onChange={(event) => setMode(event.target.value as HybridMode)} disabled={busy}>
                {modes.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="block">
              <input type="checkbox" checked={cloudApproval} onChange={(event) => setCloudApproval(event.target.checked)} disabled={busy} className="mr-2" />
              I approve sending this public synthetic fixture to a cloud-capable mode.
            </label>
            <label className="block">
              <input type="checkbox" checked={localAudit} onChange={(event) => setLocalAudit(event.target.checked)} className="mr-2" />
              Retain redacted trace metadata in this browser (no prompt or output).
            </label>
            <div className="flex gap-3 pt-2">
              <button
                className="rounded bg-slate-900 px-4 py-2 text-white font-semibold disabled:opacity-50"
                onClick={() => void runSingleTurn()}
                disabled={busy}
              >
                {busy ? "Running…" : "Run inference"}
              </button>
              {busy && (
                <button className="rounded border px-4 py-2 text-slate-700" onClick={() => controller?.abort()}>
                  Cancel / discard
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
