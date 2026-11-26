"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { identityApi } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";

type Run = {
  run_id: string;
  site_id: string;
  state: string;
  created_at: string;
  deadline_at: string;
};

type RoleDetail = {
  role_name: string;
  executor: string;
  planned_executor?: string;
  actual_source?: string;
  placement_explanation?: string;
  policy_denial_reason?: string | null;
  state: string;
  result?: Record<string, unknown> | null;
  evidence_refs?: string[];
  timing?: {
    started_at?: string | null;
    finished_at?: string | null;
    duration_ms?: number | null;
  };
  retries?: {
    attempts: number;
    max_attempts: number;
  };
  output_refs?: Record<string, unknown> | null;
};

type RunDetail = Run & {
  roles: RoleDetail[];
  attempts: Array<{
    role_name: string;
    attempt: number;
    state: string;
    trace: Record<string, unknown>;
    started_at: string;
    finished_at?: string | null;
  }>;
  events: Array<{
    sequence: number;
    event_type: string;
    payload?: Record<string, unknown>;
    created_at: string;
  }>;
};

const DAG_DEPENDENCIES: Record<string, string[]> = {
  supervisor: [],
  vision: ["supervisor"],
  sensor: ["supervisor"],
  spatial: ["vision", "sensor"],
  knowledge: ["supervisor", "sensor"],
  privacy: ["vision", "sensor", "knowledge"],
  causal: ["vision", "sensor", "spatial", "knowledge"],
  simulation: ["spatial", "sensor"],
  planning: ["causal", "simulation", "privacy"],
  critic: ["planning", "causal"],
  memory: ["knowledge", "spatial", "causal", "planning"],
  recovery: ["vision", "sensor", "causal", "critic"],
  verification: ["critic", "privacy", "memory", "recovery"],
};

