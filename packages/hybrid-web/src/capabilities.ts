import type { CapabilitySnapshot, ModelState, Modality } from "./types.ts";

type PromptLanguageModel = { availability?: (options?: unknown) => Promise<string> };

export async function inspectCapabilities(modality: Modality = "text", quota: CapabilitySnapshot["quota"] = "unknown"): Promise<CapabilitySnapshot> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { desktopChrome: false, promptApi: false, modelState: "unknown", modality, foreground: false,
      online: false, quota, checkedAt: new Date().toISOString() };
  }
  const desktopChrome = /Chrome\//.test(navigator.userAgent) && !/Android|Mobile/.test(navigator.userAgent);
  const promptApi = "LanguageModel" in window || ("ai" in window && "languageModel" in (window as unknown as { ai: Record<string, unknown> }).ai);
  let modelState: ModelState = promptApi ? "unknown" : "unavailable";
  if (promptApi) {
    try {
      const languageModel = (window as unknown as { LanguageModel?: PromptLanguageModel; ai?: { languageModel?: PromptLanguageModel } }).LanguageModel ||
        (window as unknown as { ai?: { languageModel?: PromptLanguageModel } }).ai?.languageModel;
      if (typeof languageModel?.availability === "function") {
        const availability = await languageModel.availability({
          expectedInputs: modality === "text" ? [{ type: "text", languages: ["en"] }] : [{ type: "image" }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        });
        if (availability === "available" || availability === "ready") modelState = "ready";
        else if (availability === "downloadable") modelState = "downloadable";
        else if (availability === "downloading") modelState = "downloading";
        else if (availability === "unavailable") modelState = "unavailable";
      }
    } catch {
      modelState = "unavailable";
    }
  }
  return {
    desktopChrome, promptApi, modelState, modality,
    foreground: document.visibilityState === "visible" && document.hasFocus(),
    online: navigator.onLine, quota, checkedAt: new Date().toISOString(),
  };
}

export function observeForeground(onChange: (foreground: boolean) => void): () => void {
  const update = () => onChange(document.visibilityState === "visible" && document.hasFocus());
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  update();
  return () => {
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", update);
  };
}

export interface GeminiNanoPreparation {
  supported: boolean;
  modelState: ModelState;
  ready: boolean;
  status: string;
  downloadProgress?: number;
}

export async function prepareGeminiNano(
  onProgress?: (fraction: number) => void
): Promise<GeminiNanoPreparation> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      modelState: "unavailable",
      ready: false,
      status: "Server-side environment lacks Prompt API window context.",
    };
  }

  const desktopChrome = /Chrome\//.test(navigator.userAgent) && !/Android|Mobile/.test(navigator.userAgent);
  const hasPromptApi = "LanguageModel" in window || ("ai" in window && "languageModel" in (window as unknown as { ai: Record<string, unknown> }).ai);

  if (!desktopChrome || !hasPromptApi) {
    return {
      supported: false,
      modelState: "unavailable",
      ready: false,
      status: "DEVICE_HARDWARE_LIMITATION: Host GPU/RAM below Chrome Prompt API floor or non-Chrome browser; deterministic simulation available.",
    };
  }

  try {
    const lm = (window as unknown as { LanguageModel?: PromptLanguageModel; ai?: { languageModel?: PromptLanguageModel } }).LanguageModel ||
      (window as unknown as { ai?: { languageModel?: PromptLanguageModel } }).ai?.languageModel;
    if (typeof lm?.availability === "function") {
      const avail = await lm.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      });
      if (avail === "available" || avail === "ready") {
        return {
          supported: true,
          modelState: "ready",
          ready: true,
          status: "Gemini Nano ready for offline on-device inference.",
        };
      }
      if (avail === "downloadable" || avail === "downloading") {
        return {
          supported: true,
          modelState: avail === "downloadable" ? "downloadable" : "downloading",
          ready: false,
          status: `Gemini Nano requires download (${avail}). Trigger download from user interaction.`,
        };
      }
    }
  } catch (err) {
    return {
      supported: true,
      modelState: "unavailable",
      ready: false,
      status: `Gemini Nano preparation query error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    supported: true,
    modelState: "unknown",
    ready: false,
    status: "Chrome Prompt API detected; model status checking.",
  };
}
