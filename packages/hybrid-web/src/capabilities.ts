import type { CapabilitySnapshot, ModelState, Modality } from "./types.ts";

type PromptLanguageModel = { availability?: (options?: unknown) => Promise<string> };

export async function inspectCapabilities(modality: Modality = "text", quota: CapabilitySnapshot["quota"] = "unknown"): Promise<CapabilitySnapshot> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { desktopChrome: false, promptApi: false, modelState: "unknown", modality, foreground: false,
      online: false, quota, checkedAt: new Date().toISOString() };
  }
  const desktopChrome = /Chrome\//.test(navigator.userAgent) && !/Android|Mobile/.test(navigator.userAgent);
  const promptApi = "LanguageModel" in window;
  let modelState: ModelState = promptApi ? "unknown" : "unavailable";
  if (promptApi) {
    try {
      const languageModel = (window as unknown as { LanguageModel: PromptLanguageModel }).LanguageModel;
      const availability = await languageModel.availability?.({
        expectedInputs: modality === "text" ? [{ type: "text", languages: ["en"] }] : [{ type: "image" }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      });
      if (availability === "available") modelState = "ready";
      else if (availability === "downloadable") modelState = "downloadable";
      else if (availability === "downloading") modelState = "downloading";
      else if (availability === "unavailable") modelState = "unavailable";
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
