"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { runFirebaseHybridTask, inspectCapabilities, HybridRuntimeError, type CapabilitySnapshot, type HybridMode, type InferenceSource, type LeasedInferenceTask } from "@nexus-titan/hybrid-web";
import { firebaseAppCheckClient, firebaseAuthClient } from "@/lib/firebase/client";
import { identityApi } from "@/lib/identity/api";
import { localDeviceId } from "@/lib/identity/device-key";

const modes: HybridMode[] = ["PREFER_ON_DEVICE", "ONLY_ON_DEVICE", "PREFER_IN_CLOUD", "ONLY_IN_CLOUD"];
const taskId = "lab-fixture-qa-001";
const fixtureText = "Fictional TITAN-WTP-01 pump P-004 shows a pressure sample of 300 kPa. This sample is synthetic and is not operational guidance.";

export default function InferenceLabPage() {
  const [mode, setMode] = useState<HybridMode>("ONLY_IN_CLOUD");
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

  const refresh = useCallback(async () => setCapability(await inspectCapabilities("text")), []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run() {
    setBusy(true); setError(""); setOutput(""); setSource("UNKNOWN"); setLatency(undefined); setTaskState("queued");
    const aborter = new AbortController(); setController(aborter);
    const started = performance.now(); setStatus("Running real Firebase AI Logic request…");
    try {
      const { app, auth } = firebaseAuthClient();
      if (!auth.currentUser) throw new Error("Sign in before requesting an inference task.");
      const tenantId = "demo-nexus";
      const siteId = "titan-wtp-01";
      const profile = await identityApi<{ uid: string; memberships: Array<{ organization_id: string; role: string }> }>("/v1/me");
      const membership = profile.memberships.find((item) => item.organization_id === tenantId);
      if (profile.uid !== auth.currentUser.uid || !membership) throw new Error("A matching active tenant membership is required.");
      const registeredDevices = await identityApi<{ devices: Array<{ device_id: string; client_device_id: string; status: string }> }>(
        `/v1/organizations/${encodeURIComponent(tenantId)}/devices`);
      const registeredDevice = registeredDevices.devices.find((item) => item.client_device_id === localDeviceId() && item.status === "registered");
      if (!registeredDevice) throw new Error("Register this browser as a trusted device before running the privacy gateway.");
      const caps = await inspectCapabilities("text"); setCapability(caps);
      const destination = mode === "ONLY_ON_DEVICE" ? "local_inference" : "cloud_inference";
      const privacyDecision = await identityApi<{
        allow: boolean; reason: string; policy_version: string; classification: "public" | "internal" | "confidential" | "restricted";
        role: string; tenant_id: string; device_trusted: boolean; tenant_match: boolean;
      }>(`/v1/organizations/${encodeURIComponent(tenantId)}/privacy/decisions`, {
        method: "POST",
        body: JSON.stringify({ site_id: siteId, device_id: registeredDevice.device_id, destination,
          purpose: destination === "local_inference" ? "approved_task" : "approved_summary",
          resource_refs: [{ aggregate_type: "asset", aggregate_id: "WTP01-PMP-004" }],
          consent: destination === "cloud_inference" ? cloudApproval : false }),
      });
      if (!privacyDecision.allow) throw new Error(`Server privacy policy denied this request (${privacyDecision.reason}).`);
      const task: LeasedInferenceTask = {
        task_id: taskId, tenant_id: tenantId, schema_version: "1.3.0", role_id: "fixture_qa", risk_tier: "low",
        lease_id: `local-lab-${crypto.randomUUID()}`, lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), classification: privacyDecision.classification,
        input: { text: fixtureText, modality: "text", template_id: "fixture-qa-v1", cloud_approved: cloudApproval },
      };
      setTaskState("running");
      const result = await runFirebaseHybridTask({ app, ensureAppCheck: () => { firebaseAppCheckClient(); }, signal: aborter.signal, task, mode, capabilities: caps,
        privacyDecision,
        onProgress: setStatus, onObservedSource: setSource });
      setOutput(`${result.summary}${result.caveats.length ? `\n\nCaveats: ${result.caveats.join("; ")}` : ""}`);
      setTaskState("result_ready");
      setLatency(Math.round(performance.now() - started));
      setStatus(`Result ready · ${result.actualSource} · config ${result.config.source} · repairs ${result.repairCount}`);
      if (localAudit) {
        try {
          const record = { at: new Date().toISOString(), taskId, mode, actualSource: result.actualSource, latencyMs: Math.round(performance.now() - started), status: "result_ready" };
          const prior = JSON.parse(localStorage.getItem("nexus-inference-lab-audit-v1") ?? "[]") as unknown[];
          localStorage.setItem("nexus-inference-lab-audit-v1", JSON.stringify([...prior.slice(-19), record]));
        } catch { /* Local audit is optional and cannot change inference outcome. */ }
      }
    } catch (cause) {
      const e = cause instanceof HybridRuntimeError ? cause : cause instanceof Error ? cause : new Error("Unknown inference error");
      setError(`${"code" in e ? String(e.code) : e.name}: ${e.message}`);
      setTaskState(aborter.signal.aborted ? "cancelled" : "failed");
      setLatency(Math.round(performance.now() - started));
      setStatus("Inference request failed");
    } finally { setBusy(false); setController(undefined); void refresh(); }
  }

  return <main className="mx-auto max-w-4xl space-y-6 p-8">
    <Link href="/" className="underline">← Home</Link>
    <p className="font-semibold tracking-widest text-teal-700">NEXUS TITAN · PHASE 08</p>
    <h1 className="text-3xl font-bold">Inference Lab</h1>
    <p>Real Firebase AI Logic single-turn request against a fixed public synthetic fixture. No user prompt, tools, chat history, restricted input, or hidden truth is sent.</p>
    <section className="rounded border p-4" aria-live="polite">
      <p><b>Status:</b> {status}</p><p><b>Observed source:</b> {source}</p>
      <p><b>Task state:</b> {taskState}</p>
      {latency !== undefined && <p><b>Latency:</b> {latency} ms</p>}
      {output && <p className="mt-3 whitespace-pre-wrap"><b>Result:</b> {output}</p>}
      {error && <p className="mt-3 text-red-700"><b>Error:</b> {error}</p>}
    </section>
    <section className="rounded border p-4">
      <h2 className="text-xl font-semibold">Capabilities</h2>
      <p>Chrome desktop: {capability?.desktopChrome ? "yes" : "no"} · Prompt API: {capability?.promptApi ? "available" : "unavailable"} · model: {capability?.modelState ?? "checking"} · foreground: {capability?.foreground ? "yes" : "no"} · network: {capability?.online ? "online" : "offline"} · quota: {capability?.quota ?? "unknown"}</p>
      <button className="mt-2 underline" onClick={() => void refresh()}>Refresh capability check</button>
    </section>
    <section className="space-y-3 rounded border p-4">
      <label className="block font-medium">Inference mode
        <select className="ml-3 rounded border p-2" value={mode} onChange={(event) => setMode(event.target.value as HybridMode)} disabled={busy}>
          {modes.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="block"><input type="checkbox" checked={cloudApproval} onChange={(event) => setCloudApproval(event.target.checked)} disabled={busy} /> I approve sending this public synthetic fixture to a cloud-capable mode.</label>
      <label className="block"><input type="checkbox" checked={localAudit} onChange={(event) => setLocalAudit(event.target.checked)} /> Retain redacted trace metadata in this browser (no prompt or output).</label>
      <p className="text-sm">Local lab lease: 5 minutes. Results are not submitted to the server because the agent result submission API is not implemented yet. Cancellation stops waiting and discards the result; Firebase SDK requests may not be interruptible mid-flight.</p>
      <div className="flex gap-3">
        <button className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50" onClick={() => void run()} disabled={busy}>{busy ? "Running…" : "Run inference"}</button>
        {busy && <button className="rounded border px-4 py-2" onClick={() => controller?.abort()}>Cancel / discard</button>}
      </div>
    </section>
    <p className="text-sm">A selected mode never proves inference source. The displayed source comes only from the SDK response; absent SDK metadata remains UNKNOWN. ONLY_ON_DEVICE rejects an unsupported or unavailable local path.</p>
  </main>;
}
