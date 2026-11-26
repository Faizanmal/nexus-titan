"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { identityApi } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";

type Policy = {
  id: string;
  name: string;
  version: string;
  status: string;
  effective_date: string;
  summary: string;
  enforcement: string;
};

type AuditEvent = {
  audit_id: string;
  timestamp: string;
  actor_id: string;
  action: string;
  target: string;
  result: "allowed" | "denied";
  policy_version: string;
  reason_code: string;
  details: string;
  event_sha256: string;
};

type ApprovalRecord = {
  approval_id: string;
  site_id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  aggregate_type: string;
  aggregate_id: string;
  state: string;
  payload_digest: string;
  snapshot_digest: string;
  created_at: string;
  expires_at: string;
  approved_by?: string | null;
  approver_role?: string | null;
  is_expired: boolean;
  redacted_preview?: string;
};

type DenialRecord = {
  denial_id: string;
  timestamp: string;
  actor_id: string;
  attempted_action: string;
  role: string;
  reason_code: string;
  policy: string;
  detail: string;
};

type Member = {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "operator" | "viewer";
  status: string;
  site_scopes: string[];
  created_at: string;
};

const BASELINE_POLICIES: Policy[] = [
  {
    id: "POL-DATA-CLASS-01",
    name: "Data Classification & Placement Policy",
    version: "v1.2.0",
    status: "active",
    effective_date: "2026-01-01T00:00:00Z",
    summary: "Restricts restricted telemetry and operational assets to local/on-device perimeter; prohibits cloud transmission without explicit two-actor supervisor approval.",
    enforcement: "Strict compile-time & runtime guards",
  },
  {
    id: "POL-INFER-PLACE-02",
    name: "Hybrid Inference Placement Policy",
    version: "v1.1.0",
    status: "active",
    effective_date: "2026-01-15T00:00:00Z",
    summary: "Enforces on-device processing via Chrome Prompt API when device capabilities and local consent are met; permitted cloud fallback only for non-restricted scopes.",
    enforcement: "Firebase AI Logic + capability matrix",
  },
  {
    id: "POL-MESH-EXCH-03",
    name: "Peer-to-Peer Mesh Exchange Policy",
    version: "v1.0.0",
    status: "active",
    effective_date: "2026-02-01T00:00:00Z",
    summary: "Requires mutual Ed25519 authenticated device keys for WebRTC DataChannel; zero restricted exfiltration allowed outside the local subnet.",
    enforcement: "Cryptographic envelope signatures & device trust registry",
  },
  {
    id: "POL-CONSENT-SHARE-04",
    name: "Operator Consent & Artifact Sharing Policy",
    version: "v1.0.0",
    status: "active",
    effective_date: "2026-02-15T00:00:00Z",
    summary: "Mandates explicit operator consent and two-actor supervisory approval before sharing field telemetry, simulation plans, or incident reports.",
    enforcement: "SHA-256 digest binding & supervisor dual-key signoff",
  },
];

