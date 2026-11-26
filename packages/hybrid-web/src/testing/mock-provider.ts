import type { InferenceSource } from "../types.ts";

/** Unit-test-only deterministic provider. This module is not re-exported by the runtime package. */
export async function fixtureProvider(): Promise<{ actualSource: Extract<InferenceSource, "MOCK">; summary: string }> {
  return { actualSource: "MOCK", summary: "Deterministic fixture response; no inference request was sent." };
}