export default function AgentsPage() {
  const workspace = useWorkspaceSelection();
  const memberships = workspace.memberships;
  const tenant = workspace.tenantId;
  const site = workspace.siteId;

  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleDetail | null>(null);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Filters
  const [stateFilter, setStateFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  async function refresh(org = tenant) {
    if (!org) return;
    try {
      const data = await identityApi<{ runs: Run[] }>(
        `/v1/agents/runs?tenant_id=${encodeURIComponent(org)}`
      );
      setRuns(data.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run inventory unavailable.");
    }
  }

  useEffect(() => {
    let disposed = false;
    void refresh().then(async () => {
      if (disposed) return;
      const requested = new URLSearchParams(window.location.search).get("run_id");
      if (requested) {
        try {
          const trace = await identityApi<RunDetail>(
            `/v1/agents/runs/${encodeURIComponent(requested)}`
          );
          if (!disposed && trace.site_id === site) {
            setDetail(trace);
            setSelectedRole(trace.roles[0] || null);
          }
        } catch (e) {
          if (!disposed) setError(e instanceof Error ? e.message : "Requested trace unavailable.");
        }
      }
    });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, site]);

  async function start() {
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const resp = await identityApi<{ run_id: string }>(
        "/v1/agents/runs",
        {
          method: "POST",
          body: JSON.stringify({
            tenant_id: tenant,
            site_id: site,
            idempotency_key: crypto.randomUUID(),
            input: { source: "operator_console", task: "incident_triage" },
          }),
        }
      );
      await refresh();
      if (resp.run_id) {
        const full = await identityApi<RunDetail>(`/v1/agents/runs/${resp.run_id}`);
        setDetail(full);
        setSelectedRole(full.roles[0] || null);
        setStatusMsg(`Created run ${resp.run_id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start run.");
    } finally {
      setBusy(false);
    }
  }

  async function select(run: Run) {
    setError("");
    setStatusMsg("");
    try {
      const trace = await identityApi<RunDetail>(`/v1/agents/runs/${run.run_id}`);
      setDetail(trace);
      setSelectedRole(trace.roles[0] || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run trace unavailable.");
    }
  }

  async function control(action: string) {
    if (!detail) return;
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      await identityApi(`/v1/agents/runs/${detail.run_id}/${action}`, { method: "POST" });
      await refresh();
      const updated = await identityApi<RunDetail>(`/v1/agents/runs/${detail.run_id}`);
      setDetail(updated);
      if (selectedRole) {
        const matched = updated.roles.find((r) => r.role_name === selectedRole.role_name);
        if (matched) setSelectedRole(matched);
      }
      setStatusMsg(`Action "${action}" succeeded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Run control "${action}" failed.`);
    } finally {
      setBusy(false);
    }
  }

  async function exportTrace() {
    if (!detail) return;
    try {
      const sanitized = await identityApi<Record<string, unknown>>(
        `/v1/agents/runs/${detail.run_id}/export`
      );
      const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sanitized-run-${detail.run_id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg("Sanitized trace exported without restricted records.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trace export failed.");
    }
  }

  const current = memberships.find((m) => m.organization_id === tenant);
  const canControl = current && ["owner", "admin", "operator"].includes(current.role);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      return true;
    });
  }, [runs, stateFilter]);

  const filteredRoles = useMemo(() => {
    if (!detail) return [];
    return detail.roles.filter((r) => {
      if (sourceFilter !== "all" && r.actual_source !== sourceFilter) return false;
      return true;
    });
  }, [detail, sourceFilter]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="hover:underline">Home</Link> &gt; <span>Agent Studio</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Agent Studio &amp; Durable Runs</h1>
          <p className="mt-1 text-sm text-slate-600">
            Interactive 13-role DAG with task status, timing, source attribution, and policy placement explanation.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void start()}
            disabled={busy || !site || !canControl}
            className="rounded bg-teal-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Queue New Agent Run"}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {statusMsg && (
        <div role="status" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
          {statusMsg}
        </div>
      )}

      {/* Main Grid: Left Runs Inventory, Right Execution DAG */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left column: Run List & Filters */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Run History</h2>
            <button onClick={() => void refresh()} className="text-xs text-slate-500 hover:text-slate-800">Refresh</button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">State:</label>
            <select
              className="rounded border p-1 text-xs"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="all">All States</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="max-h-[700px] space-y-2 overflow-y-auto pr-1">
            {filteredRuns.map((r) => {
              const isSelected = detail?.run_id === r.run_id;
              return (
                <button
                  key={r.run_id}
                  onClick={() => void select(r)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isSelected ? "border-teal-700 bg-teal-50/50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium text-slate-800 truncate max-w-[170px]">
                      {r.run_id}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        r.state === "completed"
                          ? "bg-emerald-100 text-emerald-800"
                          : r.state === "running"
                          ? "bg-amber-100 text-amber-800 animate-pulse"
                          : r.state === "cancelled" || r.state === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {r.state}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Site: {r.site_id} · {new Date(r.created_at).toLocaleTimeString()}
                  </div>
                </button>
              );
            })}
            {filteredRuns.length === 0 && (
              <p className="rounded border border-dashed p-4 text-center text-xs text-slate-500">
                No runs matching current filter.
              </p>
            )}
          </div>
        </section>

        {/* Right column: DAG Visualization, Role Inspector & Controls */}
        <section className="space-y-6">
          {detail ? (
            <>
              {/* Run Header Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">{detail.run_id}</span>
                    <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs text-slate-800 uppercase">
                      {detail.state}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Site: {detail.site_id} · Deadline: {new Date(detail.deadline_at).toLocaleTimeString()} ·
                    Strict privacy: no raw prompts exported
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canControl && (
                    <>
                      <button
                        onClick={() => void control("step")}
                        disabled={busy || detail.state === "completed" || detail.state === "cancelled"}
                        className="rounded bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
                      >
                        Step DAG
                      </button>
                      <button
                        onClick={() => void control("pause")}
                        disabled={busy || detail.state !== "running"}
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Pause
                      </button>
                      <button
                        onClick={() => void control("continue")}
                        disabled={busy || detail.state !== "paused"}
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => void control("retry")}
                        disabled={busy || !["failed", "cancelled"].includes(detail.state)}
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => void control("cancel")}
                        disabled={busy || ["completed", "cancelled"].includes(detail.state)}
                        className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => void exportTrace()}
                    className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Export Sanitized Trace
                  </button>
                </div>
              </div>

              {/* Source Placement Filter Bar */}
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-slate-600">Filter roles by actual source:</span>
                {(["all", "local", "cloud", "server", "deterministic", "mock"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setSourceFilter(src)}
                    className={`rounded px-2.5 py-1 uppercase text-[10px] font-bold ${
                      sourceFilter === src
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>

              {/* Interactive DAG Canvas */}
              <div className="rounded-lg border bg-white p-5">
                <h3 className="mb-3 text-sm font-bold text-slate-800">Role Execution Graph (DAG)</h3>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {filteredRoles.map((role) => {
                    const isSelected = selectedRole?.role_name === role.role_name;
                    const deps = DAG_DEPENDENCIES[role.role_name] || [];
                    const isCompleted = role.state === "completed";
                    const isFailed = role.state === "failed";
                    const isRunning = role.state === "running";

                    return (
                      <article
                        key={role.role_name}
                        onClick={() => setSelectedRole(role)}
                        className={`cursor-pointer rounded-lg border p-3.5 transition ${
                          isSelected
                            ? "border-teal-700 bg-teal-50/50 ring-2 ring-teal-600/30"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between pb-1.5">
                          <strong className="font-mono text-sm capitalize text-slate-900">
                            {role.role_name}
                          </strong>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              isCompleted
                                ? "bg-emerald-100 text-emerald-800"
                                : isFailed
                                ? "bg-red-100 text-red-800"
                                : isRunning
                                ? "bg-amber-100 text-amber-800 animate-pulse"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {role.state}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                            planned: {role.planned_executor || role.executor}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                              role.actual_source === "local"
                                ? "bg-purple-100 text-purple-800"
                                : role.actual_source === "cloud"
                                ? "bg-blue-100 text-blue-800"
                                : role.actual_source === "mock"
                                ? "bg-orange-100 text-orange-800"
                                : "bg-slate-200 text-slate-800"
                            }`}
                          >
                            source: {role.actual_source || "unknown"}
                          </span>
                        </div>

                        {deps.length > 0 && (
                          <div className="mt-2 text-[10px] text-slate-500">
                            deps: <span className="font-mono">{deps.join(", ")}</span>
                          </div>
                        )}

                        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                          <span>{role.timing?.duration_ms != null ? `${role.timing.duration_ms} ms` : "—"}</span>
                          <span>{role.retries?.attempts || 0}/2 tries</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              {/* Role Detail Inspector */}
              {selectedRole && (
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                    <div>
                      <h4 className="text-base font-bold capitalize text-slate-900">
                        {selectedRole.role_name} Inspector
                      </h4>
                      <p className="text-xs text-slate-500">
                        Detailed execution placement, security constraints, and outputs.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-teal-100 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800">
                        Source: {selectedRole.actual_source || "unplaced"}
                      </span>
                      <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs text-slate-700">
                        State: {selectedRole.state}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <h5 className="text-xs font-semibold text-slate-700 uppercase">Placement &amp; Policy Explanation</h5>
                        <p className="mt-1 text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-200">
                          {selectedRole.placement_explanation || "Planned vs actual placement follows tenant privacy policy."}
                        </p>
                      </div>

                      {selectedRole.policy_denial_reason && (
                        <div>
                          <h5 className="text-xs font-semibold text-red-700 uppercase">Denied Policy Reason</h5>
                          <p className="mt-1 text-xs text-red-800 bg-red-50 p-2.5 rounded border border-red-200">
                            {selectedRole.policy_denial_reason}
                          </p>
                        </div>
                      )}

                      <div>
                        <h5 className="text-xs font-semibold text-slate-700 uppercase">Dependencies</h5>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(DAG_DEPENDENCIES[selectedRole.role_name] || []).length > 0 ? (
                            DAG_DEPENDENCIES[selectedRole.role_name].map((dep) => (
                              <span key={dep} className="rounded bg-white px-2 py-0.5 font-mono text-xs border">
                                {dep}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">None (root DAG node)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <h5 className="text-xs font-semibold text-slate-700 uppercase">Output References (Sanitized)</h5>
                        <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded border bg-white p-2.5 text-[11px] font-mono text-slate-800">
                          {selectedRole.output_refs
                            ? JSON.stringify(selectedRole.output_refs, null, 2)
                            : "No outputs produced yet."}
                        </pre>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded border bg-white p-2">
                          <span className="text-[10px] text-slate-500 uppercase">Duration</span>
                          <p className="font-semibold">{selectedRole.timing?.duration_ms != null ? `${selectedRole.timing.duration_ms} ms` : "—"}</p>
                        </div>
                        <div className="rounded border bg-white p-2">
                          <span className="text-[10px] text-slate-500 uppercase">Retries</span>
                          <p className="font-semibold">{selectedRole.retries?.attempts || 0} / {selectedRole.retries?.max_attempts || 2}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Event Timeline Scrubber */}
              <div className="rounded-lg border bg-white p-5">
                <h3 className="text-sm font-bold text-slate-800">Execution Timeline &amp; Event Stream</h3>
                <div className="mt-3 max-h-60 overflow-y-auto divide-y text-xs">
                  {detail.events.map((ev) => (
                    <div key={ev.sequence} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">#{ev.sequence}</span>
                        <span className="font-semibold text-slate-800">{ev.event_type}</span>
                        {ev.payload && (
                          <span className="text-slate-500 truncate max-w-sm font-mono text-[10px]">
                            {JSON.stringify(ev.payload)}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-400 text-[11px]">{new Date(ev.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {detail.events.length === 0 && (
                    <p className="py-2 text-slate-500">No events recorded for this run.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-12 text-center text-slate-500">
              <p className="font-medium">No Agent Run Selected</p>
              <p className="mt-1 text-xs">Select a run from the history or queue a new run to inspect its execution graph.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
