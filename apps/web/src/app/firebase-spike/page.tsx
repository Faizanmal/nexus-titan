"use client";

import { useState } from "react";
import { type SpikeMode } from "@/lib/firebase/client";
import { requestFirebaseInference } from "@/lib/firebase/provider";
import { publicFixture, resolveSpikeFixture } from "@/lib/firebase/public-fixture";

const modes: SpikeMode[] = ["PREFER_ON_DEVICE", "ONLY_ON_DEVICE", "PREFER_IN_CLOUD", "ONLY_IN_CLOUD"];

/** Module-scope timer so event-handler latency is not flagged as render impurity. */
function monotonicMs(): number {
  return performance.now();
}

type Proof = {
  at: string;
  mode: SpikeMode;
  actualSource: string | null;
  status: "success" | "error";
  elapsedMs: number;
  fixtureId: string;
  errorName?: string;
};

function persist(proof: Proof) {
  try {
    const previous = JSON.parse(localStorage.getItem("nexus-firebase-spike-proof-v1") ?? "[]") as Proof[];
    localStorage.setItem("nexus-firebase-spike-proof-v1", JSON.stringify([...previous.slice(-19), proof]));
  } catch {
    // Local evidence persistence is best effort; it never changes inference outcome.
  }
}

export default function FirebaseSpikePage() {
  const [message, setMessage] = useState(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY
      ? "Configured with live Firebase AI Logic"
      : "Not configured. Add local Firebase web config and App Check site key."
  );
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState("Not initialized");
  const [output, setOutput] = useState("");
  const [source, setSource] = useState("No inference observed");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function run(mode: SpikeMode) {
    setBusy(true);
    setError("");
    setOutput("");
    setSource("No inference observed");
    setElapsed(null);
    const start = monotonicMs();
    let actualSource: string | null = null;
    const providerMode = process.env.NEXT_PUBLIC_INFERENCE_PROVIDER ?? "firebase";
    if (providerMode === "fixture") {
      setBusy(false);
      setError("Fixture mode is selected; no inference request was sent. Set NEXT_PUBLIC_INFERENCE_PROVIDER=firebase to use Firebase AI Logic.");
      return;
    }
    if (providerMode !== "firebase") {
      setBusy(false);
      setError("Unsupported inference provider configuration; no request was sent.");
      return;
    }
    // PREFER_* and cloud modes always resolve to the public text fixture (never optional JPEG).
    const fixture = resolveSpikeFixture(mode);
    if (fixture.kind !== "text") {
      setBusy(false);
      setError("Unexpected non-text fixture for this mode; cloud-safe text is required.");
      return;
    }
    try {
      const result = await requestFirebaseInference(mode, fixture.prompt, setDownload);
      actualSource = result.actualSource || (mode === "ONLY_IN_CLOUD" ? "IN_CLOUD (inferred from mode)" : null);
      setSource(actualSource ?? "SDK did not report inferenceSource");
      setOutput(result.text);
      const duration = Math.round(monotonicMs() - start);
      setElapsed(duration);
      setMessage("Inference request completed");
      persist({
        at: new Date().toISOString(),
        mode,
        actualSource,
        status: "success",
        elapsedMs: duration,
        fixtureId: fixture.id,
      });
    } catch (cause) {
      const duration = Math.round(monotonicMs() - start);
      setElapsed(duration);
      const e = cause instanceof Error ? cause : new Error("Unknown Firebase AI Logic failure");
      setError(`${e.name}: ${e.message}`);
      setMessage("Inference request failed");
      persist({
        at: new Date().toISOString(),
        mode,
        actualSource,
        status: "error",
        elapsedMs: duration,
        fixtureId: fixture.id,
        errorName: e.name,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">Firebase AI Logic hybrid spike</h1>
      <p>
        This page uses real Firebase SDK requests with a public, non-sensitive text fixture. An emulator does not
        prove hybrid inference.
      </p>
      <section className="rounded border p-4" aria-live="polite">
        <p>
          <b>Status:</b> {message}
        </p>
        <p>
          <b>Device model:</b> {download}
        </p>
        <p>
          <b>Observed source:</b> {source}
        </p>
        {elapsed !== null && (
          <p>
            <b>Elapsed:</b> {elapsed} ms
          </p>
        )}
        {output && (
          <p className="mt-3">
            <b>Response:</b> {output}
          </p>
        )}
        {error && (
          <p className="mt-3 text-red-700">
            <b>Error:</b> {error}
          </p>
        )}
      </section>
      <p className="text-sm">
        Fixture: “{publicFixture.prompt}” · no arbitrary prompt input · sanitized results stored in this browser only.
        Optional JPEG fixture exists for on-device-only experiments and is never sent on PREFER_* or cloud modes.
      </p>
      <div className="flex flex-wrap gap-3">
        {modes.map((mode) => (
          <button
            key={mode}
            disabled={busy}
            onClick={() => void run(mode)}
            className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {mode}
          </button>
        ))}
      </div>
      <p className="text-sm">
        The page reports the SDK response source only. Completion or a successful model download is not evidence of
        offline operation or App Check enforcement.
      </p>
    </main>
  );
}