export default function GovernancePage() {
  const workspace = useWorkspaceSelection();
  const organizationId = workspace.tenantId;

  const [activeTab, setActiveTab] = useState<"policies" | "audit" | "approvals" | "denials" | "members">("policies");
  const [policies, setPolicies] = useState<Policy[]>(BASELINE_POLICIES);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [chainHead, setChainHead] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [denials, setDenials] = useState<DenialRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Edit member modal
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [newRole, setNewRole] = useState<"owner" | "admin" | "operator" | "viewer">("operator");

  async function loadData() {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const [polResp, auditResp, apprResp, denResp, memResp] = await Promise.all([
        identityApi<{ policies: Policy[] }>(
          `/v1/organizations/${encodeURIComponent(organizationId)}/governance/policies`
        ).catch(() => ({ policies: [] })),
        identityApi<{ events: AuditEvent[]; chain_head_sha256: string }>(
          `/v1/organizations/${encodeURIComponent(organizationId)}/governance/audit`
        ).catch(() => ({ events: [], chain_head_sha256: "" })),
        identityApi<{ approvals: ApprovalRecord[] }>(
          `/v1/organizations/${encodeURIComponent(organizationId)}/governance/approvals`
        ).catch(() => ({ approvals: [] })),
        identityApi<{ denials: DenialRecord[] }>(
          `/v1/organizations/${encodeURIComponent(organizationId)}/governance/denials`
        ).catch(() => ({ denials: [] })),
        identityApi<{ members: Member[] }>(
          `/v1/organizations/${encodeURIComponent(organizationId)}/governance/members`
        ).catch(() => ({ members: [] })),
      ]);

      setPolicies(polResp.policies);
      setAuditEvents(auditResp.events);
      setChainHead(auditResp.chain_head_sha256);
      setApprovals(apprResp.approvals);
      setDenials(denResp.denials);
      setMembers(memResp.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load governance records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function updateMemberRole() {
    if (!organizationId || !editMember) return;
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      await identityApi(
        `/v1/organizations/${encodeURIComponent(organizationId)}/governance/members/${encodeURIComponent(editMember.user_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role: newRole, site_ids: editMember.site_scopes }),
        }
      );
      setStatusMsg(`Role updated to ${newRole} for ${editMember.email}.`);
      setEditMember(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Role modification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="hover:underline">Home</Link> &gt; <span>Governance &amp; Audit</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Governance &amp; Audit Control</h1>
          <p className="mt-1 text-sm text-slate-600">
            Versioned privacy policies, cryptographic audit stream, supervisory approvals, and member administration.
          </p>
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

      {/* Navigation Tabs */}
      <div className="flex border-b text-sm font-medium">
        {(
          [
            { id: "policies", label: `Policy Versions (${policies.length})` },
            { id: "audit", label: `Audit Stream (${auditEvents.length})` },
            { id: "approvals", label: `Approvals & Consent (${approvals.length})` },
            { id: "denials", label: `Denied Access (${denials.length})` },
            { id: "members", label: `Org Members (${members.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition ${
              activeTab === tab.id
                ? "border-teal-700 text-teal-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-12 text-center text-xs text-slate-500">Loading governance records…</p>
      ) : (
        <>
          {/* Tab 1: Policies */}
          {activeTab === "policies" && (
            <section className="grid gap-4 md:grid-cols-2">
              {policies.map((p) => (
                <article key={p.id} className="space-y-3 rounded-lg border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">{p.name}</h3>
                      <span className="font-mono text-xs text-slate-500">{p.id}</span>
                    </div>
                    <span className="rounded bg-teal-100 px-2 py-0.5 font-mono text-xs font-bold text-teal-800">
                      {p.version}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{p.summary}</p>
                  <div className="border-t pt-2 text-[11px] text-slate-500 flex justify-between">
                    <span>Enforcement: {p.enforcement}</span>
                    <span>Status: {p.status}</span>
                  </div>
                </article>
              ))}
            </section>
          )}

          {/* Tab 2: Audit Stream */}
          {activeTab === "audit" && (
            <section className="space-y-4 rounded-lg border bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Tamper-Evident Security Audit Stream</h3>
                  <p className="text-xs text-slate-500">
                    Each event is cryptographically linked to the prior record via SHA-256 hash chaining.
                  </p>
                </div>
                {chainHead && (
                  <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-2.5 py-1 rounded">
                    Chain Head SHA-256: {chainHead.slice(0, 16)}…
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="p-2.5">ID / Time</th>
                      <th className="p-2.5">Actor</th>
                      <th className="p-2.5">Action &amp; Target</th>
                      <th className="p-2.5">Result</th>
                      <th className="p-2.5">Policy / Reason</th>
                      <th className="p-2.5">Hash Checksum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditEvents.map((ev) => (
                      <tr key={ev.audit_id} className="hover:bg-slate-50">
                        <td className="p-2.5">
                          <span className="font-mono font-bold text-slate-800">{ev.audit_id}</span>
                          <span className="block text-[10px] text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">{ev.actor_id}</td>
                        <td className="p-2.5">
                          <strong>{ev.action}</strong>
                          <span className="block text-[10px] font-mono text-slate-500">{ev.target}</span>
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              ev.result === "allowed" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                            }`}
                          >
                            {ev.result}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span className="font-mono text-[10px]">{ev.reason_code}</span>
                          <span className="block text-[10px] text-slate-500">{ev.policy_version}</span>
                        </td>
                        <td className="p-2.5 font-mono text-[10px] text-slate-400">
                          {ev.event_sha256.slice(0, 12)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Tab 3: Approvals & Consent */}
          {activeTab === "approvals" && (
            <section className="space-y-4 rounded-lg border bg-white p-5">
              <h3 className="text-sm font-bold text-slate-900">Consent &amp; Share Artifact Approval History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="p-2.5">Approval ID / Scope</th>
                      <th className="p-2.5">Proposer</th>
                      <th className="p-2.5">Action &amp; Target</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Supervisor Approval</th>
                      <th className="p-2.5">Redacted Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {approvals.map((app) => (
                      <tr key={app.approval_id} className="hover:bg-slate-50">
                        <td className="p-2.5">
                          <span className="font-mono font-bold text-slate-800">{app.approval_id}</span>
                          <span className="block text-[10px] text-slate-500">{app.site_id}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">
                          {app.actor_id} ({app.actor_role})
                        </td>
                        <td className="p-2.5">
                          <strong>{app.action}</strong>
                          <span className="block font-mono text-[10px] text-slate-500">{app.aggregate_id}</span>
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              app.state === "approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : app.state === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {app.state}
                          </span>
                        </td>
                        <td className="p-2.5 text-[11px] text-slate-600">
                          {app.approved_by ? `${app.approved_by} (${app.approver_role})` : "Pending 2nd Supervisor"}
                        </td>
                        <td className="p-2.5 text-[11px] text-slate-600 max-w-xs truncate">
                          {app.redacted_preview || `Payload SHA-256: ${app.payload_digest.slice(0, 12)}…`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Tab 4: Denied Access */}
          {activeTab === "denials" && (
            <section className="space-y-4 rounded-lg border bg-white p-5">
              <h3 className="text-sm font-bold text-slate-900">Security &amp; Policy Denials Audit Log</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="p-2.5">Denial ID / Time</th>
                      <th className="p-2.5">Actor &amp; Role</th>
                      <th className="p-2.5">Attempted Action</th>
                      <th className="p-2.5">Reason Code</th>
                      <th className="p-2.5">Policy Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {denials.map((d) => (
                      <tr key={d.denial_id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono">
                          <span className="font-bold text-red-700">{d.denial_id}</span>
                          <span className="block text-[10px] text-slate-500">{new Date(d.timestamp).toLocaleTimeString()}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">{d.actor_id} ({d.role})</td>
                        <td className="p-2.5 font-mono text-[11px] text-slate-800">{d.attempted_action}</td>
                        <td className="p-2.5 font-mono text-xs font-bold text-red-700">{d.reason_code}</td>
                        <td className="p-2.5 text-xs text-slate-600">{d.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Tab 5: Org Members */}
          {activeTab === "members" && (
            <section className="space-y-4 rounded-lg border bg-white p-5">
              <h3 className="text-sm font-bold text-slate-900">Organization Members &amp; Site Scopes</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="p-2.5">User &amp; Email</th>
                      <th className="p-2.5">Role</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Site Scopes</th>
                      <th className="p-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {members.map((m) => (
                      <tr key={m.user_id} className="hover:bg-slate-50">
                        <td className="p-2.5">
                          <strong className="block text-slate-900">{m.email}</strong>
                          <span className="font-mono text-[10px] text-slate-500">{m.user_id}</span>
                        </td>
                        <td className="p-2.5">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-semibold uppercase text-slate-800">
                            {m.role}
                          </span>
                        </td>
                        <td className="p-2.5 capitalize">{m.status}</td>
                        <td className="p-2.5 font-mono text-xs text-slate-600">
                          {m.site_scopes.length ? m.site_scopes.join(", ") : "All sites (Admin)"}
                        </td>
                        <td className="p-2.5">
                          <button
                            onClick={() => {
                              setEditMember(m);
                              setNewRole(m.role);
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit Role
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Member Role Update Modal */}
      {editMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Change Member Role</h3>
            <p className="text-xs text-slate-600">Update organizational permissions for {editMember.email}.</p>

            <div>
              <label className="text-xs font-semibold text-slate-700">Role:</label>
              <select
                className="mt-1 w-full rounded border p-2 text-xs"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "owner" | "admin" | "operator" | "viewer")}
              >
                <option value="owner">Owner (Full administrative rights)</option>
                <option value="admin">Admin (Manage members &amp; devices)</option>
                <option value="operator">Operator (Run agents &amp; simulations)</option>
                <option value="viewer">Viewer (Read-only)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditMember(null)}
                className="rounded border px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void updateMemberRole()}
                disabled={busy}
                className="rounded bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save Role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
