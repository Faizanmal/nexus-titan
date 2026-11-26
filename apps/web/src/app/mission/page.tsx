"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { identityApi } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";
import { EmptyState, ErrorState, LoadingState, OfflineState, StatusIndicator } from "@/components/command-center-primitives";

type Asset = { asset_id: string; name?: string; asset_type: string; status?: unknown; health?: unknown };
type Incident = { incident_id: string; site_id: string; label: string; status: string; severity?: string; classification: string; affected_asset_ids: string[]; state: Record<string, unknown> };
type Snapshot = { tenant_id: string; site_id: string; cursor: number; graph_version: string; assets: Asset[]; incidents: Incident[] };
type Run = { run_id: string; site_id: string; state: string; created_at: string };
type Scenario = { simulation_id: string; status: string; approvals?: Array<{ approval_id: string; state: string }> };
type Activity = { event_id: string; sequence: number; event_type: string; occurred_at: string; aggregate_type: string; aggregate_id: string; site_id: string };
type EventPage = { events: Activity[]; cursor: number; has_more: boolean };
type Telemetry = { asset_id: string; metric: string; unit: string; stale: boolean; availability: string; points: Array<{ sampled_at: string; value: number | null; quality: string }> };
type PeerInventory = { devices: Array<{ device_id: string; status: string }> };

