import Link from "next/link";
import IdentityShell from "@/components/identity-shell";

export default function Home() {
  return (
    <div className="space-y-6">
      <section className="space-y-2 py-2">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-teal-700">Operations workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Command center</h1>
        <p className="max-w-3xl text-sm text-slate-600">Authenticate to load tenant-authorized data. The workbench below uses synthetic fixtures and clearly labels simulation, inference, and offline capabilities.</p>
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
        ].map(([label, href, detail]) => <Link key={href} href={href} className="rounded-lg border border-slate-700 bg-white p-4 no-underline transition-colors hover:bg-slate-100">
          <span className="font-semibold">{label}</span><span className="mt-1 block text-sm text-slate-600">{detail}</span><span className="mt-3 block text-xs text-teal-700">Open workspace →</span>
        </Link>)}
      </section>
      <IdentityShell />
    </div>
  );
}
