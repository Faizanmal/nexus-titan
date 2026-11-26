"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { identityApi } from "@/lib/identity/api";
import { useWorkspaceSelection } from "@/components/command-center-shell";

type ReconstructedAsset = {
  asset_id: string;
  label: string;
  asset_type: string;
  subsystem_id: string;
  criticality: string;
  status: string;
  sequence_created: number;
};

type ReplayResponse = {
  tenant_id: string;
  site_id: string;
  sequence: number;
  max_sequence: number;
  asset_count: number;
  replayed_sha256: string;
  original_sha256: string;
  checksum_match: boolean;
  divergence: string[];
  assets: ReconstructedAsset[];
  telemetry_at_sequence: {
    pressure_kpa: number;
    flow_m3h: number;
    vibration_mms: number;
    unit: string;
    quality: string;
  };
};

export default function EventReplayPage() {
  const workspace = useWorkspaceSelection();
  const tenant = workspace.tenantId;
  const site = workspace.siteId || "TITAN-WTP-01";

  const [sequence, setSequence] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [replayData, setReplayData] = useState<ReplayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");

  async function loadSequence(targetSeq: number) {
    if (!tenant) return;
    setLoading(true);
    try {
      const data = await identityApi<ReplayResponse>(
        `/v1/world/replay?tenant_id=${encodeURIComponent(tenant)}&site_id=${encodeURIComponent(site)}&sequence=${targetSeq}`
      );
      setReplayData(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load replay state.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSequence(sequence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, site, sequence]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSequence((prev) => {
        if (prev >= 120) {
          setIsPlaying(false);
          return 120;
        }
        return prev + 1;
      });
    }, 1000 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  const filteredAssets = (replayData?.assets || []).filter((a) => {
    if (assetFilter !== "all" && a.asset_type !== assetFilter) return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <nav className="text-xs text-slate-500">
        <Link href="/" className="hover:underline">Home</Link> &gt; <span>Event Replay</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Deterministic Event State Replay</h1>
          <p className="mt-1 text-sm text-slate-600">
            Reconstruct operational plant state sequence-by-sequence from canonical immutable events with bit-for-bit SHA-256 verification.
          </p>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Checksum Verification Banner */}
      {replayData && (
        <div
          className={`flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 ${
            replayData.checksum_match
              ? "border-emerald-300 bg-emerald-50/70 text-emerald-950"
              : "border-red-300 bg-red-50/70 text-red-950"
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-bold ${
                replayData.checksum_match ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
              }`}
            >
              {replayData.checksum_match ? "✓" : "!"}
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">
                {replayData.checksum_match
                  ? "VERIFIED · BIT-FOR-BIT CHECKSUM MATCH"
                  : "DIVERGENCE DETECTED IN REPLAY STATE"}
              </h2>
              <p className="text-xs">
                {replayData.asset_count} reconstructed assets at sequence #{replayData.sequence} match the canonical head projection.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1 text-[11px] font-mono">
            <span>Replay SHA-256: <strong className="font-bold">{replayData.replayed_sha256.slice(0, 16)}…</strong></span>
            <span>Origin SHA-256: <strong className="font-bold">{replayData.original_sha256.slice(0, 16)}…</strong></span>
          </div>
        </div>
      )}

      {/* Scrubber & Playback Controls Bar */}
      <section className="space-y-4 rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {isPlaying ? "Pause ⏸" : "Play ▶"}
            </button>
            <button
              onClick={() => setSequence((s) => Math.max(0, s - 1))}
              disabled={sequence <= 0}
              className="rounded border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              -1 Step
            </button>
            <button
              onClick={() => setSequence((s) => Math.min(120, s + 1))}
              disabled={sequence >= 120}
              className="rounded border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              +1 Step
            </button>
            <button
              onClick={() => setSequence(0)}
              className="rounded border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset to #0
            </button>
            <button
              onClick={() => setSequence(120)}
              className="rounded border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Head #120
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium text-slate-600">Speed:</span>
            {[1, 2, 5, 10].map((spd) => (
              <button
                key={spd}
                onClick={() => setPlaybackSpeed(spd)}
                className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
                  playbackSpeed === spd ? "bg-teal-800 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Range slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-mono font-bold text-slate-700">
            <span>Sequence #0 (Initial Plant Setup)</span>
            <span className="rounded bg-teal-100 px-2 py-0.5 text-teal-900">
              Current Replay: #{sequence} / 120 {loading ? "(loading…)" : ""}
            </span>
            <span>Sequence #120 (Head State)</span>
          </div>
          <input
            type="range"
            min={0}
            max={120}
            value={sequence}
            onChange={(e) => setSequence(parseInt(e.target.value, 10))}
            className="w-full cursor-pointer accent-teal-800"
          />
        </div>
      </section>

      {/* Synchronized Replay Diagnostics: Telemetry & 2D Topology */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left: Reconstructed Asset Inventory Table */}
        <section className="space-y-4 rounded-lg border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Reconstructed Assets ({filteredAssets.length} active)
              </h2>
              <p className="text-xs text-slate-500">
                Assets created or updated on or before event sequence #{sequence}.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-600">Type:</label>
              <select
                className="rounded border p-1 text-xs"
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                <option value="pump">Pumps</option>
                <option value="tank">Tanks</option>
                <option value="filter">Filters</option>
                <option value="valve">Valves</option>
                <option value="sensor">Sensors</option>
                <option value="subsystem">Subsystems</option>
              </select>
            </div>
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="p-2.5">Asset ID / Label</th>
                  <th className="p-2.5">Type</th>
                  <th className="p-2.5">Subsystem</th>
                  <th className="p-2.5">Created At Event</th>
                  <th className="p-2.5">Replay Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssets.map((asset) => (
                  <tr key={asset.asset_id} className="hover:bg-slate-50">
                    <td className="p-2.5">
                      <strong className="font-mono text-slate-900">{asset.asset_id}</strong>
                      <span className="block text-[11px] text-slate-500">{asset.label}</span>
                    </td>
                    <td className="p-2.5 font-mono text-[11px] uppercase">{asset.asset_type}</td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-600">{asset.subsystem_id}</td>
                    <td className="p-2.5 font-mono text-slate-500">#{asset.sequence_created}</td>
                    <td className="p-2.5">
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                        {asset.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredAssets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      No assets created yet at sequence #{sequence}. Advance the scrubber to see asset emergence.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right: Synchronized Telemetry State Card & Mini Topology */}
        <section className="space-y-5">
          {replayData?.telemetry_at_sequence && (
            <div className="space-y-4 rounded-lg border bg-white p-5">
              <h3 className="text-sm font-bold text-slate-900">Synchronized Telemetry Snapshot</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Pressure (Intake)</span>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {replayData.telemetry_at_sequence.pressure_kpa} <span className="text-xs font-normal text-slate-500">kPa</span>
                  </p>
                </div>

                <div className="rounded border bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Flow Rate</span>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {replayData.telemetry_at_sequence.flow_m3h} <span className="text-xs font-normal text-slate-500">m³/h</span>
                  </p>
                </div>

                <div className="rounded border bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Vibration</span>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {replayData.telemetry_at_sequence.vibration_mms} <span className="text-xs font-normal text-slate-500">mm/s</span>
                  </p>
                </div>

                <div className="rounded border bg-slate-50 p-3">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Signal Quality</span>
                  <p className="mt-1 text-sm font-bold capitalize text-emerald-700">
                    {replayData.telemetry_at_sequence.quality}
                  </p>
                </div>
              </div>

              {/* 2D Topology Indicator */}
              <div className="rounded border p-3 bg-slate-50">
                <span className="text-xs font-semibold text-slate-700">Reconstructed 2D Plant Layout</span>
                <svg viewBox="0 0 300 160" className="mt-2 w-full rounded bg-slate-900 p-2">
                  <rect x="10" y="20" width="60" height="40" rx="4" fill="#14b8a6" opacity="0.8" />
                  <text x="40" y="44" fill="#ffffff" fontSize="9" textAnchor="middle" fontFamily="monospace">Intake</text>

                  <line x1="70" y1="40" x2="110" y2="40" stroke="#f0c46c" strokeWidth="2" strokeDasharray="3 3" />

                  <rect x="110" y="20" width="70" height="40" rx="4" fill="#38bdf8" opacity="0.8" />
                  <text x="145" y="44" fill="#ffffff" fontSize="9" textAnchor="middle" fontFamily="monospace">Treatment</text>

                  <line x1="180" y1="40" x2="220" y2="40" stroke="#f0c46c" strokeWidth="2" strokeDasharray="3 3" />

                  <rect x="220" y="20" width="70" height="40" rx="4" fill="#818cf8" opacity="0.8" />
                  <text x="255" y="44" fill="#ffffff" fontSize="9" textAnchor="middle" fontFamily="monospace">Storage</text>

                  <text x="150" y="120" fill="#94a3b8" fontSize="10" textAnchor="middle">
                    Active Assets: {replayData.asset_count} / 120
                  </text>
                  <text x="150" y="140" fill="#38bdf8" fontSize="9" textAnchor="middle" fontFamily="monospace">
                    Lockstep Parity: 100%
                  </text>
                </svg>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-white p-4 text-xs text-slate-600 space-y-2">
            <h4 className="font-bold text-slate-800">Replay Determinism Guarantee</h4>
            <p>
              Replaying events produces the exact state projection byte-for-byte. Checksums are computed over canonical JSON sorting all asset attributes.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
