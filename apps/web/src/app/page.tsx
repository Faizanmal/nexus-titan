import Link from "next/link";
import IdentityShell from "@/components/identity-shell";

export default function Home() {
  return (
    <div className="space-y-8">
      {/* Flagship Incident Demo Hero Banner */}
      <section
        aria-label="Flagship Incident Scenario Entry"
        className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 via-white to-slate-50 p-6 md:p-8 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-indigo-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            Flagship Incident Walkthrough
          </span>
          <span className="rounded bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-900 font-mono">
            TITAN-WTP-01 · Synthetic Digital Twin
          </span>
          <span className="rounded bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            Fictional Linear Hydraulic Model · Zero Industrial Sockets
          </span>
        </div>

        <div className="mt-4 max-w-3xl space-y-3">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            Flagship Incident Scenario: Pump P-101 Contradiction & Hybrid AI
          </h1>
          <p className="text-sm md:text-base text-slate-600 leading-relaxed">
            Experience the complete 5-stage evaluator walkthrough: SCADA anomaly alarm & contradictory physical dial gauge, offline local edge triage on restricted technician data, cryptographic consent & de-identified Firebase AI Logic (cloud, Gemini) handoff, counterfactual multi-agent solver decisions, and deterministic replay.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            id="hero-flagship-entry"
            href="/demo"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <span>Enter Flagship Incident Walkthrough</span>
            <span aria-hidden="true">→</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
            <span>1-Click Dedicated Judge Sandbox · No Setup Required</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5 text-xs text-slate-700 pt-4 border-t border-indigo-100">
          <div><strong className="text-indigo-900 block font-mono">Stage 1</strong> Alarm & Contradiction</div>
          <div><strong className="text-indigo-900 block font-mono">Stage 2</strong> Offline Local AI</div>
          <div><strong className="text-indigo-900 block font-mono">Stage 3</strong> Approved Cloud Handoff</div>
          <div><strong className="text-indigo-900 block font-mono">Stage 4</strong> Solver & Mitigation</div>
          <div><strong className="text-indigo-900 block font-mono">Stage 5</strong> Replay & Twin Sync</div>
        </div>
      </section>

      {/* Operational workspaces */}
      <section className="space-y-2 py-2">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-teal-700">Operations workspace</p>
        <h2 className="text-2xl font-semibold tracking-tight">Command center workspaces</h2>
        <p className="max-w-3xl text-sm text-slate-600">
          Authenticate to load tenant-authorized data. The workspaces below use synthetic fixtures and clearly label simulation, inference, and offline capabilities.
        </p>
      </section>

      <section aria-label="Operational workspaces" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Mission Control", "/mission", "Site projections · live incidents · scoped activity"],
          ["Telemetry explorer", "/telemetry", "Synthetic readings · stale and quality indicators"],
          ["Field workspace", "/field", "Evidence capture · local inference source · queued work review"],
          ["Causal investigation", "/causal", "Evidence-backed hypotheses · uncertainty visible"],
          ["Numerical simulation", "/simulation", "Synthetic physics fallback · approval gated"],
          ["Agent runs", "/agents", "Persisted workflow status · role trace"],
          ["Knowledge and memory", "/knowledge", "Approved sources · human-verified facts"],
          ["Demo onboarding", "/demo", "Synthetic scenario setup · local owner-gated reset"],
        ].map(([label, href, detail]) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border border-slate-700 bg-white p-4 no-underline transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
          >
            <span className="font-semibold">{label}</span>
            <span className="mt-1 block text-sm text-slate-600">{detail}</span>
            <span className="mt-3 block text-xs text-teal-700">Open workspace →</span>
          </Link>
        ))}
      </section>
      <IdentityShell />
    </div>
  );
}
