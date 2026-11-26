"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { identityApi, IdentityApiError } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";
import { EmptyState, ErrorState, LoadingState, StatusIndicator } from "@/components/command-center-primitives";

type Asset = { asset_id: string; asset_type: string; state?: Record<string, unknown> };
type Incident = { incident_id: string; site_id: string; label: string; status: string; classification: string; affected_asset_ids: string[]; state: Record<string, unknown> };
type Snapshot = { cursor: number; assets: Asset[]; incidents: Incident[] };
type Investigation = { investigation_id: string; incident_id: string; status: string; hypotheses: Array<{ hypothesis_id: string; cause_type: string; root_asset_id: string; relative_support_score: number; uncertainty: { level: string; reasons: string[] } }>; contradiction_flags: Array<{ code: string; detail: string }>; timeline: Array<{ at: string; source_id: string; metric: string; robust_z: number }> };
type Run = { run_id: string; site_id: string; state: string; created_at: string };
type RunTrace = Run & { roles: Array<{ role_name: string; executor: string; state: string }> };
type Simulation = { simulation_id: string; status: string; result: { scenarios?: Array<{ intervention: string; pressure_by_node_kpa_gauge: Record<string, number>; energy_kwh_proxy: number; downtime_hours_proxy: number }> } | null; approvals: Array<{ approval_id: string; state: string; action: { intervention?: string } }> };
type Event = { event_id: string; sequence: number; event_type: string; occurred_at: string; aggregate_id: string; site_id: string; aggregate_type?: string };
type EventPage = { events: Event[]; cursor: number; has_more: boolean };

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const { tenantId, siteId, role } = useWorkspaceSelection();
  const incidentId = decodeURIComponent(params.id);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runTraces, setRunTraces] = useState<RunTrace[]>([]);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [timeline, setTimeline] = useState<Event[]>([]);
  const [timelineTruncated, setTimelineTruncated] = useState(false);
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const canWrite = role !== null && ["owner", "admin", "operator"].includes(role);
  const scopedIncident = loadedScope === `${tenantId}/${siteId}` ? incident : null;

  const load = useCallback(async () => {
    if (!tenantId || !siteId) { setLoading(false); return; }
    setLoading(true); setError(""); setConflict(false);
    setIncident(null); setLoadedScope(""); setAssets([]); setInvestigations([]); setRuns([]); setRunTraces([]); setSimulations([]); setTimeline([]); setTimelineTruncated(false);
    const query = `tenant_id=${encodeURIComponent(tenantId)}&site_id=${encodeURIComponent(siteId)}`;
    try {
      const snapshot = await identityApi<Snapshot>(`/v1/world/snapshot?${query}`);
      const found = snapshot.incidents.find((item) => item.incident_id === incidentId) ?? null;
      if (!found) throw new Error("Incident is unavailable in the selected authorized site. It may have been resolved, moved or revoked.");
      setIncident(found);
      setLoadedScope(`${tenantId}/${siteId}`);
      const linked = new Set(found.affected_asset_ids);
      setAssets(snapshot.assets.filter((asset) => linked.has(asset.asset_id)));
      const [investigationResult, runResult, simulationResult] = await Promise.allSettled([
        identityApi<{ investigations: Investigation[] }>(`/v1/causal/investigations?${query}`),
        identityApi<{ runs: Run[] }>(`/v1/agents/runs?tenant_id=${encodeURIComponent(tenantId)}`),
        identityApi<{ simulations: Simulation[] }>(`/v1/simulations/scenarios?${query}`),
      ]);
      setInvestigations(investigationResult.status === "fulfilled" ? investigationResult.value.investigations.filter((item) => item.incident_id === incidentId) : []);
      const siteRuns = runResult.status === "fulfilled" ? runResult.value.runs.filter((item) => item.site_id === siteId) : [];
      setRuns(siteRuns);
      const traces = await Promise.allSettled(siteRuns.slice(0, 3).map((item) => identityApi<RunTrace>(`/v1/agents/runs/${encodeURIComponent(item.run_id)}`)));
      setRunTraces(traces.flatMap((result) => result.status === "fulfilled" && result.value.site_id === siteId ? [result.value] : []));
      setSimulations(simulationResult.status === "fulfilled" ? simulationResult.value.simulations : []);
      let after = 0; const collected: Event[] = []; let more = false;
      for (let batch = 0; batch < 5; batch++) {
        const page = await identityApi<EventPage>(`/sync/events?tenant_id=${encodeURIComponent(tenantId)}&after_sequence=${after}&limit=500`);
        collected.push(...page.events.filter((event) => event.site_id === siteId && event.aggregate_type === "incident" && event.aggregate_id === incidentId));
        after = page.cursor; more = page.has_more;
        if (!more) break;
      }
      setTimeline(collected.slice(-100)); setTimelineTruncated(more);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Incident detail could not be loaded.";
      setError(message); setConflict(/revision|conflict|stale|changed/i.test(message)); setIncident(null);
    } finally { setLoading(false); }
  }, [tenantId, siteId, incidentId]);

  useEffect(() => { void load(); }, [load]);

  async function startInvestigation() {
    if (!tenantId || !siteId || !scopedIncident || busy) return;
    setBusy(true); setError(""); setConflict(false);
    try {
      await identityApi<Investigation>("/v1/causal/investigations", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, site_id: siteId, incident_id: incidentId, idempotency_key: `mission-incident:${incidentId}` }) });
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Investigation could not be started.";
      setError(message); setConflict((reason instanceof IdentityApiError && (reason.status === 409 || reason.code?.includes("CONFLICT"))) || /revision|conflict|stale|changed/i.test(message));
    } finally { setBusy(false); }
  }

  async function startAgentRun() {
    if (!tenantId || !siteId || !scopedIncident || busy) return;
    setBusy(true); setError(""); setConflict(false);
    try {
      await identityApi("/v1/agents/runs", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, site_id: siteId, idempotency_key: `incident-run:${incidentId}`, input: { incident_id: incidentId, source: "mission_incident_workspace" } }) });
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Incident agent run could not be queued.";
      setError(message); setConflict((reason instanceof IdentityApiError && (reason.status === 409 || reason.code?.includes("CONFLICT"))) || /revision|conflict|stale|changed/i.test(message));
    } finally { setBusy(false); }
  }

  if (!tenantId || !siteId) return <main className="space-y-4"><h1 className="text-3xl font-semibold">Incident workspace</h1><EmptyState title="Choose an authorized site" detail="Select the incident's organization and site in the command bar." /></main>;
  return <main className="space-y-5">
    <nav aria-label="Breadcrumb" className="text-sm text-slate-600"><Link href="/mission" className="underline">Mission Control</Link> / Incident</nav>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-600">{incidentId}</p><h1 className="mt-1 text-3xl font-semibold">{scopedIncident?.label ?? "Incident workspace"}</h1><p className="text-sm text-slate-600">Canonical state, linked evidence, investigations and simulation approval entry.</p></div>{scopedIncident && <StatusIndicator label={`${scopedIncident.status} · severity ${String(scopedIncident.state.severity ?? "unspecified")}`} detail={`${scopedIncident.classification.toUpperCase()} · ${siteId}`} tone={scopedIncident.status === "resolved" ? "online" : "warning"} />}</header>
    {error && <ErrorState title={conflict ? "Incident changed" : "Incident request failed"} detail={conflict ? `${error} Refresh before retrying so you do not act on stale state.` : error} retry={() => void load()} />}
    {loading && !scopedIncident && <LoadingState label="Loading canonical incident and evidence…" />}
    {scopedIncident && <>
      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <article className="space-y-3 rounded-lg border p-4"><h2 className="text-lg font-semibold">Evidence and affected assets</h2><p className="text-sm">Incident state {scopedIncident.status} · revision-backed canonical projection · {scopedIncident.classification.toUpperCase()}</p><h3 className="font-medium">Linked assets</h3>{assets.length ? <ul className="flex flex-wrap gap-2">{assets.map((asset) => <li key={asset.asset_id}><Link className="rounded border px-3 py-2 font-mono text-sm underline" href={`/telemetry?asset_id=${encodeURIComponent(asset.asset_id)}`}>{asset.asset_id} · {asset.asset_type}</Link></li>)}</ul> : <p className="text-sm">No linked assets are visible in this site&apos;s current projection.</p>}
          <h3 className="font-medium">Source evidence</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{JSON.stringify(scopedIncident.state, null, 2)}</pre>
        </article>
        <article className="space-y-3 rounded-lg border p-4"><h2 className="text-lg font-semibold">Investigation and actions</h2><p className="text-sm text-slate-600">Server validates tenant, site, role and incident visibility. Duplicate action is idempotent for this incident.</p><div className="flex flex-wrap gap-2"><button disabled={!canWrite || busy || scopedIncident.status === "resolved"} onClick={() => void startInvestigation()} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{busy ? "Working…" : "Start investigation"}</button><button disabled={!canWrite || busy} onClick={() => void startAgentRun()} className="rounded border px-4 py-2 disabled:opacity-50">Queue incident agent run</button><Link className="rounded border px-4 py-2" href={`/simulation?incident_id=${encodeURIComponent(incidentId)}`}>Simulation compare and approvals</Link></div>{!canWrite && <p className="text-xs">Your current role is read-only. Ask an organization owner/admin to change access.</p>}
          <h3 className="pt-2 font-medium">Competing hypotheses and contradictions</h3>{investigations.length ? investigations.map((run) => <div key={run.investigation_id} className="rounded border p-3"><p className="text-xs">{run.investigation_id} · {run.status}</p>{run.hypotheses.map((hypothesis) => <p key={hypothesis.hypothesis_id} className="mt-2 text-sm">{hypothesis.cause_type.replaceAll("_", " ")} at {hypothesis.root_asset_id} · {hypothesis.relative_support_score} relative points · uncertainty {hypothesis.uncertainty.level}</p>)}{run.contradiction_flags.map((item) => <p key={item.code} role="status" className="mt-2 rounded bg-amber-50 p-2 text-sm">Contradiction {item.code}: {item.detail}</p>)}</div>) : <p className="text-sm text-slate-600">No persisted investigation result is linked to this incident yet.</p>}
        </article>
      </section>
      <section className="rounded-lg border p-4"><h2 className="text-lg font-semibold">Agent DAG snapshots</h2>{runs.length ? <ul className="mt-2 space-y-3">{runTraces.map((run) => <li key={run.run_id} className="rounded border p-3"><div className="flex flex-wrap justify-between gap-2"><Link className="font-mono text-xs underline" href={`/agents?run_id=${encodeURIComponent(run.run_id)}`}>{run.run_id}</Link><span className="text-sm">{run.state} · {new Date(run.created_at).toLocaleString()}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-3">{run.roles.map((node) => <span key={node.role_name} className="rounded border px-2 py-1 text-xs">{node.role_name} · {node.state} · {node.executor === "client_model" ? "client model" : "deterministic tool"}</span>)}</div></li>)}</ul> : <p className="mt-2 text-sm">No site agent runs have been returned by the API.</p>}</section>
      <section className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-semibold">Canonical incident timeline</h2><span className="text-xs text-slate-600">{timeline.length} events · bounded to 100 displayed</span></div>{timelineTruncated && <p role="status" className="mt-2 text-xs">Event history was truncated at the bounded read limit; earlier events may be omitted.</p>}{timeline.length ? <ol className="mt-3 space-y-2">{timeline.map((event) => <li key={event.event_id} className="border-l-2 border-slate-500 pl-3 text-sm"><strong>{event.event_type}</strong><span className="block text-xs text-slate-600">Sequence {event.sequence} · {new Date(event.occurred_at).toLocaleString()}</span></li>)}</ol> : <p className="mt-2 text-sm text-slate-600">No canonical events were returned for this incident.</p>}</section>
      <section className="space-y-3 rounded-lg border p-4"><h2 className="text-lg font-semibold">Site simulation comparisons and approval entry</h2><p className="text-sm text-slate-600">Comparisons are site-scoped; existing scenarios are not attributed to this incident unless their source explicitly says so. Approvals remain bound to the scenario snapshot and exact action.</p>{simulations.length ? <ul className="grid gap-3 md:grid-cols-2">{simulations.slice(0, 4).map((simulation) => <li key={simulation.simulation_id} className="rounded border p-3"><p className="font-mono text-xs">{simulation.simulation_id} · {simulation.status}</p>{simulation.result?.scenarios?.map((scenario) => <p key={scenario.intervention} className="mt-2 text-sm">{scenario.intervention.replaceAll("_", " ")} · consumer {scenario.pressure_by_node_kpa_gauge.consumer} kPa · {scenario.energy_kwh_proxy} kWh proxy · {scenario.downtime_hours_proxy} h proxy</p>)}{simulation.approvals.map((approval) => <p key={approval.approval_id} className="mt-2 text-xs">Approval {approval.approval_id} · {approval.action.intervention ?? "simulated action"} · {approval.state}</p>)}</li>)}</ul> : <p className="text-sm">No saved site simulations or approvals are visible.</p>}<Link href={`/simulation?incident_id=${encodeURIComponent(incidentId)}`} className="inline-flex rounded border px-4 py-2">Open simulation comparison and approval workspace</Link><p className="text-xs">{runs.length} site agent run(s) visible · canonical incident state is {scopedIncident.status}.</p></section>
    </>}
  </main>;
}
