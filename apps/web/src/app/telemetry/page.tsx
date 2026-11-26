"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { TelemetrySeriesPage } from "@nexus-titan/contracts";
import { identityApi } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/command-center-primitives";

const PAGE_SIZE = 100;
const localInput = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function TelemetryPage() {
  const { tenantId, siteId } = useWorkspaceSelection();
  const [assetId, setAssetId] = useState("WTP01-PMP-001");
  const [metric, setMetric] = useState("pressure");
  const [end, setEnd] = useState(() => localInput(new Date()));
  const [start, setStart] = useState(() => localInput(new Date(Date.now() - 2 * 60 * 60 * 1000)));
  const [threshold, setThreshold] = useState("");
  const [series, setSeries] = useState<TelemetrySeriesPage | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { const value = new URLSearchParams(window.location.search).get("asset_id"); if (value && /^WTP01-PMP-\d{3}$/.test(value)) setAssetId(value); }, []);
  useEffect(() => { setSeries(null); setError(""); setPage(0); }, [tenantId, siteId]);

  async function loadSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true); setPage(0);
    try {
      if (!tenantId || !siteId) throw new Error("Choose an authorized organization and site in the command bar first.");
      const startDate = new Date(`${start}:00`); const endDate = new Date(`${end}:00`);
      const span = endDate.getTime() - startDate.getTime();
      if (!Number.isFinite(span) || span <= 0 || span > 30 * 24 * 60 * 60 * 1000) throw new Error("Choose an increasing time range no longer than 30 days.");
      const interval = Math.max(60, Math.min(3600, Math.ceil(span / 900_000 / 60) * 60));
      const query = new URLSearchParams({ tenant_id: tenantId, site_id: siteId, asset_id: assetId, metric,
        start: startDate.toISOString(), end: endDate.toISOString(), interval_seconds: String(interval) });
      setSeries(await identityApi<TelemetrySeriesPage>(`/v1/world/telemetry?${query}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Telemetry request failed."); setSeries(null); }
    finally { setLoading(false); }
  }

  const allPoints = series?.points ?? [];
  const valid = allPoints.filter((point) => point.value != null);
  const values = valid.map((point) => point.value as number);
  const low = values.length ? Math.min(...values) : 0; const high = values.length ? Math.max(...values) : 1;
  const valuePoints = allPoints.flatMap((point, index) => point.value == null ? [] : [{ point, index }]);
  const polyline = valuePoints.map(({ point, index }) => `${allPoints.length < 2 ? 0 : index * 960 / (allPoints.length - 1)},${210 - ((point.value as number) - low) / (high - low || 1) * 180}`).join(" ");
  const cutoff = threshold.trim() === "" ? null : Number(threshold);
  const anomalies = cutoff == null || !Number.isFinite(cutoff) ? [] : valuePoints.filter(({ point }) => Math.abs(point.value as number) >= Math.abs(cutoff));
  const pages = Math.max(1, Math.ceil(allPoints.length / PAGE_SIZE));
  const visible = allPoints.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const missing = allPoints.filter((point) => point.value == null || point.quality === "missing").length;
  const downloadCsv = () => {
    if (!series) return;
    const esc = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["sampled_at", "asset_id", "metric", "value", "unit", "quality", "fixture_label"], ...series.points.map((point) => [point.sampled_at, series.asset_id, series.metric, point.value, point.unit, point.quality, "synthetic_fixture"] as unknown[])];
    const blob = new Blob([rows.map((row) => row.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `synthetic-${series.asset_id}-${series.metric}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="mx-auto max-w-6xl space-y-6">
    <header className="space-y-2"><p className="text-sm font-semibold uppercase tracking-widest text-blue-800">Synthetic telemetry</p><h1 className="text-3xl font-bold">Plant signal explorer</h1><p className="max-w-3xl text-slate-700">Authorized, downsampled samples from the TITAN-WTP-01 API. This generated dataset is fictional and is not connected to a plant.</p></header>
    <form onSubmit={(event) => void loadSeries(event)} className="grid gap-4 rounded-lg border border-slate-300 bg-white p-5 md:grid-cols-2">
      <label className="grid gap-1 font-medium">Pump asset ID<input required pattern="WTP01-PMP-[0-9]{3}" value={assetId} onChange={(event) => setAssetId(event.target.value)} className="rounded border border-slate-500 px-3 py-2 font-mono" /></label>
      <label className="grid gap-1 font-medium">Metric<select aria-label="Select metric to visualize" value={metric} onChange={(event) => setMetric(event.target.value)} className="rounded border border-slate-500 px-3 py-2"><option value="pressure">Pressure (kPa)</option><option value="flow">Flow (m³/h)</option><option value="vibration">Vibration (mm/s)</option><option value="temperature">Temperature (°C)</option></select></label>
      <label className="grid gap-1 font-medium">Start time<input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="rounded border border-slate-500 px-3 py-2" /></label>
      <label className="grid gap-1 font-medium">End time<input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="rounded border border-slate-500 px-3 py-2" /></label>
      <label className="grid gap-1 font-medium">Anomaly threshold ({metric})<input type="number" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Optional absolute threshold" className="rounded border border-slate-500 px-3 py-2" /></label>
      <button disabled={loading} className="self-end rounded bg-blue-800 px-4 py-2 font-semibold text-white hover:bg-blue-900 disabled:opacity-60">{loading ? "Loading series…" : "Load authorized API series"}</button>
    </form>
    {error && <ErrorState title="Telemetry query failed" detail={error} />}
    {loading && <LoadingState label="Querying bounded telemetry window…" />}
    {series && series.tenant_id === tenantId && series.site_id === siteId && <section aria-labelledby="series-title" className="space-y-4 rounded-lg border border-slate-300 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="series-title" className="text-xl font-semibold">{series.asset_id} · {series.metric} ({series.unit})</h2><p aria-live="polite" className="text-sm text-slate-700">Availability: {series.availability}; {series.stale ? "data is stale" : "data is current"}; {series.points.length} buckets at {series.interval_seconds}s resolution.</p></div><button type="button" disabled={!series.points.length} onClick={downloadCsv} className="rounded border px-3 py-2 disabled:opacity-50">Download synthetic CSV</button></div>
      {allPoints.length ? <><p className="text-sm">Missing buckets: {missing}/{allPoints.length} ({(100 * missing / allPoints.length).toFixed(1)}%) · threshold markers: {anomalies.length}</p>
        {valid.length ? <svg viewBox="-10 0 980 230" role="img" aria-label={`${series.metric} chart in ${series.unit}; low ${low.toFixed(2)}, high ${high.toFixed(2)}; ${missing} missing buckets; ${anomalies.length} threshold markers`} className="h-64 w-full rounded bg-slate-50"><line x1="0" y1="210" x2="960" y2="210" stroke="var(--border)" /><polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth="3" />{anomalies.map(({ point }, index) => { const originalIndex = allPoints.indexOf(point); const x = allPoints.length < 2 ? 0 : originalIndex * 960 / (allPoints.length - 1); const y = 210 - ((point.value as number) - low) / (high - low || 1) * 180; return <circle key={`${point.sampled_at}:${index}`} cx={x} cy={y} r="5" fill="var(--fault)"><title>{point.sampled_at}: {point.value} {series.unit}, threshold exceeded</title></circle>; })}<text x="8" y="18" fill="var(--foreground)" fontSize="14">{high.toFixed(2)} {series.unit}</text><text x="8" y="228" fill="var(--foreground)" fontSize="14">{low.toFixed(2)} {series.unit}</text></svg> : <EmptyState title="No measured values" detail="The API returned only missing buckets for this window." />}
        <div aria-label="Telemetry pagination and status" className="flex items-center justify-between gap-3"><p className="text-xs">Rows {allPoints.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, allPoints.length)} of {allPoints.length}</p><div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage((prior) => prior - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Previous</button><span className="self-center text-sm">Page {page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((prior) => prior + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Next</button></div></div>
        <div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Downsampled {series.metric} readings with quality flags</caption><thead><tr><th scope="col" className="p-2">Time</th><th scope="col" className="p-2">Value ({series.unit})</th><th scope="col" className="p-2">Quality</th><th scope="col" className="p-2">Threshold</th></tr></thead><tbody>{visible.map((point) => <tr key={point.sampled_at} className="border-t"><td className="p-2">{new Date(point.sampled_at).toLocaleString()}</td><td className="p-2">{point.value == null ? "—" : point.value.toFixed(3)}</td><td className="p-2">{point.quality}</td><td className="p-2">{cutoff !== null && point.value != null && Math.abs(point.value) >= Math.abs(cutoff) ? "Exceeded" : "—"}</td></tr>)}</tbody></table></div>
      </> : <EmptyState title="No samples in this window" detail="The authorized API returned no buckets for this asset, metric, and time range." />}
    </section>}
  </main>;
}