const query = (tenant: string, site: string) => `tenant_id=${encodeURIComponent(tenant)}&site_id=${encodeURIComponent(site)}`;
const shortTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function MissionPage() {
  const { tenantId, siteId } = useWorkspaceSelection();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [peers, setPeers] = useState<PeerInventory["devices"]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  const [panelErrors, setPanelErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [lastReconciled, setLastReconciled] = useState("");
  const [cursorSeq, setCursorSeq] = useState(0);
  const cursor = useRef(0);
  const reconcileRef = useRef<() => Promise<void>>(async () => undefined);

  const reconcile = useCallback(async () => {
    if (!tenantId || !siteId) { setSnapshot(null); setLoading(false); return; }
    setLoading(true);
    setError("");
    const params = query(tenantId, siteId);
    let currentSnapshot: Snapshot | null = null;
    try {
      const next = await identityApi<Snapshot>(`/v1/world/snapshot?${params}`);
      currentSnapshot = next;
      setSnapshot(next);
      cursor.current = next.cursor;
      setCursorSeq(next.cursor);
      setLastReconciled(new Date().toISOString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Site snapshot could not be loaded.");
      setSnapshot(null);
    }
    const problems: string[] = [];
    const results = await Promise.allSettled([
      identityApi<{ runs: Run[] }>(`/v1/agents/runs?tenant_id=${encodeURIComponent(tenantId)}`),
      identityApi<{ simulations: Scenario[] }>(`/v1/simulations/scenarios?${params}`),
      identityApi<PeerInventory>(`/v1/organizations/${encodeURIComponent(tenantId)}/devices/peers`),
    ]);
    if (results[0].status === "fulfilled") setRuns(results[0].value.runs.filter((run) => run.site_id === siteId));
    else { setRuns([]); problems.push("Agent task inventory unavailable."); }
    if (results[1].status === "fulfilled") setScenarios(results[1].value.simulations);
    else { setScenarios([]); problems.push("Simulation approvals unavailable."); }
    if (results[2].status === "fulfilled") setPeers(results[2].value.devices.filter((device) => device.status === "registered"));
    else { setPeers([]); problems.push("Registered peer inventory unavailable."); }
    {
      const target = currentSnapshot?.assets.find((item) => item.asset_type === "pump") ?? currentSnapshot?.assets[0];
      if (target) {
        const end = new Date(); const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
        const telemetryQuery = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(params)), asset_id: target.asset_id, metric: "pressure", start: start.toISOString(), end: end.toISOString(), interval_seconds: "300" });
        try { setTelemetry(await identityApi<Telemetry>(`/v1/world/telemetry?${telemetryQuery}`)); }
        catch { setTelemetry(null); problems.push("Telemetry freshness could not be measured."); }
      } else setTelemetry(null);
    }
    setPanelErrors(problems);
    setLoading(false);
  // Snapshot is updated state; the endpoint is intentionally refetched only during reconciliation.
   
  }, [tenantId, siteId]);

  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const onOffline = () => setOnline(false);
    const onOnline = () => { setOnline(true); void reconcileRef.current(); };
    setOnline(navigator.onLine);
    if (!tenantId || !siteId) { setOnline(navigator.onLine); return; }
    void reconcileRef.current();
    const pollEvents = async () => {
      if (disposed || running) return;
      if (!navigator.onLine || document.visibilityState !== "visible") { timer = setTimeout(pollEvents, 15_000); return; }
      running = true;
      let changed = false;
      try {
        for (let batch = 0; batch < 5; batch++) {
          const page = await identityApi<EventPage>(`/sync/events?tenant_id=${encodeURIComponent(tenantId)}&after_sequence=${cursor.current}&limit=100`);
          if (disposed) return;
          cursor.current = Math.max(cursor.current, page.cursor);
          setCursorSeq(cursor.current);
          const scoped = page.events.filter((event) => event.site_id === siteId);
          if (scoped.length) {
            changed = true;
            setActivity((prior) => [...scoped, ...prior].filter((event, index, list) => list.findIndex((item) => item.event_id === event.event_id) === index).slice(0, 40));
          }
          if (!page.has_more) break;
        }
        if (changed) await reconcileRef.current();
      } catch { /* Preserve last known projection and retry from its durable cursor. */ }
      finally {
        running = false;
        if (!disposed) timer = setTimeout(pollEvents, 7_500);
      }
    };
    window.addEventListener("offline", onOffline); window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", pollEvents);
    timer = setTimeout(pollEvents, 7_500);
    return () => { disposed = true; if (timer) clearTimeout(timer); window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", pollEvents); };
  }, [tenantId, siteId]);

  const openIncidents = useMemo(() => snapshot?.incidents.filter((incident) => !["resolved", "closed"].includes(incident.status.toLowerCase())) ?? [], [snapshot]);
  const pendingRuns = runs.filter((run) => ["queued", "running", "waiting_for_client", "paused"].includes(run.state));
  const pendingApprovals = scenarios.flatMap((scenario) => (scenario.approvals ?? []).filter((item) => item.state === "pending").map((approval) => ({ ...approval, simulation_id: scenario.simulation_id })));
  const lastPoint = telemetry?.points.filter((point) => point.value != null).at(-1);
  const telemetryValues = telemetry?.points.filter((point) => point.value != null).map((point) => point.value as number) ?? [];
  const trendLow = telemetryValues.length ? Math.min(...telemetryValues) : 0;
  const trendHigh = telemetryValues.length ? Math.max(...telemetryValues) : 1;
  const trendPath = telemetry?.points.flatMap((point, index) => point.value == null ? [] : [`${telemetry.points.length < 2 ? 0 : index * 480 / (telemetry.points.length - 1)},${100 - ((point.value - trendLow) / (trendHigh - trendLow || 1)) * 84}`]).join(" ") ?? "";
  const freshness = telemetry?.stale ? "Telemetry is stale" : lastPoint ? `Current · ${shortTime(lastPoint.sampled_at)}` : "No current sample";

  if (!tenantId || !siteId) return <main className="space-y-4"><h1 className="text-3xl font-semibold">Mission Control</h1><EmptyState title="Choose an authorized site" detail="Select an organization and site in the command bar to load its projections." /></main>;
  return <main className="space-y-5" aria-busy={loading}>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[.14em] text-slate-600">Operations / live workspace</p><h1 className="mt-1 text-3xl font-semibold">Mission Control</h1><p className="text-sm text-slate-600">Site projections update from the authorized event cursor and reconcile from snapshots after changes or reconnect.</p></div><div className="text-right text-xs"><StatusIndicator label={online ? "Connected" : "Offline"} tone={online ? "online" : "warning"} detail={lastReconciled ? `Snapshot ${new Date(lastReconciled).toLocaleTimeString()}` : "No snapshot yet"} /></div></header>
    {!online && <OfflineState detail="Showing the last loaded site snapshot. New events resume on reconnect." />}
    {error && <ErrorState title="Mission snapshot unavailable" detail={error} retry={() => void reconcileRef.current()} />}
    {panelErrors.length > 0 && <p role="status" className="rounded border border-amber-500 p-3 text-sm">Some panels could not refresh: {panelErrors.join(" ")}</p>}
    {loading && !snapshot && <LoadingState label="Loading authorized site projections…" />}
    {snapshot && snapshot.tenant_id === tenantId && snapshot.site_id === siteId && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Site KPI projections">
        <Kpi label="Assets in scope" value={snapshot.assets.length} detail={`${snapshot.graph_version.split(":")[0]} topology`} />
        <Kpi label="Open incidents" value={openIncidents.length} detail="Canonical site projection" href="#incident-queue" />
        <Kpi label="Pending tasks" value={pendingRuns.length} detail={`${runs.length} runs in site`} href="/agents" />
        <Kpi label="Pending approvals" value={pendingApprovals.length} detail="Simulation approval queue" href="/simulation" />
        <Kpi label="Registered peers" value={peers.length} detail="Inventory only · no link implied" href="/mesh" />
      </section>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section id="incident-queue" className="space-y-3 rounded-lg border border-slate-700 bg-white p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Live incident queue</h2><Link className="text-sm underline" href="/world">World model</Link></div>
          {openIncidents.length ? <ul className="space-y-2">{openIncidents.map((incident) => <li key={incident.incident_id}><Link className="block rounded border p-3 hover:bg-slate-50" href={`/incidents/${encodeURIComponent(incident.incident_id)}`}><span className="flex flex-wrap items-center justify-between gap-2"><strong>{incident.label}</strong><span className="cc-badge">Severity {String(incident.state.severity ?? "unspecified")} · {incident.status}</span></span><span className="mt-2 block font-mono text-xs">{incident.incident_id}</span><span className="mt-1 block text-xs text-slate-600">{incident.affected_asset_ids.length} linked assets · {incident.classification.toUpperCase()} · {incident.status}</span></Link></li>)}</ul> : <EmptyState title="No open incidents" detail="The authorized incident projection returned no unresolved records." />}
        </section>
        <section className="space-y-3 rounded-lg border border-slate-700 bg-white p-4"><h2 className="text-lg font-semibold">Asset health and telemetry</h2><div className="grid grid-cols-2 gap-3">{snapshot.assets.slice(0, 6).map((asset) => { const telemetryHref = /^WTP01-PMP-\d{3}$/.test(asset.asset_id); const card = <><span className="block text-xs uppercase text-slate-600">{asset.asset_type}</span><strong className="font-mono text-sm">{asset.asset_id}</strong><span className="mt-1 block text-xs">{String(asset.status ?? asset.health ?? "No health status in source projection")}</span></>; return telemetryHref ? <Link key={asset.asset_id} href={`/telemetry?asset_id=${encodeURIComponent(asset.asset_id)}`} className="rounded border p-3">{card}</Link> : <article key={asset.asset_id} className="rounded border p-3">{card}</article>; })}</div><div className="rounded border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{telemetry?.asset_id ?? "Telemetry"} · Pressure trend</strong><span className="cc-badge">{freshness}</span></div>{lastPoint && <p className="mt-2 text-2xl font-semibold">{lastPoint.value} {telemetry?.unit}</p>}{trendPath && <svg className="mt-2 h-28 w-full rounded bg-slate-50" viewBox="-5 0 490 112" role="img" aria-label={`Two hour pressure trend for ${telemetry?.asset_id}, ${trendLow} to ${trendHigh} ${telemetry?.unit}; missing buckets are omitted`}><line x1="0" y1="104" x2="480" y2="104" stroke="var(--border)" /><polyline points={trendPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" /></svg>}<p className="text-xs text-slate-600">{telemetry?.availability ?? "No query result"} · {telemetry?.points.length ?? 0} buckets · 2 hour window</p><Link className="mt-2 inline-block text-sm underline" href="/telemetry">Open telemetry explorer</Link></div></section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-700 bg-white p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">Pending tasks and approvals</h2><Link className="text-xs underline" href="/agents">Agent runs</Link></div>{pendingRuns.length === 0 && pendingApprovals.length === 0 ? <EmptyState title="No pending work" detail="No queued site runs or pending simulation approvals were returned." /> : <ul className="mt-3 space-y-2 text-sm">{pendingRuns.map((run) => <li key={run.run_id}><Link href="/agents" className="underline">Task {run.run_id}</Link> · {run.state}</li>)}{pendingApprovals.map((approval) => <li key={approval.approval_id}><Link href="/simulation" className="underline">Approval {approval.approval_id}</Link> · {approval.state} · {approval.simulation_id}</li>)}</ul>}</section>
        <section className="rounded-lg border border-slate-700 bg-white p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">Scoped activity</h2><span className="text-xs text-slate-600">Cursor {cursorSeq} · reconciled {lastReconciled ? new Date(lastReconciled).toLocaleTimeString() : "—"}</span></div>{activity.length ? <ol className="mt-3 space-y-2">{activity.map((event) => <li key={event.event_id} className="border-l-2 border-slate-500 pl-3 text-sm"><span className="font-mono text-xs">#{event.sequence}</span> · {event.event_type} · <Link className="underline" href={event.aggregate_type === "incident" ? `/incidents/${encodeURIComponent(event.aggregate_id)}` : "/world"}>{event.aggregate_id}</Link><span className="block text-xs text-slate-600">{new Date(event.occurred_at).toLocaleString()}</span></li>)}</ol> : <p className="mt-3 text-sm text-slate-600">No new scoped events since this session opened. Projection cursor reconciliation is active.</p>}</section>
      </div>
    </>}
  </main>;
}

function Kpi({ label, value, detail, href }: { label: string; value: number; detail: string; href?: string }) {
  const body = <><span className="text-xs text-slate-600">{label}</span><strong className="block text-2xl">{value}</strong><span className="text-xs text-slate-600">{detail}</span></>;
  return <article className="rounded-lg border border-slate-700 bg-white p-4">{href ? <Link href={href} className="block">{body}</Link> : body}</article>;
}
