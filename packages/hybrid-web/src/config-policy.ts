import type { RuntimeConfig } from "./types.ts";

export const SUPPORTED_CLOUD_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-3.5-flash-lite",
  "gemini-4-hydrogen",
] as const;
export const SUPPORTED_PROMPT_VERSIONS = ["fixture-qa-v1"] as const;
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  model: (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_FIREBASE_CLOUD_MODEL) || "gemini-3.5-flash-lite",
  promptVersion: "fixture-qa-v1",
  maxOutputTokens: 512,
  cloudEnabled: false,
  source: "safe_default",
};

export function validateRuntimeConfig(input: { model: string; promptVersion: string; maxOutputTokens: number; cloudEnabled: boolean }): RuntimeConfig {
  if (!SUPPORTED_CLOUD_MODELS.includes(input.model as (typeof SUPPORTED_CLOUD_MODELS)[number]) ||
      !SUPPORTED_PROMPT_VERSIONS.includes(input.promptVersion as (typeof SUPPORTED_PROMPT_VERSIONS)[number])) {
    throw new Error("Remote Config model or prompt is not allowlisted.");
  }
  return { ...input, maxOutputTokens: Number.isFinite(input.maxOutputTokens)
    ? Math.max(32, Math.min(512, Math.floor(input.maxOutputTokens))) : DEFAULT_RUNTIME_CONFIG.maxOutputTokens, source: "remote_config" };
}
