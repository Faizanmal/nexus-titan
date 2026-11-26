import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

type Tone = "online" | "warning" | "fault" | "info" | "neutral";

function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
  if (!targets.length) return;
  if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0].focus(); }
}

export function StatusIndicator({ label, detail, tone = "neutral" }: { label: string; detail?: string; tone?: Tone }) {
  return <span className="cc-status" data-state={tone} aria-label={`${label}${detail ? `: ${detail}` : ""}`}>
    <span className="cc-status-dot" aria-hidden="true" /><span>{label}{detail ? ` · ${detail}` : ""}</span>
  </span>;
}

export function MetricValue({ label, value, unit, stale = false, source }: { label: string; value: ReactNode; unit: string; stale?: boolean; source?: string }) {
  return <div className="rounded-lg border border-slate-700 bg-white p-4">
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{label}</p>
    <p className="mt-2 flex flex-wrap items-baseline gap-2"><strong className="font-mono text-2xl">{value}</strong><span className="text-sm text-slate-600">{unit}</span></p>
    <p className="mt-2 text-xs text-slate-600">{stale ? "Stale snapshot" : "Current snapshot"}{source ? ` · ${source}` : ""}</p>
  </div>;
}

export function EvidenceProvenance({ source, version, timestamp, href }: { source: string; version?: string; timestamp?: string; href?: string }) {
  return <div className="rounded-md border border-slate-700 bg-slate-50 p-3 text-xs">
    <p className="font-semibold">Evidence provenance</p><p className="mt-1 font-mono">{source}{version ? ` · ${version}` : ""}</p>
    {timestamp && <p className="mt-1 text-slate-600">Observed {timestamp}</p>}
    {href && <a className="mt-1 inline-block underline" href={href}>Open source evidence</a>}
  </div>;
}

export function InferenceSourceChip({ source, state }: { source: "Local model" | "Cloud model" | "Deterministic tool" | "Manual entry"; state: string }) {
  return <span className="cc-badge" aria-label={`Inference source: ${source}; ${state}`}>{source} · {state}</span>;
}

export function PolicyDecision({ decision, reason }: { decision: "allow" | "deny" | "review"; reason: string }) {
  const tone: Tone = decision === "allow" ? "online" : decision === "deny" ? "fault" : "warning";
  return <div className="rounded-md border border-slate-700 bg-white p-3"><StatusIndicator label={`Policy ${decision}`} detail={reason} tone={tone} /></div>;
}

export function Timeline({ items }: { items: Array<{ at: string; title: string; detail?: string; tone?: Tone }> }) {
  if (!items.length) return <EmptyState title="No timeline events" detail="Events will appear when the authorized source returns them." />;
  return <ol className="space-y-3" aria-label="Event timeline">{items.map((item, index) => <li className="flex gap-3" key={`${item.at}-${index}`}>
    <span className="mt-1"><StatusIndicator label={item.tone === "fault" ? "Fault" : item.tone === "warning" ? "Warning" : "Event"} tone={item.tone} /></span>
    <div><time className="font-mono text-xs text-slate-600">{item.at}</time><p className="font-semibold">{item.title}</p>{item.detail && <p className="text-sm text-slate-600">{item.detail}</p>}</div>
  </li>)}</ol>;
}

export function DataTable<T extends object>({ columns, rows, rowKey }: { columns: Array<{ key: keyof T; label: string }>; rows: T[]; rowKey: keyof T }) {
  return <div className="overflow-x-auto rounded-lg border border-slate-700"><table className="w-full border-collapse text-left text-sm"><thead><tr>{columns.map((column) => <th scope="col" className="border-b border-slate-700 bg-slate-100 px-3 py-2 font-semibold" key={String(column.key)}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr className="border-b border-slate-700 last:border-0" key={String(row[rowKey])}>{columns.map((column) => <td className="px-3 py-2 align-top" key={String(column.key)}>{row[column.key] as ReactNode}</td>)}</tr>)}</tbody></table></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="rounded-lg border border-dashed border-slate-700 bg-white p-6" aria-label={title}><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-600">{detail}</p>{action && <div className="mt-3">{action}</div>}</section>;
}

export function ErrorState({ title = "Data unavailable", detail, retry }: { title?: string; detail: string; retry?: () => void }) {
  return <section className="rounded-lg border border-red-800 bg-red-50 p-4" role="alert"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm">{detail}</p>{retry && <button className="mt-3 rounded border border-slate-700 px-3 py-2" onClick={retry}>Retry request</button>}</section>;
}

export function LoadingState({ label = "Loading authorized data" }: { label?: string }) {
  return <div className="space-y-2" role="status" aria-live="polite" aria-label={label}><span className="sr-only">{label}</span><div className="h-4 w-40 animate-pulse rounded bg-slate-100" /><div className="h-20 animate-pulse rounded bg-slate-100" /></div>;
}

export function OfflineState({ detail = "Offline · cached content may be stale; server actions are unavailable." }: { detail?: string }) {
  return <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm" role="status"><StatusIndicator label="Offline" detail={detail} tone="warning" /></div>;
}

export function ConfirmationDialog({ title, detail, confirmLabel, onConfirm, onCancel, busy = false }: {
  title: string; detail: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  return <div className="cc-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="cc-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-detail" onKeyDown={trapTab}>
      <div className="cc-dialog-head"><h2 id="confirm-title" className="font-semibold">{title}</h2><button autoFocus className="cc-icon-button" aria-label="Cancel and close" onClick={onCancel}>Close</button></div>
      <div className="cc-dialog-body"><p id="confirm-detail">{detail}</p><div className="mt-5 flex justify-end gap-2"><button className="cc-icon-button" onClick={onCancel}>Cancel</button><button className="cc-icon-button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button></div></div>
    </section>
  </div>;
}

export function GraphLegend({ items }: { items: Array<{ label: string; description: string; tone: Tone }> }) {
  return <div className="flex flex-wrap gap-3" aria-label="Graph legend">{items.map((item) => <span className="cc-status" data-state={item.tone} key={item.label}><span className="cc-status-dot" aria-hidden="true" /><span><strong>{item.label}</strong> — {item.description}</span></span>)}</div>;
}
