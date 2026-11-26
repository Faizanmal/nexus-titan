"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { enqueueSafeChange, listOffline, putOffline, sealRestricted, type DurableTask } from "@nexus-titan/hybrid-web";
import { useWorkspaceSelection } from "@/components/command-center-shell";

type Finding = { assetId: string; finding: string; severity: "low" | "moderate" | "high"; classification: "public" | "internal" | "confidential" | "restricted" };
export default function FieldRelayPage() {
  const { tenantId, siteId } = useWorkspaceSelection();
  const [assetId, setAssetId] = useState("TITAN-WTP-01-P-001");
  const [finding, setFinding] = useState("");
  const [severity, setSeverity] = useState<Finding["severity"]>("low");
  const [classification, setClassification] = useState<Finding["classification"]>("internal");
  const [manual, setManual] = useState("");
  const [rows, setRows] = useState<DurableTask[]>([]);
  const [message, setMessage] = useState("Loading local queue…");
  const [trace, setTrace] = useState("No inference attempted. Manual entry is not labeled AI.");
  const [review, setReview] = useState("");
  const [localReady, setLocalReady] = useState(false);
  const [policyLeaseAvailable] = useState(false);
  const [assetCache, setAssetCache] = useState("Checking cached public fixture…");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const visibleRows = rows.filter((row) => Boolean(tenantId) && row.tenantId === tenantId);

  const refresh = useCallback(async () => {
    try {
      const [events, states] = await Promise.all([listOffline<DurableTask>("outbox"), listOffline<{taskId: string; state: DurableTask["state"]}>("outbox_states")]);
      const stateById = new Map(states.map((state) => [state.taskId, state.state]));
      setRows(events.filter((row) => Boolean(tenantId) && row.tenantId === tenantId).map((row) => ({ ...row, state: stateById.get(row.id) ?? "queued" })).sort((a, b) => b.createdAt - a.createdAt));
    }
    catch { setMessage("Offline storage is unavailable in this browser."); }
  }, [tenantId]);
  useEffect(() => {
    void refresh();
    void fetch("/fixtures/TITAN-WTP-01/world.json").then(async (response) => {
      if (!response.ok) throw new Error("Fixture unavailable");
      const body = await response.json();
      const stale = response.headers.get("X-Nexus-Cache") === "stale-possible";
      await putOffline("snapshots", { id: "public-world-fixture-v1", tenantId: tenantId || "demo-nexus", capturedAt: Date.now(), stale, body });
      setAssetCache(stale ? "Showing saved synthetic fixture; snapshot may be stale." : "Public synthetic asset snapshot refreshed locally.");
    }).catch(async () => {
      const cached = await import("@nexus-titan/hybrid-web").then((module) => module.getOffline("snapshots", "public-world-fixture-v1")).catch(() => undefined);
      setAssetCache(cached ? "Showing saved synthetic fixture; snapshot may be stale." : "No fixture snapshot cached yet. Prepare online first.");
    });
    const check = async () => {
      const api = (window as unknown as { LanguageModel?: { availability?: () => Promise<string> } }).LanguageModel;
      setLocalReady(Boolean(api && (await api.availability?.()) === "available"));
    };
    void check();
  }, [tenantId, refresh]);

  async function inferLocally() {
    if (!policyLeaseAvailable) { setTrace("Inference blocked: no server-issued offline policy lease is available in this build."); return; }
    const api = (window as unknown as { LanguageModel?: { availability?: () => Promise<string>; create?: () => Promise<{ prompt: (text: string) => Promise<string>; destroy?: () => void }> } }).LanguageModel;
    if (!api || !api.create || (await api.availability?.()) !== "available" || document.visibilityState !== "visible" || !document.hasFocus()) {
      setTrace("Local model unavailable or page not foregrounded. No inference was run; use manual entry."); return;
    }
    setTrace("Running foreground on-device inference…");
    let session: Awaited<ReturnType<NonNullable<typeof api.create>>> | undefined;
    try {
      session = await api.create();
      const result = await session.prompt(`For this synthetic inspection fixture only, suggest a concise observation. Return plain text, no diagnosis. Asset ${assetId}. Manual note: ${manual || "none"}.`);
      setFinding(result.slice(0, 600));
      setTrace("On-device Prompt API returned a suggestion. Review and edit before saving; model output is not a verified diagnosis.");
      await putOffline("attempts", { id: crypto.randomUUID(), tenantId, at: Date.now(), source: "ON_DEVICE", status: "result_ready" });
    } catch { setTrace("On-device inference failed. No cloud fallback was attempted."); }
    finally { session?.destroy?.(); }
  }

  async function saveDraft() {
    if (!finding.trim()) { setMessage("Enter or review a finding first."); return; }
    if (!tenantId) { setMessage("Select an authorized organization before saving a scoped local draft."); return; }
    const item: Finding = { assetId: assetId.trim(), finding: finding.trim(), severity, classification };
    const id = crypto.randomUUID();
    const task: DurableTask = { id, tenantId, state: "queued", attempts: 0, nextAttemptAt: Date.now(), safeEvent: item, createdAt: Date.now() };
    try {
      await enqueueSafeChange(task, classification);
      setReview(JSON.stringify({ ...item, siteId, evidence: evidenceFile ? { name: evidenceFile.name.replace(/[\\/]/g, "_"), type: evidenceFile.type || "unknown", bytes: evidenceFile.size, sharing: "metadata_only_file_bytes_not_queued" } : null }, null, 2)); setMessage("Safe draft queued locally. Evidence file bytes remain local and are not in the outbox. Server sync requires a current server policy lease, which this build does not issue.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save draft."); }
  }

  async function saveRestrictedLocally() {
    if (classification !== "restricted" || !finding.trim() || !tenantId) { setMessage("Select restricted, choose an authorized organization and enter the finding to save it in the encrypted local vault."); return; }
    try { const id = crypto.randomUUID(); await sealRestricted(tenantId, id, "restricted", { assetId, finding: finding.trim(), severity, evidenceName: evidenceFile?.name.replace(/[\\/]/g, "_"), savedAt: Date.now() }); setMessage("Restricted finding encrypted in this browser's local vault. Evidence bytes remain local and the record cannot be queued for sync."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Vault save failed."); }
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header><Link className="underline" href="/mission">Mission Control</Link><h1 className="mt-3 text-3xl font-semibold">Field inspection</h1><p className="text-xs">Workspace {tenantId || "not selected"} · {siteId || "no site selected"}</p>
      <p className="mt-2 text-sm text-slate-600">Prepared sessions only. The cached shell does not provide first-run offline access or server authorization.</p></header>
    <section className="grid gap-4 rounded border p-5 md:grid-cols-2">
      <p className="md:col-span-2 text-sm">{assetCache}</p>
      <label>Cached asset / scan fixture<select className="mt-1 block w-full rounded border p-2" value={assetId} onChange={(e) => setAssetId(e.target.value)}><option>TITAN-WTP-01-P-001</option><option>TITAN-WTP-01-P-002</option><option>Public router image fixture</option></select></label>
      <label>Evidence file (local preview only)<input className="mt-1 block w-full rounded border p-2" type="file" accept="image/*,application/pdf,text/plain" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file && file.size > 10 * 1024 * 1024) { setEvidenceFile(null); setMessage("Evidence file exceeds the 10 MiB local preview limit."); return; } setEvidenceFile(file); }} /><span className="text-xs">{evidenceFile ? `${evidenceFile.name} · ${evidenceFile.size} bytes · bytes are not added to the share outbox` : "No evidence file selected. Maximum 10 MiB."}</span></label>
      <label>Classification<select className="mt-1 block w-full rounded border p-2" value={classification} onChange={(e) => setClassification(e.target.value as Finding["classification"])}><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential (local only)</option><option value="restricted">Restricted (vault only; cannot queue)</option></select></label>
      <label className="md:col-span-2">Manual entry path (not AI)<textarea className="mt-1 block w-full rounded border p-2" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Type an observation manually" /></label>
      <div className="flex items-center gap-3 md:col-span-2"><button className="rounded border px-3 py-2 disabled:opacity-50" disabled={!localReady || !policyLeaseAvailable} onClick={() => void inferLocally()}>Run local inference</button><span className="text-sm">{localReady ? "Local model reports ready" : "Local model unavailable"} · {!policyLeaseAvailable ? "No server-issued offline policy lease; inference is disabled." : ""}</span></div>
      <label>Structured finding<textarea className="mt-1 block w-full rounded border p-2" value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="Edit the finding before review" /></label>
      <label>Severity<select className="mt-1 block w-full rounded border p-2" value={severity} onChange={(e) => setSeverity(e.target.value as Finding["severity"])}><option>low</option><option>moderate</option><option>high</option></select></label>
      <p className="md:col-span-2 text-sm">Trace: {trace}</p>
      <button className="w-fit rounded border px-3 py-2" onClick={() => setReview(JSON.stringify({ assetId, siteId, finding, severity, classification, evidence: evidenceFile ? { name: evidenceFile.name.replace(/[\\/]/g, "_"), type: evidenceFile.type || "unknown", bytes: evidenceFile.size, sharing: "metadata_only_file_bytes_not_queued" } : null }, null, 2))}>Review share artifact</button>
      <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{review || "Review artifact preview appears here."}</pre>
      <button disabled={!tenantId} className="w-fit rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50" onClick={() => void saveDraft()}>Queue safe draft</button>
      {classification === "restricted" && <button className="w-fit rounded border px-3 py-2" onClick={() => void saveRestrictedLocally()}>Save encrypted to local vault</button>}
      <p role="status" className="text-sm">{message}</p>
    </section>
    <section className="rounded border p-5"><h2 className="text-xl font-semibold">Durable local outbox</h2><p className="text-sm text-slate-600">Outbox event rows are append-only; delivery state is tracked separately. Restricted and confidential records are excluded. Pending drafts survive refresh on this device.</p>
      <ul className="mt-3 space-y-2">{visibleRows.map((row) => <li key={row.id} className="rounded border p-3 text-sm"><strong>{row.state}</strong> · {new Date(row.createdAt).toLocaleString()} · {JSON.stringify(row.safeEvent)}</li>)}</ul>
    </section>
  </main>;
}
