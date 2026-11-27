import { getGenerativeModel } from "firebase/ai";
import { firebaseClient, InferenceMode, type SpikeMode } from "./client";
import { mapReportedInferenceSource } from "./inference-source";
import { readHybridRemoteConfig, prepareGeminiNano } from "@nexus-titan/hybrid-web";

export type FirebaseInferenceResult = {
  text: string;
  /** Actual source is exclusively the SDK response; callers cannot inject/override it. */
  actualSource: "ON_DEVICE" | "IN_CLOUD" | "IN_CLOUD (inferred from mode)" | null;
};

/**
 * Real Firebase AI Logic provider. Test doubles must not set actualSource to ON_DEVICE;
 * only mapReportedInferenceSource(SDK value) produces that label.
 */
export async function requestFirebaseInference(
  mode: SpikeMode,
  prompt: string,
  onProgress: (label: string) => void,
): Promise<FirebaseInferenceResult> {
  const { app, ai } = firebaseClient();
  let cloudModel = process.env.NEXT_PUBLIC_FIREBASE_CLOUD_MODEL || "gemini-3.5-flash-lite";
  try {
    const runtimeConfig = await readHybridRemoteConfig(app);
    if (runtimeConfig?.model) {
      cloudModel = runtimeConfig.model;
    }
  } catch {
    // Fall back to configured cloudModel
  }

  const model = getGenerativeModel(ai, {
    mode: InferenceMode[mode],
    inCloudParams: { model: cloudModel },
  });
  if (mode === "ONLY_IN_CLOUD") {
    onProgress("Not checked (cloud-only mode)");
  } else {
    onProgress("Checking device model…");
    try {
      const prep = await prepareGeminiNano();
      if (!prep.supported || prep.modelState === "unavailable") {
        if (mode === "ONLY_ON_DEVICE") {
          onProgress("Device model unavailable or initialization failed");
          throw new Error("Device model unavailable: Chrome Prompt API missing or model unavailable");
        }
      } else if (
        typeof (model as { initializeDeviceModel?: (cb: (p: number) => void) => Promise<void> }).initializeDeviceModel ===
        "function"
      ) {
        await (model as { initializeDeviceModel: (cb: (p: number) => void) => Promise<void> }).initializeDeviceModel(
          (progress) => onProgress(`Device model progress: ${Math.round(progress * 100)}%`),
        );
      }
    } catch (error) {
      if (mode === "ONLY_ON_DEVICE") {
        onProgress("Device model unavailable or initialization failed");
        throw error;
      }
    }
  }
  const result = await model.generateContent(prompt);
  const reportedSource = mapReportedInferenceSource(result.response.inferenceSource);
  const actualSource = reportedSource ?? (mode === "ONLY_IN_CLOUD" ? "IN_CLOUD (inferred from mode)" : null);
  if ((mode === "PREFER_ON_DEVICE" || mode === "PREFER_IN_CLOUD") && actualSource !== "ON_DEVICE") {
    onProgress("Device model unavailable, fell back to cloud");
  } else if (actualSource === "ON_DEVICE") {
    onProgress("Device model ready");
  } else if (mode === "ONLY_IN_CLOUD") {
    onProgress("Not checked (cloud-only mode)");
  }
  return {
    text: result.response.text(),
    actualSource,
  };
}
