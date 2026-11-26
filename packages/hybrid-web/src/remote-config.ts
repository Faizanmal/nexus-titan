import { fetchAndActivate, getRemoteConfig, getString, type RemoteConfig } from "firebase/remote-config";
import type { FirebaseApp } from "firebase/app";
import type { RuntimeConfig } from "./types.ts";
import { DEFAULT_RUNTIME_CONFIG, validateRuntimeConfig } from "./config-policy.ts";
export { DEFAULT_RUNTIME_CONFIG, SUPPORTED_CLOUD_MODELS, SUPPORTED_PROMPT_VERSIONS, validateRuntimeConfig } from "./config-policy.ts";

function readNumber(remote: RemoteConfig, key: string, fallback: number, min: number, max: number): number {
  const value = Number(getString(remote, key));
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export async function readHybridRemoteConfig(app: FirebaseApp): Promise<RuntimeConfig> {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_CONFIG;
  const remote = getRemoteConfig(app);
  remote.settings.minimumFetchIntervalMillis = process.env.NODE_ENV === "development" ? 0 : 3_600_000;
  remote.defaultConfig = {
    nexus_hybrid_model: DEFAULT_RUNTIME_CONFIG.model,
    nexus_hybrid_prompt_version: DEFAULT_RUNTIME_CONFIG.promptVersion,
    nexus_hybrid_max_output_tokens: String(DEFAULT_RUNTIME_CONFIG.maxOutputTokens),
    nexus_hybrid_cloud_enabled: "true",
  };
  let activated = false;
  try { activated = await fetchAndActivate(remote); } catch { /* use the explicit safe defaults below */ }
  const model = getString(remote, "nexus_hybrid_model") || DEFAULT_RUNTIME_CONFIG.model;
  const promptVersion = getString(remote, "nexus_hybrid_prompt_version") || DEFAULT_RUNTIME_CONFIG.promptVersion;
  const cloudEnabled = getString(remote, "nexus_hybrid_cloud_enabled").toLowerCase() === "true";
  try {
    const validated = validateRuntimeConfig({ model, promptVersion,
      maxOutputTokens: readNumber(remote, "nexus_hybrid_max_output_tokens", 256, 32, 512), cloudEnabled });
    return { ...validated, source: activated ? "remote_config" : "safe_default" };
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG, source: "safe_default" };
  }
}
